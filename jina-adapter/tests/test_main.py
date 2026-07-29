import unittest

import httpx

from src.main import JINA_SEARCH_URL, app


class JinaAdapterTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.upstream_requests = []
        self.upstream_status = 200
        self.upstream_body = "Title: 结果\nURL Source: https://example.com\nMarkdown Content:\n内容"

        async def upstream_handler(request: httpx.Request):
            self.upstream_requests.append(request)
            return httpx.Response(self.upstream_status, text=self.upstream_body)

        self.upstream = httpx.AsyncClient(transport=httpx.MockTransport(upstream_handler))
        app.state.http = self.upstream
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://adapter.test",
        )

    async def asyncTearDown(self):
        await self.client.aclose()
        await self.upstream.aclose()

    async def test_translates_last_user_message_and_wraps_openai_response(self):
        response = await self.client.post(
            "/v1/chat/completions",
            headers={"Authorization": "Bearer jina-test-key"},
            json={
                "model": "jina-search",
                "messages": [
                    {"role": "user", "content": "旧问题"},
                    {"role": "assistant", "content": "旧回答"},
                    {"role": "user", "content": " 最新消息 "},
                ],
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["choices"][0]["message"]["content"], self.upstream_body)
        self.assertEqual(len(self.upstream_requests), 1)
        request = self.upstream_requests[0]
        self.assertEqual(str(request.url), JINA_SEARCH_URL)
        self.assertEqual(request.headers["Authorization"], "Bearer jina-test-key")
        self.assertEqual(request.read(), b'{"q":"\xe6\x9c\x80\xe6\x96\xb0\xe6\xb6\x88\xe6\x81\xaf"}')

    async def test_rejects_invalid_contract_without_calling_jina(self):
        response = await self.client.post(
            "/v1/chat/completions",
            json={"model": "jina-search", "messages": [{"role": "user", "content": "x"}]},
        )
        self.assertEqual(response.status_code, 401)

        for payload in (
            {"model": "other", "messages": [{"role": "user", "content": "x"}]},
            {"model": "jina-search", "stream": True, "messages": [{"role": "user", "content": "x"}]},
            {"model": "jina-search", "messages": []},
        ):
            response = await self.client.post(
                "/v1/chat/completions",
                headers={"Authorization": "Bearer jina-test-key"},
                json=payload,
            )
            self.assertEqual(response.status_code, 400)
        self.assertEqual(self.upstream_requests, [])

    async def test_hides_upstream_error_body(self):
        self.upstream_status = 401
        self.upstream_body = "Authorization: Bearer leaked-secret"
        response = await self.client.post(
            "/v1/chat/completions",
            headers={"Authorization": "Bearer jina-test-key"},
            json={"model": "jina-search", "messages": [{"role": "user", "content": "x"}]},
        )

        self.assertEqual(response.status_code, 502)
        self.assertNotIn("leaked-secret", response.text)

    async def test_translates_upstream_timeout_to_502(self):
        async def timeout_handler(request: httpx.Request):
            raise httpx.ReadTimeout("timed out", request=request)

        await self.upstream.aclose()
        self.upstream = httpx.AsyncClient(transport=httpx.MockTransport(timeout_handler))
        app.state.http = self.upstream
        response = await self.client.post(
            "/v1/chat/completions",
            headers={"Authorization": "Bearer jina-test-key"},
            json={"model": "jina-search", "messages": [{"role": "user", "content": "x"}]},
        )

        self.assertEqual(response.status_code, 502)


if __name__ == "__main__":
    unittest.main()

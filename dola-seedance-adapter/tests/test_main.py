import unittest

import httpx

from src.main import app


class DolaSeedanceAdapterTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.upstream_request = None

        async def upstream(request: httpx.Request):
            self.upstream_request = request
            return httpx.Response(200, json={"code": "1", "task_id": "dola-task-1", "status": "queued"})

        app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://adapter.test")

    async def asyncTearDown(self):
        await self.client.aclose()
        await app.state.http.aclose()

    async def test_text_to_video_still_uses_multipart(self):
        response = await self.client.post(
            "/v1/videos",
            headers={"Authorization": "Bearer key"},
            json={"model": "dola-seedance2.5", "prompt": "animate", "ratio": "9:16"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(self.upstream_request.headers["content-type"].startswith("multipart/form-data; boundary="))
        body = self.upstream_request.content.decode()
        self.assertIn('name="prompt"\r\n\r\nanimate', body)
        self.assertIn('name="ratio"\r\n\r\n9:16', body)
        self.assertIn('name="seconds"\r\n\r\n30', body)


if __name__ == "__main__":
    unittest.main()

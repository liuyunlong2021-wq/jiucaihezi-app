import unittest
from pathlib import Path

import httpx

from src.main import app


class FakeResponse:
    def __init__(self, status_code=200, payload=None, content=b"", headers=None):
        self.status_code = status_code
        self._payload = payload
        self.content = content
        self.headers = headers or {}
        self.is_success = 200 <= status_code < 300

    def json(self):
        return self._payload

    async def aiter_bytes(self):
        yield self.content[:2]
        yield self.content[2:]


class FakeStream:
    def __init__(self, response):
        self.response = response
        self.entered = False
        self.exited = False

    async def __aenter__(self):
        self.entered = True
        return self.response

    async def __aexit__(self, *_args):
        self.exited = True


class FakeHttp:
    def __init__(self):
        self.task_response = FakeResponse(
            payload={"code": "1", "task": {"status": "succeeded", "url": "https://cdn.example.test/task.mp4"}},
        )
        self.stream_response = FakeResponse(content=b"mp4-bytes", headers={"content-type": "video/mp4"})
        self.stream_call = None

    async def get(self, url, headers=None):
        return self.task_response

    def stream(self, method, url, headers=None):
        self.stream_call = (method, url, headers)
        return FakeStream(self.stream_response)


class DolaContentEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.http = FakeHttp()
        app.state.http = self.http
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")

    async def asyncTearDown(self):
        await self.client.aclose()

    async def test_content_requires_bearer_token(self):
        response = await self.client.get("/v1/videos/task_dola_1/content")
        self.assertEqual(response.status_code, 401)
        self.assertIsNone(self.http.stream_call)

    async def test_content_streams_upstream_video_without_forwarding_token(self):
        response = await self.client.get(
            "/v1/videos/task_dola_1/content",
            headers={"Authorization": "Bearer gateway-token"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "video/mp4")
        self.assertEqual(response.content, b"mp4-bytes")
        self.assertEqual(self.http.stream_call, ("GET", "https://cdn.example.test/task.mp4", None))

    async def test_content_rejects_completed_task_without_video_url(self):
        self.http.task_response = FakeResponse(payload={"code": "1", "task": {"status": "succeeded"}})
        response = await self.client.get(
            "/v1/videos/task_dola_1/content",
            headers={"Authorization": "Bearer gateway-token"},
        )
        self.assertEqual(response.status_code, 502)
        self.assertIsNone(self.http.stream_call)


class DolaDeploymentContractTests(unittest.TestCase):
    def test_adapter_listens_on_standard_http_port(self):
        dockerfile = (Path(__file__).parents[1] / "Dockerfile").read_text()
        self.assertIn('--port", "80"', dockerfile)


if __name__ == "__main__":
    unittest.main()

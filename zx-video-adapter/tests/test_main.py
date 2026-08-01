import unittest

import httpx

from src.main import app


class ZxVideoAdapterTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.upstream_requests = []

        async def upstream_handler(request: httpx.Request):
            self.upstream_requests.append(request)
            if request.url.path.endswith("/v1/videos"):
                return httpx.Response(
                    200,
                    json={"id": "task_zx_1", "task_id": "task_zx_1", "status": "processing"},
                )
            return httpx.Response(
                200,
                json={
                    "id": "task_zx_1",
                    "model": "grok-1.5-video-6s",
                    "status": "completed",
                    "progress": 100,
                    "video_url": "https://cdn.example/video.mp4",
                },
            )

        self.upstream = httpx.AsyncClient(transport=httpx.MockTransport(upstream_handler))
        app.state.http = self.upstream
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://adapter.test",
        )

    async def asyncTearDown(self):
        await self.client.aclose()
        await self.upstream.aclose()

    async def test_translates_json_reference_to_zx_multipart_and_polls(self):
        response = await self.client.post(
            "/v1/videos",
            headers={"Authorization": "Bearer zx-test-key"},
            json={
                "model": "grok-1.5-video-6s",
                "prompt": "主体缓慢运动",
                "size": "1280x720",
                "image": "data:image/jpeg;base64,aGVsbG8=",
                "seconds": 6,
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], "task_zx_1")
        create_request = self.upstream_requests[0]
        body = create_request.read()
        self.assertIn(b'name="input_reference"', body)
        self.assertIn(b'name="model"', body)
        self.assertNotIn(b"seconds", body)
        self.assertEqual(create_request.headers["Authorization"], "Bearer zx-test-key")

        response = await self.client.get(
            "/v1/videos/task_zx_1",
            headers={"Authorization": "Bearer zx-test-key"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "completed")
        self.assertEqual(response.json()["video_url"], "https://cdn.example/video.mp4")

    async def test_requires_reference_before_upstream_submission(self):
        response = await self.client.post(
            "/v1/videos",
            headers={"Authorization": "Bearer zx-test-key"},
            json={"model": "grok-1.5-video-10s", "prompt": "主体运动", "size": "1280x720"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.upstream_requests, [])

    async def test_accepts_direct_multipart_reference(self):
        response = await self.client.post(
            "/v1/videos",
            headers={"Authorization": "Bearer zx-test-key"},
            data={
                "model": "grok-1.5-video-15s",
                "prompt": "主体缓慢运动",
                "size": "1280x720",
            },
            files={"input_reference": ("reference.jpg", b"image", "image/jpeg")},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'name="input_reference"', self.upstream_requests[0].read())


if __name__ == "__main__":
    unittest.main()

import json
import unittest

import httpx

from src.main import app


class KikSeedanceAdapterTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.requests = []

        async def upstream(request: httpx.Request):
            self.requests.append(request)
            if request.url.path.endswith("/generations"):
                return httpx.Response(200, json={"task_id": "kik-task-1", "task_status": "pending"})
            return httpx.Response(200, json={"task_id": "kik-task-1", "task_status": "success", "data": [{"url": "https://cdn.example.test/video.mp4"}]})

        app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://adapter.test")

    async def asyncTearDown(self):
        await self.client.aclose()
        await app.state.http.aclose()

    async def test_translates_submit_and_poll(self):
        headers = {"Authorization": "Bearer kik-key"}
        submitted = await self.client.post("/v1/videos", headers=headers, json={
            "model": "doubao-seedance-2-mini",
            "prompt": "A cat looks at the camera.",
            "images": ["https://example.test/cat.png", {"type": "first_frame", "url": "https://example.test/first.png"}],
            "video_url": "https://example.test/ref.mp4",
            "audio_url": "https://example.test/ref.mp3",
            "duration": 4,
            "ratio": "16:9",
            "resolution": "720p",
        })
        self.assertEqual(submitted.status_code, 200)
        self.assertEqual(submitted.json()["status"], "processing")
        upstream_body = json.loads(self.requests[0].read())
        self.assertEqual(upstream_body["image"], [{"type": "reference_image", "url": "https://example.test/cat.png"}, {"type": "first_frame", "url": "https://example.test/first.png"}])
        self.assertEqual(upstream_body["video"], {"type": "reference_video", "url": "https://example.test/ref.mp4"})
        self.assertEqual(upstream_body["audio"], {"type": "reference_audio", "url": "https://example.test/ref.mp3"})
        self.assertEqual(upstream_body["upstream_options"]["duration"], 4.0)
        self.assertEqual(self.requests[0].url.path, "/video/v1/generations")

        completed = await self.client.get("/v1/videos/kik-task-1", headers=headers)
        self.assertEqual(completed.status_code, 200)
        self.assertEqual(completed.json()["status"], "completed")
        self.assertEqual(completed.json()["video_url"], "https://cdn.example.test/video.mp4")
        self.assertEqual(self.requests[1].url.path, "/video/v1/tasks/kik-task-1")

    async def test_rejects_missing_key_and_unknown_model(self):
        no_key = await self.client.post("/v1/videos", json={"model": "doubao-seedance-2-mini", "prompt": "test"})
        self.assertEqual(no_key.status_code, 401)
        unknown = await self.client.post("/v1/videos", headers={"Authorization": "Bearer key"}, json={"model": "other", "prompt": "test"})
        self.assertEqual(unknown.status_code, 400)

    async def test_translates_openai_multimodal_prompt_parts(self):
        response = await self.client.post("/v1/videos", headers={"Authorization": "Bearer key"}, json={
            "model": "doubao-seedance-2-mini",
            "prompt": [
                {"type": "text", "text": "Keep the subject consistent."},
                {"type": "image_url", "image_url": {"url": "https://example.test/frame.png"}},
                {"type": "video_url", "video_url": "https://example.test/ref.mp4"},
                {"type": "audio_url", "audio_url": {"url": "https://example.test/ref.mp3"}},
            ],
        })
        self.assertEqual(response.status_code, 200)
        body = json.loads(self.requests[0].read())
        self.assertEqual(body["prompt"], "Keep the subject consistent.")
        self.assertEqual(body["image"], {"type": "reference_image", "url": "https://example.test/frame.png"})
        self.assertEqual(body["video"], {"type": "reference_video", "url": "https://example.test/ref.mp4"})
        self.assertEqual(body["audio"], {"type": "reference_audio", "url": "https://example.test/ref.mp3"})


if __name__ == "__main__":
    unittest.main()

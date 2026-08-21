import json
import unittest

import httpx

from src.main import app


class XiaoyiImageAdapterTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.requests = []

        async def upstream(request: httpx.Request):
            self.requests.append(request)
            if request.method == "POST" and request.url.path == "/v1/videos":
                return httpx.Response(200, json={"id": "video-task-1", "status": "queued"})
            if request.method == "GET" and request.url.path == "/v1/videos/video-task-1":
                return httpx.Response(200, json={"id": "video-task-1", "status": "completed", "progress": 100})
            if request.method == "GET" and request.url.path == "/v1/videos/video-task-1/content":
                return httpx.Response(200, content=b"video", headers={"content-type": "video/mp4"})
            if request.method == "GET" and request.url.path == "/v1/images/tasks/video-task-1":
                return httpx.Response(404, json={"error": "not found"})
            if request.url.path.endswith("/async"):
                return httpx.Response(200, json={"task_id": "xiaoyi-task-1", "status": "running"})
            if request.url.path.endswith("/xiaoyi-task-running"):
                return httpx.Response(200, json={"status": "running"})
            if request.url.path.endswith("/xiaoyi-task-url"):
                return httpx.Response(200, json={"status": "success", "result": {"data": [{"url": "https://cdn.example.test/result.png"}]}})
            if request.url.path.endswith("/xiaoyi-task-network"):
                raise httpx.ConnectError("temporary failure", request=request)
            if request.url.path.endswith("/xiaoyi-task-rate-limited"):
                return httpx.Response(429, json={"error": "slow down"})
            if request.url.path.endswith("/xiaoyi-task-unavailable"):
                return httpx.Response(503, json={"error": "unavailable"})
            if request.url.path.endswith("/xiaoyi-task-failed"):
                return httpx.Response(200, json={"status": "failed", "error": {"message": "upstream failed"}})
            return httpx.Response(200, json={"status": "success", "result": {"data": [{"b64_json": "aGVsbG8="}]}})

        app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://adapter.test")

    async def asyncTearDown(self):
        await self.client.aclose()
        await app.state.http.aclose()

    async def test_gpt_submit_edit_and_poll(self):
        headers = {"Authorization": "Bearer secret-key"}
        submitted = await self.client.post("/v1/videos", headers=headers, files={"image": ("ref.png", b"png", "image/png")}, data={"model": "gpt-image-2-中质量", "prompt": "edit", "size": "2048x1152", "response_format": "b64_json"})
        self.assertEqual(submitted.json()["status"], "processing")
        self.assertEqual(self.requests[0].url.path, "/v1/images/edits/async")
        self.assertEqual(self.requests[0].headers["authorization"], "Bearer secret-key")
        self.assertIn('name="model"\r\n\r\ngpt-image-2\r\n', self.requests[0].content.decode())
        self.assertIn('name="response_format"\r\n\r\nurl\r\n', self.requests[0].content.decode())
        completed = await self.client.get("/v1/videos/xiaoyi-task-1", headers=headers)
        self.assertEqual(completed.json()["status"], "completed")
        self.assertEqual(completed.json()["metadata"]["url"], "data:image/png;base64,aGVsbG8=")
        self.assertFalse(any(request.url.path == "/v1/videos/xiaoyi-task-1" for request in self.requests))

    async def test_maps_official_alias_to_upstream_gpt_image_2(self):
        response = await self.client.post(
            "/v1/videos",
            headers={"Authorization": "Bearer key"},
            json={"model": "gpt-image-2-官方", "prompt": "draw"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(self.requests[0].content)["model"], "gpt-image-2")

    async def test_minimax_h3_models_use_xiaoyi_video_contract(self):
        headers = {"Authorization": "Bearer key"}
        for model in ["MiniMaxH3-2k-pro-sec", "MiniMaxH3-2k-sec", "MiniMaxH3-720p-sec"]:
            response = await self.client.post("/v1/videos", headers=headers, json={
                "model": model,
                "prompt": "让角色向前行走",
                "duration": 8,
                "aspect_ratio": "16:9",
                "resolution": "2k" if "2k" in model else "720p",
                "images": ["https://example.test/character.png"],
                "video_urls": ["https://example.test/motion.mp4"],
                "audio_urls": ["https://example.test/voice.mp3"],
            })
            self.assertEqual(response.status_code, 200)

        body = json.loads(self.requests[0].content)
        self.assertEqual(self.requests[0].url.path, "/v1/videos")
        self.assertEqual(body["seconds"], "8")
        self.assertEqual(body["aspect_ratio"], "16:9")
        self.assertEqual(body["resolution"], "2k")
        self.assertEqual([item["type"] for item in body["content"]], ["text", "image_url", "video_url", "audio_url"])

        completed = await self.client.get("/v1/videos/video-task-1", headers=headers)
        self.assertEqual(completed.json()["status"], "completed")
        self.assertEqual(completed.json()["metadata"]["url"], "/v1/videos/video-task-1/content")
        content = await self.client.get("/v1/videos/video-task-1/content", headers=headers)
        self.assertEqual(content.content, b"video")
        self.assertEqual(content.headers["content-type"], "video/mp4")

    async def test_minimax_h3_rejects_invalid_duration_ratio_resolution_or_references(self):
        headers = {"Authorization": "Bearer key"}
        base = {"model": "MiniMaxH3-2k-sec", "prompt": "test"}
        cases = [
            {**base, "duration": 4},
            {**base, "duration": 16},
            {**base, "aspect_ratio": "2:3"},
            {**base, "resolution": "720p"},
            {**base, "images": ["https://example.test/ref.png"] * 10},
            {**base, "video_urls": ["https://example.test/ref.mp4"] * 4},
            {**base, "audio_urls": ["https://example.test/ref.mp3"] * 4},
        ]
        for body in cases:
            self.assertEqual((await self.client.post("/v1/videos", headers=headers, json=body)).status_code, 400, body)

    async def test_maps_failed_task(self):
        response = await self.client.get("/v1/videos/xiaoyi-task-failed", headers={"Authorization": "Bearer key"})
        self.assertEqual(response.json()["status"], "failed")
        self.assertEqual(response.json()["error"]["message"], "upstream failed")

    async def test_gemini_keeps_mapped_size(self):
        response = await self.client.post("/v1/videos", headers={"Authorization": "Bearer key"}, json={"model": "gemini-3-pro-image-preview", "prompt": "draw", "size": "2048x1152"})
        self.assertEqual(response.status_code, 200)
        body = json.loads(self.requests[0].content)
        self.assertEqual(body["model"], "gemini-3-pro-image-preview")
        self.assertEqual(body["size"], "2048x1152")

    async def test_accepts_canonical_gpt_model_for_newapi_mapping(self):
        response = await self.client.post(
            "/v1/videos",
            headers={"Authorization": "Bearer key"},
            json={"model": "gpt-image-2", "prompt": "draw"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.requests[0].url.path, "/v1/images/generations/async")
        self.assertEqual(json.loads(self.requests[0].content)["model"], "gpt-image-2")

    async def test_polling_keeps_transient_failures_processing_and_accepts_url_results(self):
        headers = {"Authorization": "Bearer key"}
        for task_id in ["xiaoyi-task-running", "xiaoyi-task-network", "xiaoyi-task-rate-limited", "xiaoyi-task-unavailable"]:
            response = await self.client.get(f"/v1/videos/{task_id}", headers=headers)
            self.assertEqual(response.json()["status"], "processing", task_id)

        completed = await self.client.get("/v1/videos/xiaoyi-task-url", headers=headers)
        self.assertEqual(completed.json()["status"], "completed")
        self.assertEqual(completed.json()["metadata"]["url"], "https://cdn.example.test/result.png")

    async def test_rejects_too_many_or_non_image_uploads(self):
        headers = {"Authorization": "Bearer key"}
        fields = {"model": "gpt-image-2-1k", "prompt": "draw"}
        too_many = [("image", (f"{index}.png", b"png", "image/png")) for index in range(9)]
        self.assertEqual((await self.client.post("/v1/videos", headers=headers, data=fields, files=too_many)).status_code, 413)
        self.assertEqual((await self.client.post("/v1/videos", headers=headers, data=fields, files={"image": ("x.txt", b"text", "text/plain")})).status_code, 400)

    async def test_gemini_accepts_ten_images_and_rejects_oversized_images_or_prompts(self):
        headers = {"Authorization": "Bearer key"}
        fields = {"model": "gemini-3-pro-image-preview", "prompt": "draw"}
        images = [("image", (f"{index}.png", b"png", "image/png")) for index in range(10)]
        self.assertEqual((await self.client.post("/v1/videos", headers=headers, data=fields, files=images)).status_code, 200)
        too_large = b"x" * (10 * 1024 * 1024 + 1)
        self.assertEqual((await self.client.post("/v1/videos", headers=headers, data=fields, files={"image": ("large.png", too_large, "image/png")})).status_code, 413)
        self.assertEqual((await self.client.post("/v1/videos", headers=headers, json={"model": "gemini-3-pro-image-preview", "prompt": "a" * 20_001})).status_code, 400)

    async def test_rejects_missing_key_unknown_model_and_prompt(self):
        self.assertEqual((await self.client.post("/v1/videos", json={"model": "gpt-image-2-1k", "prompt": "x"})).status_code, 401)
        headers = {"Authorization": "Bearer key"}
        self.assertEqual((await self.client.post("/v1/videos", headers=headers, json={"model": "other", "prompt": "x"})).status_code, 400)
        self.assertEqual((await self.client.post("/v1/videos", headers=headers, json={"model": "gpt-image-2-1k", "prompt": " "})).status_code, 400)


if __name__ == "__main__":
    unittest.main()

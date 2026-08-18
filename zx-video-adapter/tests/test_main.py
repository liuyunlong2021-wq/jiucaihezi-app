import json
import unittest

import httpx

from src.main import app


class ZxVideoAdapterTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.upstream_requests = []

        async def upstream_handler(request: httpx.Request):
            self.upstream_requests.append(request)
            if request.url.path.endswith("/content"):
                return httpx.Response(200, content=b"streamed-video", headers={"content-type": "video/mp4"})
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

    async def test_forwards_text_video_as_json(self):
        response = await self.client.post(
            "/v1/videos",
            headers={"Authorization": "Bearer zx-test-key"},
            json={
                "model": "grok-1.5-video-10s",
                "prompt": "主体运动",
                "size": "1280x720",
                "seconds": 10,
            },
        )
        self.assertEqual(response.status_code, 200)
        create_request = self.upstream_requests[0]
        self.assertEqual(create_request.headers["content-type"], "application/json")
        self.assertEqual(
            json.loads(create_request.read()),
            {
                "model": "grok-1.5-video-10s",
                "prompt": "主体运动",
                "resolution": "720p",
            },
        )

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

    async def test_grok_forwards_seven_references_and_rejects_eight(self):
        images = ["data:image/jpeg;base64,aGVsbG8=" for _ in range(7)]
        response = await self.client.post(
            "/v1/videos",
            headers={"Authorization": "Bearer zx-test-key"},
            json={
                "model": "grok-1.5-video-6s",
                "prompt": "融合七张参考图",
                "size": "1280x720",
                "images": images,
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.upstream_requests[0].read().count(b'name="input_reference"'), 7)

        response = await self.client.post(
            "/v1/videos",
            headers={"Authorization": "Bearer zx-test-key"},
            json={
                "model": "grok-1.5-video-6s",
                "prompt": "超过上限",
                "size": "1280x720",
                "images": images + ["data:image/jpeg;base64,aGVsbG84"],
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("7", response.json()["detail"])

    async def test_seedance_builds_metadata_content_and_uses_own_endpoint(self):
        response = await self.client.post(
            "/v1/video/generations",
            headers={"Authorization": "Bearer zx-test-key"},
            json={
                "model": "doubao-seedance-2-5-260628",
                "prompt": "让人物自然移动",
                "duration": 8,
                "aspect_ratio": "9:16",
                "resolution": "720p",
                "images": ["https://cdn.example/ref-1.jpg", "https://cdn.example/ref-2.jpg"],
                "video_urls": ["https://cdn.example/ref-1.mp4", "https://cdn.example/ref-2.mp4"],
                "audio_urls": ["https://cdn.example/ref-1.mp3", "https://cdn.example/ref-2.mp3"],
                "conversion_slots": ["image1", "video1"],
                "return_last_frame": True,
                "real_person_mode": True,
                "bitrate_mode": "high",
                "generate_audio": False,
                "seed": 42,
                "output_format": "mov",
                "omni_reference_task_type": "edit",
                "webhook_url": "https://example.com/hook",
            },
        )
        self.assertEqual(response.status_code, 200)
        request = self.upstream_requests[0]
        self.assertEqual(request.url.path, "/v1/video/generations")
        body = json.loads(request.read())
        self.assertEqual(body["seconds"], "8")
        self.assertEqual(body["metadata"]["ratio"], "9:16")
        self.assertEqual(
            body["metadata"]["content"],
            [
                {"type": "image_url", "role": "reference_image", "image_url": {"url": "https://cdn.example/ref-1.jpg"}},
                {"type": "image_url", "role": "reference_image", "image_url": {"url": "https://cdn.example/ref-2.jpg"}},
                {"type": "video_url", "role": "reference_video", "video_url": {"url": "https://cdn.example/ref-1.mp4"}},
                {"type": "video_url", "role": "reference_video", "video_url": {"url": "https://cdn.example/ref-2.mp4"}},
                {"type": "audio_url", "role": "reference_audio", "audio_url": {"url": "https://cdn.example/ref-1.mp3"}},
                {"type": "audio_url", "role": "reference_audio", "audio_url": {"url": "https://cdn.example/ref-2.mp3"}},
            ],
        )
        self.assertEqual(body["metadata"]["conversion_slots"], ["image1", "video1"])
        self.assertEqual(body["metadata"]["output_format"], "mov")
        self.assertEqual(body["metadata"]["generate_audio"], False)
        self.assertEqual(body["webhook_url"], "https://example.com/hook")

        response = await self.client.post(
            "/v1/video/generations",
            headers={"Authorization": "Bearer zx-test-key"},
            json={"model": "doubao-seedance-2-5-260628", "prompt": "最长时长", "duration": 30},
        )
        self.assertEqual(response.status_code, 200)

    async def test_seedance_accepts_newapi_video_route_and_omits_auto_seconds(self):
        response = await self.client.post(
            "/v1/videos",
            headers={"Authorization": "Bearer zx-test-key"},
            json={
                "model": "doubao-seedance-2-5-260628",
                "prompt": "自动决定时长",
                "duration": -1,
                "resolution": "1080p",
            },
        )

        self.assertEqual(response.status_code, 200)
        request = self.upstream_requests[0]
        self.assertEqual(request.url.path, "/v1/video/generations")
        self.assertNotIn("seconds", json.loads(request.read()))

    async def test_video_poll_falls_back_to_seedance_endpoint(self):
        requests = []

        async def upstream_handler(request: httpx.Request):
            requests.append(request)
            if request.url.path == "/v1/videos/task_seedance_1":
                return httpx.Response(400, json={"detail": "Unsupported ZX Grok video model"})
            return httpx.Response(200, json={
                "id": "task_seedance_1",
                "status": "completed",
                "video_url": "https://cdn.example/seedance.mp4",
            })

        await self.upstream.aclose()
        self.upstream = httpx.AsyncClient(transport=httpx.MockTransport(upstream_handler))
        app.state.http = self.upstream

        response = await self.client.get(
            "/v1/videos/task_seedance_1",
            headers={"Authorization": "Bearer zx-test-key"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["video_url"], "https://cdn.example/seedance.mp4")
        self.assertEqual(
            [request.url.path for request in requests],
            ["/v1/videos/task_seedance_1", "/v1/video/generations/task_seedance_1"],
        )

    async def test_omni_models_forward_their_native_json_fields(self):
        response = await self.client.post(
            "/v1/videos",
            headers={"Authorization": "Bearer zx-test-key"},
            json={
                "model": "omni-fast",
                "prompt": "让画面动起来",
                "aspect_ratio": "16:9",
                "resolution": "720p",
                "images": ["https://cdn.example/ref.jpg"],
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(self.upstream_requests[0].read())["images"], ["https://cdn.example/ref.jpg"])

        response = await self.client.post(
            "/v1/videos",
            headers={"Authorization": "Bearer zx-test-key"},
            json={
                "model": "omni-v2v",
                "prompt": "保持主体并改变镜头运动",
                "video_url": "https://cdn.example/input.mp4",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(self.upstream_requests[1].read())["video_url"], "https://cdn.example/input.mp4")

        response = await self.client.post(
            "/v1/videos",
            headers={"Authorization": "Bearer zx-test-key"},
            json={"model": "omni-v2v", "prompt": "缺少输入视频"},
        )
        self.assertEqual(response.status_code, 400)

    async def test_video_content_is_proxied_as_a_stream(self):
        response = await self.client.get(
            "/v1/videos/task_zx_1/content",
            headers={"Authorization": "Bearer zx-test-key"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "video/mp4")
        self.assertEqual(response.content, b"streamed-video")


if __name__ == "__main__":
    unittest.main()

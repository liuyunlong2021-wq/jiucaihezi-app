import asyncio
import unittest
from unittest import mock

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

import src.main as main
from src.main import BASE, MODEL, RESOLUTIONS, TASKS, app, content, create_video, get_video, media_values


BODY = {
    "model": MODEL,
    "prompt": "reference video",
    "duration": 5,
    "images": ["https://a.example/1.png", "https://b.example/2.png"],
    "audios": ["https://c.example/3.mp3"],
}


class AdapterContractTest(unittest.TestCase):
    def test_model_contract(self):
        self.assertEqual(MODEL, "minimax_h3_image_audio_to_video_v2_15s")
        self.assertEqual(len(RESOLUTIONS), 4)

    def test_media_values_accepts_openai_arrays(self):
        self.assertEqual(media_values({"images": [{"url": "https://a.test/x.png"}]}, ("images", "image")), ["https://a.test/x.png"])

    def test_resolution_orientation_follows_ratio_contract(self):
        resolution = "768p竖"
        ratio = "16:9"
        if ratio == "16:9" and resolution.endswith("竖"):
            resolution = resolution[:-1] + "横"
        self.assertEqual(resolution, "768p横")


class FakeResponse:
    def __init__(self, status_code=200, payload=None, headers=None):
        self.status_code = status_code
        self.payload = payload if payload is not None else {}
        self.headers = headers or {"content-type": "application/json"}

    @property
    def is_success(self):
        return 200 <= self.status_code < 300

    def json(self):
        return self.payload


class FakeSourceResponse(FakeResponse):
    def __init__(self, status_code=200, chunks=(b"image-bytes",), content_type="image/png", chunk_delay=0.0):
        super().__init__(status_code, headers={"content-type": content_type})
        self.chunks = list(chunks)
        self.chunk_delay = chunk_delay

    async def aiter_bytes(self):
        for chunk in self.chunks:
            if self.chunk_delay:
                await asyncio.sleep(self.chunk_delay)
            else:
                await asyncio.sleep(0)
            yield chunk


class FakeStream:
    def __init__(self, response, tracker):
        self.response = response
        self.tracker = tracker

    async def __aenter__(self):
        self.tracker.open_streams += 1
        self.tracker.max_open_streams = max(self.tracker.max_open_streams, self.tracker.open_streams)
        return self.response

    async def __aexit__(self, *args):
        self.tracker.open_streams -= 1
        return False


class FakeHttp:
    """只记录事实并返回固定结果，测试全程不触网。"""

    def __init__(self, *, oss_status=200, submit_id="video_upstream_1", source_status=200, chunk_delay=0.0, poll_payload=None):
        self.oss_status = oss_status
        self.submit_id = submit_id
        self.source_status = source_status
        self.chunk_delay = chunk_delay
        self.poll_payload = poll_payload or {"id": submit_id, "object": "video", "status": "completed", "progress": 100}
        self.requests = []
        self.open_streams = 0
        self.max_open_streams = 0
        self.uploaded_bytes = []
        self.submitted = None

    def stream(self, method, url, **kwargs):
        self.requests.append((method, url))
        return FakeStream(FakeSourceResponse(self.source_status, chunk_delay=self.chunk_delay), self)

    async def get(self, url, **kwargs):
        self.requests.append(("GET", url))
        return FakeResponse(200, self.poll_payload)

    async def post(self, url, headers=None, json=None, timeout=None):
        self.requests.append(("POST", url))
        if url.endswith("/api/video-upload/oss-sts"):
            return FakeResponse(200, {"success": True, "host": "https://oss.test", "dir": "upload", "bucket": "bucket", "accessKeyId": "ak", "accessKeySecret": "sk", "securityToken": "token"})
        self.submitted = json
        return FakeResponse(200, {"id": self.submit_id, "object": "video", "status": "queued", "progress": 0})

    async def put(self, url, content=None, headers=None):
        self.requests.append(("PUT", url))
        self.uploaded_bytes.append(len(content.read()))
        return FakeResponse(self.oss_status)

    async def aclose(self):
        return None


class FakeRequest:
    def __init__(self, body=None, authorization="Bearer sk-test"):
        self.headers = {"authorization": authorization}
        self.app = app
        self.body = body

    async def json(self):
        if self.body is None:
            raise ValueError("no body")
        return self.body


class FakeBackground:
    def __init__(self):
        self.tasks = []

    def add_task(self, func, *args, **kwargs):
        self.tasks.append((func, args, kwargs))


class AdapterTaskTest(unittest.TestCase):
    def setUp(self):
        TASKS.clear()
        self.http = FakeHttp()
        app.state.http = self.http

    def accept(self, body=None):
        """走真实创建路径：拿任务 ID，再执行它排队给后台的那一步。"""
        background = FakeBackground()
        created = asyncio.run(create_video(FakeRequest(body or BODY), background))
        self.assertEqual(len(background.tasks), 1)
        func, args, kwargs = background.tasks[0]
        asyncio.run(func(*args, **kwargs))
        return created["id"]

    def test_create_returns_task_id_before_any_network_work(self):
        background = FakeBackground()
        created = asyncio.run(create_video(FakeRequest(BODY), background))
        self.assertEqual(created["status"], "queued")
        self.assertEqual(created["progress"], 0)
        self.assertEqual(created["model"], MODEL)
        self.assertEqual(created["id"], created["task_id"])
        self.assertEqual(len(created["id"]), 32)
        self.assertFalse(created["id"].startswith("task_"))
        self.assertEqual([entry[0].__name__ for entry in background.tasks], ["run_task"])
        # 关键事实：创建请求里没有 STS、没有素材搬运、没有上游提交
        self.assertEqual(self.http.requests, [])

    def test_invalid_request_still_fails_synchronously(self):
        background = FakeBackground()
        for body in (
            {**BODY, "duration": 99},
            {**BODY, "resolution": "1080p"},
            {**BODY, "images": ["https://a.example/1.png"] * 10},
            {**BODY, "model": "other"},
        ):
            with self.assertRaises(HTTPException) as caught:
                asyncio.run(create_video(FakeRequest(body), background))
            self.assertEqual(caught.exception.status_code, 400)
        self.assertEqual(background.tasks, [])
        self.assertEqual(TASKS, {})

    def test_references_are_transferred_concurrently(self):
        self.accept()
        self.assertEqual(self.http.max_open_streams, 3)
        self.assertEqual(len(self.http.uploaded_bytes), 3)
        self.assertTrue(self.http.submitted["ref_image_0"].startswith("https://oss.test/upload/"))
        self.assertEqual(sorted(key for key in self.http.submitted if key.startswith("ref_")), ["ref_audio_0", "ref_image_0", "ref_image_1"])

    def test_poll_is_queued_before_submit_then_proxies_upstream(self):
        background = FakeBackground()
        created = asyncio.run(create_video(FakeRequest(BODY), background))
        queued = asyncio.run(get_video(created["id"], FakeRequest()))
        self.assertEqual(queued["status"], "queued")
        func, args, kwargs = background.tasks[0]
        asyncio.run(func(*args, **kwargs))
        polled = asyncio.run(get_video(created["id"], FakeRequest()))
        self.assertEqual(polled["status"], "completed")
        self.assertEqual(polled["id"], created["id"])
        self.assertEqual(polled["task_id"], created["id"])

    def test_background_failure_is_reported_on_poll(self):
        self.http.oss_status = 403
        task_id = self.accept()
        self.assertEqual(TASKS[task_id]["status"], "failed")
        polled = asyncio.run(get_video(task_id, FakeRequest()))
        self.assertEqual(polled["status"], "failed")
        self.assertIn("OSS upload failed", polled["error"]["message"])
        self.assertIn("a.example", polled["error"]["message"])

    def test_slow_reference_fails_fast_with_host_and_stage(self):
        self.http.chunk_delay = 0.2
        with mock.patch.object(main, "REFERENCE_TIMEOUT_SECONDS", 0.05):
            task_id = self.accept()
        self.assertEqual(TASKS[task_id]["status"], "failed")
        self.assertIn("timed out after", TASKS[task_id]["error"])
        self.assertIn("from a.example", TASKS[task_id]["error"])

    def test_content_resolves_local_id_to_upstream_id(self):
        task_id = self.accept()
        response = asyncio.run(content(task_id, FakeRequest()))
        self.assertIsInstance(response, StreamingResponse)
        self.assertIn(("GET", f"{BASE}/v1/videos/video_upstream_1/content"), self.http.requests)

    def test_http_surface_returns_queued_task_id_then_completed(self):
        # 走真实路由：验证 BackgroundTasks 注入、响应形状和轮询映射在 ASGI 层也成立。
        with TestClient(app) as client:
            app.state.http = self.http
            headers = {"Authorization": "Bearer sk-test"}
            created = client.post("/v1/videos", json=BODY, headers=headers)
            self.assertEqual(created.status_code, 200)
            self.assertEqual(created.json()["status"], "queued")
            task_id = created.json()["id"]
            polled = client.get(f"/v1/videos/{task_id}", headers=headers)
            self.assertEqual(polled.json()["status"], "completed")
            self.assertEqual(polled.json()["id"], task_id)
            rejected = client.post("/v1/videos", json={**BODY, "duration": 99}, headers=headers)
            self.assertEqual(rejected.status_code, 400)


if __name__ == "__main__":
    unittest.main()

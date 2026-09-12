import asyncio
import unittest
from unittest import mock

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

import src.main as main
from src.main import BASE, MODEL, MODELS, TASKS, ZM_U24, app, content, create_video, get_video, media_values, resolve_resolution, resolution_axis


BODY = {
    "model": MODEL,
    "prompt": "reference video",
    "duration": 5,
    "images": ["https://api.jiucaihezi.studio/media/creation/aaaabbbbccccddddeeeeffff00001111"],
    "audios": ["https://api.jiucaihezi.studio/media/creation/11112222333344445555ffff00001111"],
}


class AdapterContractTest(unittest.TestCase):
    def test_model_contract(self):
        self.assertEqual(MODEL, "minimax_h3_image_audio_to_video_v2_15s")
        self.assertEqual(ZM_U24, "minimax_h3_zm_u24")
        self.assertEqual(sorted(MODELS), ["minimax_h3_image_audio_to_video_v2_15s", "minimax_h3_zm_u24"])
        self.assertEqual(len(MODELS[MODEL]["resolutions"]), 4)
        self.assertEqual(len(MODELS[ZM_U24]["resolutions"]), 6)
        # 1:1 只有增强版支持，别把它的枚举放宽给旧模型
        self.assertNotIn("768p(1:1)", MODELS[MODEL]["resolutions"])
        self.assertEqual(MODELS[MODEL]["default_duration"], 15)
        self.assertEqual(MODELS[ZM_U24]["default_duration"], 5)

    def test_media_values_accepts_openai_arrays(self):
        self.assertEqual(media_values({"images": [{"url": "https://a.test/x.png"}]}, ("images", "image")), ["https://a.test/x.png"])

    def test_media_values_still_requires_a_url(self):
        # 透传的前提是调用方已经换好 URL，非 URL 一律 400，不猜不转存
        for bad in ("data:image/png;base64,AAAA", "/tmp/x.png", "ftp://a.test/x.png"):
            with self.assertRaises(HTTPException) as caught:
                media_values({"images": [bad]}, ("images", "image"))
            self.assertEqual(caught.exception.status_code, 400)

    def test_resolution_carries_the_orientation(self):
        self.assertEqual(resolution_axis("768p竖"), "9:16")
        self.assertEqual(resolution_axis("480p横"), "16:9")
        self.assertEqual(resolution_axis("768p(1:1)"), "1:1")
        self.assertEqual(resolution_axis("768p"), "")

    def test_resolution_wins_and_conflicting_ratio_is_rejected(self):
        spec = MODELS[MODEL]
        # 只传分辨率：原样透传
        self.assertEqual(resolve_resolution(spec, {"resolution": "480p横"}, MODEL), "480p横")
        # 比例与分辨率一致：通过
        self.assertEqual(
            resolve_resolution(spec, {"resolution": "768p竖", "aspect_ratio": "9:16"}, MODEL),
            "768p竖",
        )
        # 比例与分辨率矛盾：不静默换画幅，直接 400
        with self.assertRaises(HTTPException) as caught:
            resolve_resolution(spec, {"resolution": "768p竖", "aspect_ratio": "16:9"}, MODEL)
        self.assertEqual(caught.exception.status_code, 400)
        self.assertIn("conflicts", caught.exception.detail)

    def test_ratio_only_requests_derive_the_default_resolution(self):
        spec = MODELS[ZM_U24]
        self.assertEqual(resolve_resolution(spec, {"aspect_ratio": "16:9"}, ZM_U24), "768p横")
        self.assertEqual(resolve_resolution(spec, {"aspect_ratio": "1:1"}, ZM_U24), "768p(1:1)")
        self.assertEqual(resolve_resolution(spec, {}, ZM_U24), "768p竖")
        # 旧模型不支持 1:1，推导出来的名字不在白名单里
        with self.assertRaises(HTTPException) as caught:
            resolve_resolution(MODELS[MODEL], {"aspect_ratio": "1:1"}, MODEL)
        self.assertEqual(caught.exception.status_code, 400)


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

    async def aiter_bytes(self):
        yield b"video"


class FakeHttp:
    """只记录事实并返回固定结果，测试全程不触网。

    参考素材**不应该**产生任何额外的 GET/PUT：URL 是原样透传给菠萝的。
    """

    def __init__(self, *, submit_id="video_upstream_1", submit_status=200, submit_payload=None, poll_payload=None):
        self.submit_id = submit_id
        self.submit_status = submit_status
        self.submit_payload = submit_payload
        self.poll_payload = poll_payload or {"id": submit_id, "object": "video", "status": "completed", "progress": 100}
        self.requests = []
        self.submitted = None

    async def get(self, url, **kwargs):
        self.requests.append(("GET", url))
        return FakeResponse(200, self.poll_payload)

    def stream(self, method, url, **kwargs):
        self.requests.append((method, url))
        return FakeStream(FakeResponse(200, headers={"content-type": "video/mp4"}))

    async def post(self, url, headers=None, json=None, timeout=None):
        self.requests.append(("POST", url))
        self.submitted = json
        if self.submit_payload is not None:
            return FakeResponse(self.submit_status, self.submit_payload)
        if not 200 <= self.submit_status < 300:
            return FakeResponse(self.submit_status, {"message": "upstream rejected"})
        return FakeResponse(200, {"id": self.submit_id, "object": "video", "status": "queued", "progress": 0})

    async def aclose(self):
        return None


class FakeStream:
    def __init__(self, response):
        self.response = response

    async def __aenter__(self):
        return self.response

    async def __aexit__(self, *args):
        return False


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
        # 关键事实：创建请求里没有任何网络调用
        self.assertEqual(self.http.requests, [])

    def test_invalid_request_still_fails_synchronously(self):
        background = FakeBackground()
        for body in (
            {**BODY, "duration": 99},
            {**BODY, "resolution": "1080p"},
            {**BODY, "images": ["https://a.example/1.png"] * 10},
            {**BODY, "audios": ["https://a.example/1.mp3"] * 4},
            {**BODY, "model": "other"},
            {**BODY, "seed": -1},
        ):
            with self.assertRaises(HTTPException) as caught:
                asyncio.run(create_video(FakeRequest(body), background))
            self.assertEqual(caught.exception.status_code, 400)
        self.assertEqual(background.tasks, [])
        self.assertEqual(TASKS, {})

    def test_unknown_model_error_echoes_what_was_received(self):
        background = FakeBackground()
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(create_video(FakeRequest({**BODY, "model": "minimax_h3_zm_u2"}), background))
        self.assertEqual(caught.exception.status_code, 400)
        # NewAPI 渠道映射写错时靠这条定位
        self.assertIn("minimax_h3_zm_u2", caught.exception.detail)
        self.assertIn("minimax_h3_zm_u24", caught.exception.detail)

    def test_references_are_passed_through_verbatim(self):
        """核心合同：参考素材原样透传，不下载、不转存、不重传。"""
        self.accept()
        self.assertEqual(
            self.http.submitted["ref_image_0"],
            "https://api.jiucaihezi.studio/media/creation/aaaabbbbccccddddeeeeffff00001111",
        )
        self.assertEqual(
            self.http.submitted["ref_audio_0"],
            "https://api.jiucaihezi.studio/media/creation/11112222333344445555ffff00001111",
        )
        self.assertEqual(sorted(key for key in self.http.submitted if key.startswith("ref_")), ["ref_audio_0", "ref_image_0"])
        # 只允许一次上游提交，没有任何 STS / OSS / 素材下载
        self.assertEqual(self.http.requests, [("POST", f"{BASE}/v1/videos")])

    def test_multiple_references_keep_their_order_and_zero_based_indexes(self):
        self.accept({
            **BODY,
            "images": [f"https://api.jiucaihezi.studio/media/creation/{index:032x}" for index in range(3)],
            "audios": [f"https://api.jiucaihezi.studio/media/creation/{index:032x}" for index in range(1)],
        })
        for index in range(3):
            self.assertEqual(self.http.submitted[f"ref_image_{index}"], f"https://api.jiucaihezi.studio/media/creation/{index:032x}")
        self.assertEqual(self.http.submitted["ref_audio_0"], "https://api.jiucaihezi.studio/media/creation/00000000000000000000000000000000")

    def test_duration_missing_or_null_falls_back_to_the_model_default(self):
        self.accept({**BODY, "duration": None})
        self.assertEqual(self.http.submitted["duration"], 15)
        self.accept({"model": ZM_U24, "prompt": "x"})
        self.assertEqual(self.http.submitted["duration"], 5)

    def test_enhanced_model_takes_square_resolution_and_its_own_default_duration(self):
        background = FakeBackground()
        created = asyncio.run(create_video(FakeRequest({
            "model": ZM_U24,
            "prompt": "square",
            "resolution": "768p(1:1)",
            "images": ["https://a.example/1.png"],
        }), background))
        func, args, kwargs = background.tasks[0]
        asyncio.run(func(*args, **kwargs))
        self.assertEqual(self.http.submitted["model"], ZM_U24)
        self.assertEqual(self.http.submitted["resolution"], "768p(1:1)")
        self.assertEqual(self.http.submitted["duration"], 5)
        self.assertEqual(created["model"], ZM_U24)

    def test_seed_is_forwarded_and_validated(self):
        self.accept({**BODY, "seed": 42})
        self.assertEqual(self.http.submitted["seed"], 42)
        background = FakeBackground()
        for seed in (1.5, True, "7"):
            with self.assertRaises(HTTPException) as caught:
                asyncio.run(create_video(FakeRequest({**BODY, "seed": seed}), background))
            self.assertEqual(caught.exception.status_code, 400)
        self.assertEqual(background.tasks, [])

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

    def test_upstream_submit_failure_is_reported_on_poll(self):
        self.http.submit_status = 403
        task_id = self.accept()
        self.assertEqual(TASKS[task_id]["status"], "failed")
        polled = asyncio.run(get_video(task_id, FakeRequest()))
        self.assertEqual(polled["status"], "failed")
        self.assertIn("upstream rejected", polled["error"]["message"])

    def test_upstream_without_task_id_is_reported_on_poll(self):
        self.http.submit_payload = {"object": "video", "status": "queued"}
        task_id = self.accept()
        self.assertEqual(TASKS[task_id]["status"], "failed")
        self.assertIn("did not return a task ID", TASKS[task_id]["error"])

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
            self.assertEqual(created.json()["model"], MODEL)
            task_id = created.json()["id"]
            polled = client.get(f"/v1/videos/{task_id}", headers=headers)
            self.assertEqual(polled.json()["status"], "completed")
            self.assertEqual(polled.json()["id"], task_id)
            listed = client.get("/v1/models", headers=headers)
            self.assertEqual({item["id"] for item in listed.json()["data"]}, {MODEL, ZM_U24})
            rejected = client.post("/v1/videos", json={**BODY, "duration": 99}, headers=headers)
            self.assertEqual(rejected.status_code, 400)

    def test_routed_payload_never_contains_the_local_task_table(self):
        """回归钉子：一旦有人把 SDK/文件对象之类塞回请求体，这里就会炸。"""
        self.accept()
        for key, value in self.http.submitted.items():
            self.assertNotIsInstance(value, TASKS.__class__, key)
            self.assertNotIn(key, ("media", "payload", "upstream", "key"))

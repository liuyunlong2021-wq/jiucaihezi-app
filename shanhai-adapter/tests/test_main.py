import json
import unittest

import httpx

from src.main import app


class ShanhaiAdapterTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.requests = []

        async def upstream(request: httpx.Request):
            self.requests.append(request)
            path = request.url.path
            if request.method == "POST":
                return httpx.Response(
                    202,
                    json={
                        "id": "run_aaa",
                        "object": "generation",
                        "status": "queued",
                        "model": "shanhai-dola-seedance-v2-5-30-9-0-7",
                        "usage": {"credits": 12},
                    },
                )
            if path.endswith("/tasks/run_aaa"):
                return httpx.Response(
                    200,
                    json={
                        "id": "run_aaa",
                        "object": "generation",
                        "status": "succeeded",
                        "model": "shanhai-dola-seedance-v2-5-30-9-0-7",
                        "output": {
                            "url": "https://shanhai.vnshu.cn/api/v1/media/runs/run_aaa",
                            "mime_type": "video/mp4",
                            "type": "video",
                        },
                    },
                )
            if path.endswith("/tasks/run_fail"):
                return httpx.Response(
                    200,
                    json={
                        "id": "run_fail",
                        "status": "failed",
                        "model": "oc-model-r5cfh8",
                        "error": {"code": "upstream_error", "message": "素材地址不可访问"},
                    },
                )
            if path.endswith("/media/runs/run_aaa"):
                return httpx.Response(
                    206,
                    headers={"content-type": "video/mp4", "content-range": "bytes 0-3/8"},
                    content=b"RIFF",
                )
            return httpx.Response(404, json={"error": {"code": "not_found", "message": "missing"}})

        app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://adapter.test"
        )

    async def asyncTearDown(self):
        await self.client.aclose()
        await app.state.http.aclose()

    async def test_submits_video_with_references_and_options(self):
        response = await self.client.post(
            "/v1/videos",
            headers={"Authorization": "Bearer oc_live_channel"},
            json={
                "model": "shanhai-dola-seedance-v2-5-30-9-0-7",
                "prompt": "让参考图里的主体自然运动",
                "images": ["https://cdn.example.test/a.png", {"url": "https://cdn.example.test/b.png"}],
                "ratio": "16:9",
                "resolution": "720p",
                "duration": 30,
                "response_format": "url",
            },
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "processing")
        self.assertEqual(body["id"], "run_aaa")
        self.assertEqual(body["object"], "video")

        self.assertEqual(self.requests[0].headers["authorization"], "Bearer oc_live_channel")
        self.assertEqual(
            self.requests[0].url.path, "/api/v1/generations"
        )
        self.assertEqual(
            json.loads(self.requests[0].read()),
            {
                "model": "shanhai-dola-seedance-v2-5-30-9-0-7",
                "prompt": "让参考图里的主体自然运动",
                "media_type": "video",
                "inputs": [
                    {"type": "image", "url": "https://cdn.example.test/a.png"},
                    {"type": "image", "url": "https://cdn.example.test/b.png"},
                ],
                "options": {"aspect_ratio": "16:9", "resolution": "720p", "duration": "30"},
            },
        )

    async def test_video_model_drops_auto_ratio_and_keeps_resolution(self):
        response = await self.client.post(
            "/v1/videos",
            headers={"Authorization": "Bearer oc_live_channel"},
            json={
                "model": "oc-model-r5cfh8",
                "prompt": "海边的黄昏",
                "aspect_ratio": "auto",
                "resolution": "720p",
                "seconds": 30,
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["object"], "video")
        self.assertEqual(
            json.loads(self.requests[0].read()),
            {
                "model": "oc-model-r5cfh8",
                "prompt": "海边的黄昏",
                "media_type": "video",
                "options": {"resolution": "720p", "duration": "30"},
            },
        )

    async def test_accepts_the_newapi_public_alias_and_submits_the_upstream_id(self):
        response = await self.client.post(
            "/v1/videos",
            headers={"Authorization": "Bearer oc_live_channel"},
            json={
                "model": "海seedance2.5",
                "prompt": "海边的黄昏",
                "ratio": "16:9",
                "duration": 30,
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["model"], "海seedance2.5")
        # 面板发的是渠道公开名；无论 NewAPI 的模型映射有没有生效，山海只收上游 id。
        self.assertEqual(json.loads(self.requests[0].read())["model"], "oc-model-r5cfh8")

    async def test_poll_returns_relative_content_path_for_authenticated_download(self):
        response = await self.client.get(
            "/v1/videos/run_aaa", headers={"Authorization": "Bearer oc_live_channel"}
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "completed")
        self.assertEqual(body["progress"], 100)
        self.assertEqual(body["video_url"], "/v1/videos/run_aaa/content")

    async def test_poll_reports_upstream_failure_message(self):
        response = await self.client.get(
            "/v1/videos/run_fail", headers={"Authorization": "Bearer oc_live_channel"}
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "failed")
        self.assertEqual(body["error"]["message"], "素材地址不可访问")

    async def test_poll_keeps_the_task_alive_on_upstream_5xx_and_logs_the_reason(self):
        async def failing(request: httpx.Request):
            return httpx.Response(
                500, json={"error": {"code": "internal_error", "message": "任务不存在"}}
            )

        app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(failing))
        with self.assertLogs("shanhai_adapter", level="WARNING") as captured:
            response = await self.client.get(
                "/v1/videos/run_unknown",
                headers={"Authorization": "Bearer oc_live_channel"},
            )
        # 上游 5xx 是瞬时故障：回 5xx 会被调用方判成任务失败，所以只能报「处理中」。
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "processing")
        joined = "\n".join(captured.output)
        self.assertIn("任务不存在", joined)
        self.assertIn("status=500", joined)

    async def test_poll_keeps_the_task_alive_when_the_upstream_times_out(self):
        async def hanging(request: httpx.Request):
            raise httpx.ReadTimeout("shanghai status endpoint did not answer")

        app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(hanging))
        with self.assertLogs("shanhai_adapter", level="WARNING") as captured:
            response = await self.client.get(
                "/v1/videos/run_slow",
                headers={"Authorization": "Bearer oc_live_channel"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "processing")
        self.assertIn("ReadTimeout", "\n".join(captured.output))

    async def test_poll_propagates_a_real_upstream_404(self):
        async def missing(request: httpx.Request):
            return httpx.Response(
                404, json={"error": {"code": "not_found", "message": "任务不存在"}}
            )

        app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(missing))
        response = await self.client.get(
            "/v1/videos/run_missing", headers={"Authorization": "Bearer oc_live_channel"}
        )
        # 4xx 是确定的负面结论（id 不对 / Key 失效），不该被当成瞬时故障。
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"]["message"], "任务不存在")

    async def test_content_proxy_forwards_range_and_key(self):
        response = await self.client.get(
            "/v1/videos/run_aaa/content",
            headers={"Authorization": "Bearer oc_live_channel", "Range": "bytes=0-3"},
        )
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.content, b"RIFF")
        self.assertEqual(response.headers["content-range"], "bytes 0-3/8")
        self.assertEqual(self.requests[0].headers["authorization"], "Bearer oc_live_channel")
        self.assertEqual(self.requests[0].headers["range"], "bytes=0-3")
        self.assertEqual(self.requests[0].url.path, "/api/v1/media/runs/run_aaa")

    async def test_poll_and_content_reuse_the_channel_key_from_submit(self):
        await self.client.post(
            "/v1/videos",
            headers={"Authorization": "Bearer oc_live_channel"},
            json={"model": "oc-model-r5cfh8", "prompt": "hi"},
        )
        # NewAPI 的工作台 Key 不是山海的 Key：轮询和成片下载必须回到建单时那枚渠道 Key。
        await self.client.get(
            "/v1/videos/run_aaa", headers={"Authorization": "Bearer sk-workbench"}
        )
        self.assertEqual(self.requests[-1].headers["authorization"], "Bearer oc_live_channel")

        response = await self.client.get(
            "/v1/videos/run_aaa/content", headers={"Authorization": "Bearer sk-workbench"}
        )
        self.assertEqual(response.status_code, 206)
        self.assertEqual(self.requests[-1].headers["authorization"], "Bearer oc_live_channel")

    async def test_rejects_unregistered_models_audio_references_and_missing_key(self):
        # 图片模型和 sd-2.0 官渠本轮没接，必须报错而不是静默走错线路。
        for model in ("shanhai-image-2", "oc-model-1iq31f"):
            rejected = await self.client.post(
                "/v1/videos",
                headers={"Authorization": "Bearer oc_live_channel"},
                json={"model": model, "prompt": "hi"},
            )
            self.assertEqual(rejected.status_code, 400)

        audio = await self.client.post(
            "/v1/videos",
            headers={"Authorization": "Bearer oc_live_channel"},
            json={
                "model": "oc-model-r5cfh8",
                "prompt": "hi",
                "audios": ["https://cdn.example.test/a.mp3"],
            },
        )
        self.assertEqual(audio.status_code, 422)

        unauthorized = await self.client.post(
            "/v1/videos", json={"model": "oc-model-r5cfh8", "prompt": "hi"}
        )
        self.assertEqual(unauthorized.status_code, 401)

    async def test_forwards_upstream_error_status_and_message(self):
        async def failing(request: httpx.Request):
            return httpx.Response(
                422, json={"error": {"code": "invalid_request", "message": "参考图数量超限"}}
            )

        app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(failing))
        response = await self.client.post(
            "/v1/videos",
            headers={"Authorization": "Bearer oc_live_channel"},
            json={"model": "oc-model-r5cfh8", "prompt": "hi"},
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["message"], "参考图数量超限")


if __name__ == "__main__":
    unittest.main()

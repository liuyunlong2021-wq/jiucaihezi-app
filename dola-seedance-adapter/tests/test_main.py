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

    async def use_upstream(self, handler):
        await app.state.http.aclose()
        app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))

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

    async def test_non_json_upstream_response_reports_upstream_status(self):
        await self.use_upstream(lambda request: httpx.Response(502, text="<html>Bad Gateway</html>"))

        response = await self.client.post(
            "/v1/videos",
            headers={"Authorization": "Bearer key"},
            json={"model": "dola-seedance2.5", "prompt": "animate", "ratio": "16:9"},
        )

        self.assertEqual(response.status_code, 502)
        self.assertIn("invalid JSON (502)", response.json()["detail"])

    async def test_non_object_upstream_body_reports_upstream_status(self):
        await self.use_upstream(lambda request: httpx.Response(200, json=["unexpected"]))

        response = await self.client.get("/v1/videos/dola-task-1", headers={"Authorization": "Bearer key"})

        self.assertEqual(response.status_code, 502)
        self.assertIn("invalid response (200)", response.json()["detail"])

    # 上游 2026-09-19 起：「1」= 请求被正常处理，排队中/生成中也是「1」。旧代码拿
    # code 推断任务状态，会把这两种情况判成 502「Inconsistent Dola task response」。
    async def test_processing_with_code_one_is_not_an_error(self):
        await self.use_upstream(
            lambda request: httpx.Response(
                200,
                json={
                    "code": "1",
                    "status": "processing",
                    "task": {"status": "processing", "charged_points": 1, "billing_state": "charged"},
                },
            )
        )

        response = await self.client.get("/v1/videos/dola-task-1", headers={"Authorization": "Bearer key"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "processing")

    async def test_failed_with_code_one_returns_error_and_no_video_url(self):
        await self.use_upstream(
            lambda request: httpx.Response(
                200,
                json={
                    "code": "1",
                    "status": "failed",
                    "error": "任务失败请重试",
                    "billing_state": "refunded",
                    "task": {"status": "failed", "billing_state": "refunded"},
                },
            )
        )

        response = await self.client.get("/v1/videos/dola-task-1", headers={"Authorization": "Bearer key"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "failed")
        self.assertEqual(response.json()["error"], "任务失败请重试")
        self.assertNotIn("video_url", response.json())

    async def test_succeeded_reads_top_level_url(self):
        await self.use_upstream(
            lambda request: httpx.Response(
                200,
                json={"code": "1", "status": "succeeded", "url": "https://media.example.com/a.mp4", "task": {"status": "succeeded"}},
            )
        )

        response = await self.client.get("/v1/videos/dola-task-1", headers={"Authorization": "Bearer key"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "completed")
        self.assertEqual(response.json()["video_url"], "https://media.example.com/a.mp4")

    async def test_code_zero_is_an_error(self):
        await self.use_upstream(lambda request: httpx.Response(200, json={"code": "0", "message": "令牌无效或已禁用"}))

        response = await self.client.get("/v1/videos/dola-task-1", headers={"Authorization": "Bearer key"})

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["detail"], "令牌无效或已禁用")

    async def test_limits_match_upstream(self):
        over_prompt = await self.client.post(
            "/v1/videos",
            headers={"Authorization": "Bearer key"},
            json={"model": "dola-seedance2.5", "prompt": "x" * 8001, "ratio": "16:9"},
        )
        self.assertEqual(over_prompt.status_code, 400)
        self.assertIn("1-8000", over_prompt.json()["detail"])

        over_images = await self.client.post(
            "/v1/videos",
            headers={"Authorization": "Bearer key"},
            json={
                "model": "dola-seedance2.5",
                "prompt": "animate",
                "ratio": "16:9",
                "images": [f"https://example.com/{index}.jpg" for index in range(10)],
            },
        )
        self.assertEqual(over_images.status_code, 400)
        self.assertIn("9 images", over_images.json()["detail"])


if __name__ == "__main__":
    unittest.main()

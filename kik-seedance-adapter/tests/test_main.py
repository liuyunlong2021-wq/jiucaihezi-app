import asyncio
import json
import logging
import unittest
from unittest.mock import patch

import httpx

from src.main import KIK_HTTP_TIMEOUT, app


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

    async def test_translates_policy_violation_to_failed(self):
        async def policy_violation(_: httpx.Request):
            return httpx.Response(200, json={
                "task_id": "kik-task-policy",
                "status": "OutputVideoSensitiveContentDetected.PolicyViolation",
                "message": "The request failed because the output video may be related to copyright restrictions.",
            })

        await app.state.http.aclose()
        app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(policy_violation))
        response = await self.client.get(
            "/v1/videos/kik-task-policy",
            headers={"Authorization": "Bearer key"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "failed")
        self.assertIn("copyright restrictions", response.json()["error"]["message"])

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

    def test_uses_120_second_operation_timeout_and_10_second_connect_timeout(self):
        self.assertEqual(KIK_HTTP_TIMEOUT.connect, 10.0)
        self.assertEqual(KIK_HTTP_TIMEOUT.read, 120.0)
        self.assertEqual(KIK_HTTP_TIMEOUT.write, 120.0)
        self.assertEqual(KIK_HTTP_TIMEOUT.pool, 120.0)

    async def test_allows_text_only_and_each_optional_reference_type(self):
        headers = {"Authorization": "Bearer key"}
        cases = [
            ({}, set()),
            ({"images": ["https://example.test/ref.png"]}, {"image"}),
            ({"video_url": "https://example.test/ref.mp4"}, {"video"}),
            ({"audio_url": "https://example.test/ref.mp3"}, {"audio"}),
        ]

        for references, expected_media_keys in cases:
            response = await self.client.post("/v1/videos", headers=headers, json={
                "model": "doubao-seedance-2-mini",
                "prompt": "test",
                **references,
            })
            self.assertEqual(response.status_code, 200)
            body = json.loads(self.requests[-1].read())
            self.assertEqual({key for key in ("image", "video", "audio") if key in body}, expected_media_keys)

    async def test_enforces_a_total_submit_deadline(self):
        attempts = 0

        async def slow(request: httpx.Request):
            nonlocal attempts
            attempts += 1
            await asyncio.sleep(0.02)
            return httpx.Response(200, json={"task_id": "too-late"})

        await app.state.http.aclose()
        app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(slow))
        with patch("src.main.KIK_TOTAL_TIMEOUT_SECONDS", 0.001):
            with self.assertLogs("kik_seedance_adapter", logging.WARNING) as captured:
                response = await self.client.post("/v1/videos", headers={"Authorization": "Bearer key"}, json={
                    "model": "doubao-seedance-2-mini",
                    "prompt": "test",
                })

        self.assertEqual(response.status_code, 502)
        self.assertEqual(attempts, 1)
        self.assertIn("TimeoutError", "\n".join(captured.output))

    async def test_submit_timeout_logs_type_and_elapsed_without_request_secrets(self):
        secret_key = "secret-kik-key"
        secret_prompt = "private launch prompt"
        secret_url = "https://private.example.test/reference.png"
        secret_video_url = "https://private.example.test/reference.mp4"
        secret_audio_url = "https://private.example.test/reference.mp3"
        attempts = 0

        async def timeout(request: httpx.Request):
            nonlocal attempts
            attempts += 1
            raise httpx.ReadTimeout("upstream read timed out", request=request)

        await app.state.http.aclose()
        app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(timeout))
        with self.assertLogs("kik_seedance_adapter", logging.WARNING) as captured:
            response = await self.client.post("/v1/videos", headers={"Authorization": f"Bearer {secret_key}"}, json={
                "model": "doubao-seedance-2-mini",
                "prompt": secret_prompt,
                "images": [secret_url],
                "video_url": secret_video_url,
                "audio_url": secret_audio_url,
            })

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["error"]["message"], "KIK video service is unavailable")
        self.assertEqual(attempts, 1)
        logs = "\n".join(captured.output)
        self.assertIn("ReadTimeout", logs)
        self.assertRegex(logs, r"elapsed=\d+\.\d{3}s")
        self.assertNotIn(secret_key, logs)
        self.assertNotIn(secret_prompt, logs)
        self.assertNotIn(secret_url, logs)
        self.assertNotIn(secret_video_url, logs)
        self.assertNotIn(secret_audio_url, logs)


if __name__ == "__main__":
    unittest.main()

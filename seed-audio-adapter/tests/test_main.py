import base64
import json
import unittest

import httpx

from src.main import MAX_REFERENCE_DATA_CHARS, app


class SeedAudioAdapterTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.upstream_requests = []

        async def upstream_handler(request: httpx.Request):
            self.upstream_requests.append(request)
            return httpx.Response(
                200,
                headers={"X-Tt-Logid": "log-1"},
                json={
                    "code": 0,
                    "message": "success",
                    "data": {
                        "audio": base64.b64encode(b"mp3-data").decode(),
                        "duration": 1.0,
                        "url": "https://example.invalid/audio.mp3",
                    },
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

    async def test_translates_openai_speech_and_returns_audio(self):
        response = await self.client.post(
            "/v1/audio/speech",
            headers={"Authorization": "Bearer speech-key"},
            json={
                "model": "seed-audio-1.0",
                "input": "请自然地说：测试成功。",
                "voice": "alloy",
                "response_format": "mp3",
                "metadata": {"image_url": "https://example.invalid/reference.png"},
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"mp3-data")
        self.assertEqual(response.headers["content-type"], "audio/mpeg")
        upstream = self.upstream_requests[0]
        self.assertEqual(upstream.headers["X-Api-Key"], "speech-key")
        self.assertEqual(
            json.loads(upstream.read()),
            {
                "model": "seed-audio-1.0",
                "text_prompt": "请自然地说：测试成功。",
                "audio_config": {"format": "mp3", "sample_rate": 24000},
                "watermark": {},
                "image_url": "https://example.invalid/reference.png",
            },
        )

        invalid = await self.client.post(
            "/v1/audio/speech",
            json={"model": "seed-audio-1.0", "input": "test"},
        )
        self.assertEqual(invalid.status_code, 401)

        audio = await self.client.post(
            "/v1/audio/speech",
            headers={"Authorization": "Bearer speech-key"},
            json={
                "model": "seed-audio-1.0",
                "input": "模仿参考音频的音色。",
                "metadata": {"audio_url": "https://example.invalid/reference.mp3"},
            },
        )
        self.assertEqual(audio.status_code, 200)
        self.assertEqual(json.loads(self.upstream_requests[1].read())["audio_url"], "https://example.invalid/reference.mp3")

        conflict = await self.client.post(
            "/v1/audio/speech",
            headers={"Authorization": "Bearer speech-key"},
            json={
                "model": "seed-audio-1.0",
                "input": "不能同时使用图片和音频。",
                "metadata": {
                    "image_url": "https://example.invalid/reference.png",
                    "audio_url": "https://example.invalid/reference.mp3",
                },
            },
        )
        self.assertEqual(conflict.status_code, 400)

        oversized = await self.client.post(
            "/v1/audio/speech",
            headers={"Authorization": "Bearer speech-key"},
            json={
                "model": "seed-audio-1.0",
                "input": "参考资源过大。",
                "metadata": {"image_data": "A" * (MAX_REFERENCE_DATA_CHARS + 1)},
            },
        )
        self.assertEqual(oversized.status_code, 400)


if __name__ == "__main__":
    unittest.main()

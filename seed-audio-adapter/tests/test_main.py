import base64
import json
import unittest

import httpx

from src.main import app


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
            },
        )

        invalid = await self.client.post(
            "/v1/audio/speech",
            json={"model": "seed-audio-1.0", "input": "test"},
        )
        self.assertEqual(invalid.status_code, 401)


if __name__ == "__main__":
    unittest.main()

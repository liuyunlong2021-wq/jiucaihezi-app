"""Tests: official capabilities-driven standard payload builder."""

import pytest

from src.services.standard_payload import build_standard_payload
from src.services.rh_client import RHError


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def json(self):
        return self.payload


class FakeClient:
    def __init__(self):
        self.calls = []

    async def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return FakeResponse({"code": 0, "data": {"download_url": "https://rh.example/upload.png"}})


@pytest.mark.asyncio
async def test_seedance_image_video_maps_ordered_images_to_official_frame_keys():
    client = FakeClient()

    payload = await build_standard_payload(
        client,
        "rh_key",
        "rhart-video/sparkvideo-2.0/image-to-video",
        {
            "prompt": "move",
            "images": [
                "data:image/png;base64,ZmFrZQ==",
                "data:image/png;base64,ZmFrZQ==",
            ],
            "duration": 8,
            "ratio": "16:9",
        },
    )

    assert payload["firstFrameUrl"] == "https://rh.example/upload.png"
    assert payload["lastFrameUrl"] == "https://rh.example/upload.png"
    assert payload["duration"] == "8"
    assert payload["ratio"] == "16:9"
    assert set(payload).issuperset({"firstFrameUrl", "lastFrameUrl"})
    assert "imageUrls" not in payload
    assert "image" not in payload


@pytest.mark.asyncio
async def test_standard_payload_rejects_values_outside_official_options():
    client = FakeClient()

    with pytest.raises(RHError, match="Invalid RunningHub parameter duration=5"):
        await build_standard_payload(
            client,
            "rh_key",
            "rhart-video-v3.1-fast/text-to-video",
            {
                "prompt": "move",
                "duration": 5,
                "aspectRatio": "16:9",
                "resolution": "720p",
            },
        )


@pytest.mark.asyncio
async def test_speech_payload_uses_official_text_and_voice_id_keys():
    client = FakeClient()

    payload = await build_standard_payload(
        client,
        "rh_key",
        "rhart-audio/text-to-audio/speech-2.8-hd",
        {
            "prompt": "你好",
            "voice_id": "Wise_Woman",
            "language": "中文",
        },
    )

    assert payload["text"] == "你好"
    assert payload["voice_id"] == "Wise_Woman"
    assert "prompt" not in payload
    assert "voice" not in payload
    assert "language" not in payload

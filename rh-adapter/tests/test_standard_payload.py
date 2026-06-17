"""Tests: official capabilities-driven standard payload builder."""

import pytest

from src.models.schemas import ImageRequest
from src.services.image import _aspect_ratio_from_size
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
async def test_z_image_turbo_payload_uses_official_lora_fields():
    client = FakeClient()

    payload = await build_standard_payload(
        client,
        "rh_key",
        "rhart-image/z-image/turbo-lora",
        {
            "prompt": "一张品牌海报",
            "aspect_ratio": "9:16",
            "lora": "Z-Image _ 清纯高颜值_脸模版V1.0.safetensors",
            "lora_strength": 1,
            "outputFormat": "png",
            "size": "2048x2048",
        },
    )

    assert payload == {
        "prompt": "一张品牌海报",
        "aspectRatio": "9:16",
        "lora": "Z-Image _ 清纯高颜值_脸模版V1.0.safetensors",
        "lora_strength": 1.0,
        "outputFormat": "png",
    }
    assert "size" not in payload


def test_image_request_accepts_aspect_ratio_aliases():
    request = ImageRequest.model_validate({
        "model": "z-image-turbo",
        "prompt": "一张品牌海报",
        "aspectRatio": "9:16",
        "outputFormat": "png",
    })

    assert request.aspect_ratio == "9:16"
    assert request.output_format == "png"


def test_image_request_accepts_rh_fields_from_extra_fields():
    request = ImageRequest.model_validate({
        "model": "z-image-turbo",
        "prompt": "一张品牌海报",
        "extra_fields": {
            "aspectRatio": "9:16",
            "resolution": "1k",
            "lora": "Z-Image _ 清纯高颜值_脸模版V1.0.safetensors",
            "lora_strength": 1,
            "outputFormat": "png",
        },
    })

    assert request.aspect_ratio == "9:16"
    assert request.resolution == "1k"
    assert request.lora == "Z-Image _ 清纯高颜值_脸模版V1.0.safetensors"
    assert request.lora_strength == 1
    assert request.output_format == "png"


def test_aspect_ratio_falls_back_from_size():
    assert _aspect_ratio_from_size("2160x3840") == "9:16"
    assert _aspect_ratio_from_size("2048x1152") == "16:9"
    assert _aspect_ratio_from_size("2048x2048") == "1:1"


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

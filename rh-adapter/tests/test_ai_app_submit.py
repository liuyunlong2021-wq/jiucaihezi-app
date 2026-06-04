"""Tests: AI App official protocol behavior."""

import pytest

from src.config import RH_AI_APP_NODE_INFO, RH_AI_APP_UPLOAD, RH_STANDARD_UPLOAD
import src.models.mapping as mapping
from src.models.schemas import AudioRequest, ImageRequest, VideoRequest
from src.services.ai_app import apply_ai_app_inputs, fetch_ai_app_node_info
from src.services.rh_client import RHError, maybe_upload, submit_ai_app
from src.services.audio import generate_audio
from src.services.image import generate_image
from src.services.video import generate_video


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
        if url == RH_AI_APP_UPLOAD:
            return FakeResponse({"code": 0, "msg": "success", "data": {"fileName": "input_123.png"}})
        if url == RH_STANDARD_UPLOAD:
            return FakeResponse({"code": 0, "data": {"download_url": "https://rh.example/upload.png"}})
        return FakeResponse({"code": 0, "data": {"taskId": "task_123"}})

    async def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if url == RH_AI_APP_NODE_INFO:
            return FakeResponse({
                "code": 0,
                "data": {
                    "nodeInfoList": [
                        {"nodeId": "52", "fieldName": "prompt", "fieldType": "STRING", "fieldValue": "old"},
                        {"nodeId": "39", "fieldName": "image", "fieldType": "IMAGE", "fieldValue": "old.png"},
                        {"nodeId": "61", "fieldName": "duration", "fieldType": "INT", "fieldValue": "5"},
                        {"nodeId": "62", "fieldName": "ratio", "fieldType": "LIST", "fieldValue": "1:1"},
                        {"nodeId": "63", "fieldName": "size", "fieldType": "LIST", "fieldValue": "1024x1024"},
                    ],
                },
            })
        return FakeResponse({"code": 404, "msg": "missing"})


class VideoAudioNodeInfoClient(FakeClient):
    async def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if url == RH_AI_APP_NODE_INFO:
            return FakeResponse({
                "code": 0,
                "data": {
                    "nodeInfoList": [
                        {"nodeId": "52", "fieldName": "prompt", "fieldType": "STRING", "fieldValue": "old"},
                        {"nodeId": "71", "fieldName": "video", "fieldType": "VIDEO", "fieldValue": "old.mp4"},
                        {"nodeId": "72", "fieldName": "audio", "fieldType": "AUDIO", "fieldValue": "old.wav"},
                        {"nodeId": "73", "fieldName": "duration", "fieldType": "INT", "fieldValue": "5"},
                    ],
                },
            })
        return FakeResponse({"code": 404, "msg": "missing"})


class EmptyNodeInfoClient(FakeClient):
    async def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if url == RH_AI_APP_NODE_INFO:
            return FakeResponse({"code": 0, "data": {"nodeInfoList": []}})
        return FakeResponse({"code": 404, "msg": "missing"})


class PromptOnlyNodeInfoClient(FakeClient):
    async def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if url == RH_AI_APP_NODE_INFO:
            return FakeResponse({
                "code": 0,
                "data": {
                    "nodeInfoList": [
                        {"nodeId": "52", "fieldName": "prompt", "fieldType": "STRING", "fieldValue": "old"},
                    ],
                },
            })
        return FakeResponse({"code": 404, "msg": "missing"})


@pytest.mark.asyncio
async def test_submit_ai_app_sends_webapp_id_field():
    client = FakeClient()

    task_id = await submit_ai_app(
        client,
        "rh_key",
        "2034917373414539273",
        [{"nodeId": "prompt", "fieldName": "text", "fieldValue": "test"}],
    )

    assert task_id == "task_123"
    payload = client.calls[0][1]["json"]
    assert payload["webappId"] == 2034917373414539273
    assert "workflowId" not in payload
    assert payload["apiKey"] == "rh_key"


@pytest.mark.asyncio
async def test_ai_app_upload_returns_filename_token():
    client = FakeClient()
    value = await maybe_upload(
        client,
        "rh_key",
        "data:image/png;base64,ZmFrZQ==",
        mode="ai_app",
    )

    assert value == "input_123.png"
    url, kwargs = client.calls[0]
    assert url == RH_AI_APP_UPLOAD
    assert kwargs["data"]["apiKey"] == "rh_key"
    assert kwargs["data"]["fileType"] == "input"


@pytest.mark.asyncio
async def test_standard_upload_returns_download_url():
    client = FakeClient()
    value = await maybe_upload(
        client,
        "rh_key",
        "data:image/png;base64,ZmFrZQ==",
        mode="standard",
        force=True,
    )

    assert value == "https://rh.example/upload.png"
    url, kwargs = client.calls[0]
    assert url == RH_STANDARD_UPLOAD
    assert kwargs["headers"]["Authorization"] == "Bearer rh_key"


@pytest.mark.asyncio
async def test_standard_video_uses_official_image_urls_field():
    client = FakeClient()

    result = await generate_video(
        client,
        request=VideoRequest(
            model="rh-grok-image-video",
            prompt="move",
            images=["data:image/png;base64,ZmFrZQ=="],
            ratio="16:9",
        ),
        api_key="rh_key",
    )

    assert result == {"task_id": "task_123", "status": "processing"}
    submit_url, submit_kwargs = client.calls[-1]
    assert submit_url.endswith("/openapi/v2/rhart-video-g/image-to-video")
    payload = submit_kwargs["json"]
    assert payload["imageUrls"] == ["https://rh.example/upload.png"]
    assert "image" not in payload


@pytest.mark.asyncio
async def test_ai_app_image_node_info_list_uploads_data_url_media_values():
    client = FakeClient()

    result = await generate_image(
        client,
        request=ImageRequest(
            model="rh-gpt2-image",
            prompt="move",
            nodeInfoList=[
                {"nodeId": "39", "fieldName": "image", "fieldValue": "data:image/png;base64,ZmFrZQ=="},
                {"nodeId": "52", "fieldName": "prompt", "fieldValue": "move"},
            ],
        ),
        api_key="rh_key",
    )

    assert result == {"task_id": "task_123", "status": "processing", "ai_app": True}
    submit_payload = client.calls[-1][1]["json"]
    assert submit_payload["nodeInfoList"][0]["fieldValue"] == "input_123.png"
    assert submit_payload["nodeInfoList"][1]["fieldValue"] == "move"


@pytest.mark.asyncio
async def test_standard_seedance_image_video_uses_first_and_last_frame_urls():
    client = FakeClient()

    result = await generate_video(
        client,
        request=VideoRequest(
            model="rh-seedance2-image-video",
            prompt="seedance prompt",
            images=[
                "data:image/png;base64,ZmFrZQ==",
                "data:image/png;base64,ZmFrZQ==",
            ],
            duration=8,
            ratio="16:9",
        ),
        api_key="rh_key",
    )

    assert result == {"task_id": "task_123", "status": "processing"}
    submit_payload = client.calls[-1][1]["json"]
    assert "firstFrameUrl" in submit_payload
    assert "lastFrameUrl" in submit_payload
    assert submit_payload["firstFrameUrl"] == "https://rh.example/upload.png"
    assert submit_payload["lastFrameUrl"] == "https://rh.example/upload.png"
    assert submit_payload["duration"] == "8"
    assert submit_payload["ratio"] == "16:9"
    assert "imageUrls" not in submit_payload
    assert "image" not in submit_payload


@pytest.mark.asyncio
async def test_standard_seedance_multimodal_uses_official_media_arrays():
    client = FakeClient()

    result = await generate_video(
        client,
        request=VideoRequest(
            model="rh-seedance2-multimodal-video",
            prompt="multimodal prompt",
            images=["data:image/png;base64,ZmFrZQ=="],
            video="data:video/mp4;base64,ZmFrZQ==",
            audio="data:audio/wav;base64,ZmFrZQ==",
            duration=5,
        ),
        api_key="rh_key",
    )

    assert result == {"task_id": "task_123", "status": "processing"}
    submit_payload = client.calls[-1][1]["json"]
    assert submit_payload["imageUrls"] == ["https://rh.example/upload.png"]
    assert submit_payload["videoUrls"] == ["https://rh.example/upload.png"]
    assert submit_payload["audioUrls"] == ["https://rh.example/upload.png"]
    assert "video" not in submit_payload
    assert "audio" not in submit_payload


@pytest.mark.asyncio
async def test_ai_app_image_discovers_nodes_before_default_submit():
    client = FakeClient()

    result = await generate_image(
        client,
        request=ImageRequest(
            model="rh-gpt2-image",
            prompt="image prompt",
            images=["data:image/png;base64,ZmFrZQ=="],
            size="1024x1024",
        ),
        api_key="rh_key",
    )

    assert result == {"task_id": "task_123", "status": "processing", "ai_app": True}
    assert client.calls[0][0] == RH_AI_APP_NODE_INFO
    submit_payload = client.calls[-1][1]["json"]
    assert submit_payload["nodeInfoList"][0]["fieldValue"] == "image prompt"
    assert submit_payload["nodeInfoList"][1]["fieldValue"] == "input_123.png"
    assert submit_payload["nodeInfoList"][4]["fieldValue"] == "1024x1024"


@pytest.mark.asyncio
async def test_ai_app_image_does_not_fallback_to_guessed_nodes_when_discovery_is_empty():
    client = EmptyNodeInfoClient()

    with pytest.raises(RHError, match="no modifiable nodeInfoList"):
        await generate_image(
            client,
            request=ImageRequest(
                model="rh-gpt2-image",
                prompt="image prompt",
                images=["data:image/png;base64,ZmFrZQ=="],
            ),
            api_key="rh_key",
        )

    assert client.calls[0][0] == RH_AI_APP_NODE_INFO
    assert not any(call[0].endswith("/task/openapi/ai-app/run") for call in client.calls)


@pytest.mark.asyncio
async def test_ai_app_image_rejects_unmatched_user_inputs_instead_of_guessing_nodes():
    client = PromptOnlyNodeInfoClient()

    with pytest.raises(RHError, match="image x1"):
        await generate_image(
            client,
            request=ImageRequest(
                model="rh-gpt2-image",
                prompt="image prompt",
                images=["data:image/png;base64,ZmFrZQ=="],
            ),
            api_key="rh_key",
        )

    assert client.calls[0][0] == RH_AI_APP_NODE_INFO
    assert not any(call[0].endswith("/task/openapi/ai-app/run") for call in client.calls)


@pytest.mark.asyncio
async def test_custom_video_ai_app_model_uses_registered_webapp_and_node_discovery(monkeypatch):
    monkeypatch.setitem(mapping.MODEL_MAP, "rh-custom-video", {
        "endpoint": None,
        "label": "Custom Video",
        "output_type": "video",
        "webapp_id": "123456789",
        "custom": True,
    })
    client = VideoAudioNodeInfoClient()

    result = await generate_video(
        client,
        request=VideoRequest(
            model="rh-custom-video",
            prompt="custom prompt",
            video="data:video/mp4;base64,ZmFrZQ==",
            audio="data:audio/wav;base64,ZmFrZQ==",
            duration=8,
        ),
        api_key="rh_key",
    )

    assert result == {"task_id": "task_123", "status": "processing", "ai_app": True}
    assert client.calls[0][0] == RH_AI_APP_NODE_INFO
    assert client.calls[0][1]["params"] == {"apiKey": "rh_key", "webappId": "123456789"}
    submit_payload = client.calls[-1][1]["json"]
    assert submit_payload["webappId"] == 123456789
    assert submit_payload["nodeInfoList"][0]["fieldValue"] == "custom prompt"
    assert submit_payload["nodeInfoList"][1]["fieldValue"] == "input_123.png"
    assert submit_payload["nodeInfoList"][2]["fieldValue"] == "input_123.png"
    assert submit_payload["nodeInfoList"][3]["fieldValue"] == "8"


@pytest.mark.asyncio
async def test_custom_audio_ai_app_model_uses_registered_webapp_and_node_discovery(monkeypatch):
    monkeypatch.setitem(mapping.MODEL_MAP, "rh-custom-audio", {
        "endpoint": None,
        "label": "Custom Audio",
        "output_type": "audio",
        "webapp_id": "987654321",
        "custom": True,
    })
    client = VideoAudioNodeInfoClient()

    result = await generate_audio(
        client,
        request=AudioRequest(
            model="rh-custom-audio",
            prompt="custom audio",
            audio="data:audio/wav;base64,ZmFrZQ==",
        ),
        api_key="rh_key",
    )

    assert result == {"task_id": "task_123", "status": "processing", "ai_app": True}
    assert client.calls[0][0] == RH_AI_APP_NODE_INFO
    assert client.calls[0][1]["params"] == {"apiKey": "rh_key", "webappId": "987654321"}
    submit_payload = client.calls[-1][1]["json"]
    assert submit_payload["webappId"] == 987654321
    assert submit_payload["nodeInfoList"][0]["fieldValue"] == "custom audio"
    assert submit_payload["nodeInfoList"][2]["fieldValue"] == "input_123.png"


@pytest.mark.asyncio
async def test_fetch_ai_app_node_info_uses_official_api_call_demo():
    client = FakeClient()

    nodes = await fetch_ai_app_node_info(client, "rh_key", "2034917373414539273")

    assert nodes[0]["nodeId"] == "52"
    url, kwargs = client.calls[0]
    assert url == RH_AI_APP_NODE_INFO
    assert kwargs["params"] == {"apiKey": "rh_key", "webappId": "2034917373414539273"}


@pytest.mark.asyncio
async def test_apply_ai_app_inputs_fills_discovered_nodes_and_uploads_images():
    client = FakeClient()
    nodes = await fetch_ai_app_node_info(client, "rh_key", "2034917373414539273")

    resolved = await apply_ai_app_inputs(
        client,
        "rh_key",
        nodes,
        prompt="new prompt",
        images=["data:image/png;base64,ZmFrZQ=="],
        duration=8,
        ratio="16:9",
    )

    assert resolved[0]["fieldValue"] == "new prompt"
    assert resolved[1]["fieldValue"] == "input_123.png"
    assert resolved[2]["fieldValue"] == "8"
    assert resolved[3]["fieldValue"] == "16:9"

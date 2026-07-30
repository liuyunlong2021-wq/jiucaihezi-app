import pytest

from src.models.mapping import MODEL_MAP, get_ai_app_directory, get_rh_site, matches_ai_app_registration
from src.services.rh_client import (
    decode_task_id,
    encode_task_id,
    submit_task,
    upload_file,
)


class FakeResponse:
    def __init__(self, data):
        self._data = data

    def json(self):
        return self._data


class FakeClient:
    def __init__(self):
        self.calls = []

    async def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if "/media/upload/binary" in url:
            return FakeResponse({"code": 0, "data": {"url": "https://cdn.example/file.png"}})
        return FakeResponse({"code": 0, "data": {"taskId": "task-1"}})


def test_model_mapping_routes_only_confirmed_grok_image_video_to_global():
    assert get_rh_site("rh-grok-image-video") == "global"
    assert get_rh_site("rh-grok-text-video") == "cn"
    assert "rh-grok-video-edit" not in MODEL_MAP
    assert "rh-sora2-realistic" not in MODEL_MAP


def test_global_task_id_survives_adapter_restart_without_memory():
    encoded = encode_task_id("task-1", "global")
    assert decode_task_id(encoded) == ("task-1", "global")
    assert decode_task_id("task-2") == ("task-2", "cn")


def test_ai_app_directory_has_trusted_output_and_billing_contracts():
    apps = get_ai_app_directory()
    assert apps
    assert all(set(app) == {"webappId", "label", "outputType", "billingModel"} for app in apps)
    assert all(app["outputType"] in {"image", "audio", "video"} for app in apps)
    app = apps[0]
    assert matches_ai_app_registration(app["webappId"], app["billingModel"])
    assert not matches_ai_app_registration(app["webappId"], "wrong-billing-model")


@pytest.mark.asyncio
async def test_global_submit_and_upload_use_the_same_site():
    client = FakeClient()

    task = await submit_task(client, "global-key", "demo/video", {"prompt": "hello"}, site="global")
    uploaded = await upload_file(client, "global-key", b"png", site="global")

    assert task["taskId"] == "task-1"
    assert uploaded == "https://cdn.example/file.png"
    assert client.calls[0][0] == "https://www.runninghub.ai/openapi/v2/demo/video"
    assert client.calls[1][0] == "https://www.runninghub.ai/openapi/v2/media/upload/binary"

"""Tests: AI App media nodes must receive fileName tokens, never raw URLs.

RunningHub 的 AI 应用媒体节点只接受 /task/openapi/upload 返回的 fileName 令牌，
公网 URL 与内联 data URI 都由适配器换算成令牌；标准接口路径维持原样透传。
"""

import pytest

from src.config import RH_AI_APP_UPLOAD
from src.services.ai_app import apply_ai_app_inputs
from src.services.rh_client import RHError, maybe_upload

PUBLIC_URL = "https://example.com/ref.png"
DATA_URI = "data:image/png;base64,ZmFrZQ=="
RH_TOKEN = "131f540182728f9f1b96d720e1c649ebd3bccbd158f7b70f3bca079c456c7285.jpg"
IMAGE_BYTES = b"\x89PNG\r\n\x1a\n" + b"z" * 512


class MediaResponse:
    """既有 FakeResponse 只有 json()，媒体抓取还要 content / headers / raise_for_status。"""

    def __init__(self, payload=None, *, content=b"", headers=None, status=200):
        self.payload = payload
        self.content = content
        self.headers = headers or {}
        self.status_code = status

    def json(self):
        return self.payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class MediaClient:
    def __init__(self, *, download_status=200, content_type="image/png"):
        self.download_status = download_status
        self.content_type = content_type
        self.fetched = []
        self.uploads = []

    async def get(self, url, **kwargs):
        self.fetched.append(url)
        if self.download_status >= 400:
            return MediaResponse(status=self.download_status)
        headers = {"content-type": self.content_type} if self.content_type else {}
        return MediaResponse(content=IMAGE_BYTES, headers=headers)

    async def post(self, url, **kwargs):
        assert url == RH_AI_APP_UPLOAD
        self.uploads.append(kwargs)
        return MediaResponse({"code": 0, "msg": "success", "data": {"fileName": f"openapi/up{len(self.uploads)}.png"}})


RATIO_NODE = {
    "nodeId": "29",
    "fieldName": "aspect_ratio",
    "fieldType": "LIST",
    "fieldValue": "1:1 (Square)",
    "fieldData": '["COMBO", {"options": ["1:1 (Square)", "9:16 (Portrait Widescreen)", "16:9 (Widescreen)"]}]',
}

WORKFLOW_NODES = [
    {"nodeId": "6", "fieldName": "image", "fieldType": "IMAGE", "fieldValue": "None"},
    RATIO_NODE,
    {"nodeId": "7", "fieldName": "duration", "fieldType": "INT", "fieldValue": "5"},
    {"nodeId": "134", "fieldName": "text", "fieldType": "STRING", "fieldValue": ""},
]


async def test_ai_app_public_url_is_downloaded_then_uploaded():
    client = MediaClient()

    token = await maybe_upload(client, "rh_key", PUBLIC_URL, mode="ai_app")

    assert token == "openapi/up1.png"
    assert client.fetched == [PUBLIC_URL]
    assert client.uploads[0]["data"]["fileType"] == "input"


async def test_ai_app_data_uri_still_uploads_directly():
    client = MediaClient()

    token = await maybe_upload(client, "rh_key", DATA_URI, mode="ai_app")

    assert token == "openapi/up1.png"
    assert client.fetched == []


async def test_standard_mode_keeps_url_untouched():
    client = MediaClient()

    assert await maybe_upload(client, "rh_key", PUBLIC_URL, mode="standard") == PUBLIC_URL
    assert client.fetched == [] and client.uploads == []


async def test_ai_app_token_and_none_are_passed_through():
    client = MediaClient()

    assert await maybe_upload(client, "rh_key", RH_TOKEN, mode="ai_app") == RH_TOKEN
    assert await maybe_upload(client, "rh_key", "None", mode="ai_app") == "None"
    assert client.fetched == [] and client.uploads == []


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/secret.png",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.5/secret.png",
        "http://192.168.1.7/secret.png",
    ],
)
async def test_ai_app_rejects_non_public_urls(url):
    client = MediaClient()

    with pytest.raises(RHError) as error:
        await maybe_upload(client, "rh_key", url, mode="ai_app")

    assert error.value.code == 400
    assert client.fetched == []


async def test_ai_app_download_failure_is_not_silently_passed_through():
    client = MediaClient(download_status=404)

    with pytest.raises(RHError) as error:
        await maybe_upload(client, "rh_key", PUBLIC_URL, mode="ai_app")

    assert error.value.code == 502


async def test_ai_app_missing_content_type_falls_back_to_extension():
    client = MediaClient(content_type="")

    assert await maybe_upload(client, "rh_key", "https://example.com/photo.jpg", mode="ai_app") == "openapi/up1.png"


async def test_apply_ai_app_inputs_resolves_canvas_style_request():
    """下游画布：图片是公网 URL、比例是短式。"""
    client = MediaClient()

    resolved = await apply_ai_app_inputs(
        client,
        "rh_key",
        WORKFLOW_NODES,
        prompt="一只猫在雨里走",
        images=[PUBLIC_URL],
        duration=5,
        ratio="9:16",
    )
    values = {node["nodeId"]: node["fieldValue"] for node in resolved}

    assert values["6"] == "openapi/up1.png"
    assert values["29"] == "9:16 (Portrait Widescreen)"
    assert values["7"] == "5"
    assert values["134"] == "一只猫在雨里走"


async def test_apply_ai_app_inputs_keeps_panel_style_request_working():
    """创作面板：图片是 data URI、比例已经是工作流里的长串。"""
    client = MediaClient()

    resolved = await apply_ai_app_inputs(
        client,
        "rh_key",
        WORKFLOW_NODES,
        images=[DATA_URI],
        ratio="9:16 (Portrait Widescreen)",
    )
    values = {node["nodeId"]: node["fieldValue"] for node in resolved}

    assert values["6"] == "openapi/up1.png"
    assert values["29"] == "9:16 (Portrait Widescreen)"
    assert client.fetched == []


async def test_apply_ai_app_inputs_leaves_ratio_alone_when_not_in_options():
    client = MediaClient()

    resolved = await apply_ai_app_inputs(client, "rh_key", WORKFLOW_NODES, ratio="7:5")
    values = {node["nodeId"]: node["fieldValue"] for node in resolved}

    assert values["29"] == "7:5"

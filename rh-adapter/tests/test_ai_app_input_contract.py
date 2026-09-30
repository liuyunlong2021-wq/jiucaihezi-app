"""Video AI app requests must not silently inherit saved demo inputs."""
import pytest

from src.models.schemas import VideoRequest
from src.services.video import generate_video
from src.services.rh_client import RHError
from tests.test_ai_app_submit import FakeClient


NODES = [
    {"nodeId": "52", "fieldName": "prompt", "fieldValue": "arm wrestling"},
    {"nodeId": "39", "fieldName": "image", "fieldValue": "None"},
    {"nodeId": "61", "fieldName": "duration", "fieldValue": "3"},
    {"nodeId": "62", "fieldName": "ratio", "fieldValue": "9:16"},
    {"nodeId": "63", "fieldName": "size", "fieldValue": "1024x1024"},
]
APP_ID = "2101840271142117377"


@pytest.fixture(autouse=True)
def isolate_whitelist(monkeypatch):
    monkeypatch.setattr("src.config.RH_AI_APP_WHITELIST", set())


@pytest.mark.asyncio
@pytest.mark.parametrize("extra", [{}, {"webappId": APP_ID}])
async def test_missing_contract_never_submits(extra):
    client = FakeClient()
    with pytest.raises(RHError) as error:
        await generate_video(client, VideoRequest(model="rh-aiapp", prompt="arm wrestling", **extra), api_key="test")
    assert error.value.code == 400
    assert not client.calls


@pytest.mark.asyncio
async def test_task_dto_metadata_preserves_complete_nodes():
    # TaskSubmitReq-compatible shape: no custom top-level fields survive.
    request = VideoRequest.model_validate({
        "model": "rh-aiapp", "prompt": "arm wrestling", "duration": 3,
        "metadata": {"rh_aiapp": {"version": 1, "webappId": APP_ID, "nodeInfoList": NODES}},
    })
    client = FakeClient()
    await generate_video(client, request, api_key="test")
    submitted = client.calls[-1][1]["json"]
    values = {n["nodeId"]: n["fieldValue"] for n in submitted["nodeInfoList"]}
    assert values == {"52": "arm wrestling", "39": "None", "61": "3", "62": "9:16", "63": "1024x1024"}
    assert submitted["webappId"] == int(APP_ID)


@pytest.mark.asyncio
@pytest.mark.parametrize("nodes", [NODES[:-1], NODES + [NODES[0]], [{**NODES[0], "nodeId": "999"}] + NODES[1:]])
async def test_partial_stale_or_duplicate_nodes_never_submit(nodes):
    client = FakeClient()
    with pytest.raises(RHError) as error:
        await generate_video(client, VideoRequest(model="rh-aiapp", webappId=APP_ID, nodeInfoList=nodes), api_key="test")
    assert error.value.code == 400
    assert len(client.calls) == 1  # Discovery only; no paid generation.


@pytest.mark.asyncio
async def test_explicit_media_url_uploads_once_and_does_not_revert_to_url(monkeypatch):
    uploaded = []

    async def fake_upload(client, api_key, value, **kwargs):
        uploaded.append(value)
        return "uploaded-reference.png"

    monkeypatch.setattr("src.services.ai_app.maybe_upload", fake_upload)
    nodes = [dict(n) for n in NODES]
    nodes[1]["fieldValue"] = "https://cdn.example.test/selected.png"
    client = FakeClient()
    await generate_video(client, VideoRequest(
        model="rh-aiapp", webappId=APP_ID, nodeInfoList=nodes,
        images=[nodes[1]["fieldValue"]], duration=3,
    ), api_key="test")
    assert uploaded == [nodes[1]["fieldValue"]]
    submitted = client.calls[-1][1]["json"]["nodeInfoList"]
    assert submitted[1]["fieldValue"] == "uploaded-reference.png"


@pytest.mark.asyncio
async def test_prompt_starting_with_url_is_not_uploaded(monkeypatch):
    async def unexpected_upload(*args, **kwargs):
        pytest.fail("Prompt text must not be uploaded as media")

    monkeypatch.setattr("src.services.ai_app.maybe_upload", unexpected_upload)
    nodes = [dict(n) for n in NODES]
    nodes[0]["fieldValue"] = "https://example.test is the setting for this scene"
    client = FakeClient()
    await generate_video(client, VideoRequest(
        model="rh-aiapp", webappId=APP_ID, nodeInfoList=nodes,
    ), api_key="test")
    assert client.calls[-1][1]["json"]["nodeInfoList"][0]["fieldValue"] == nodes[0]["fieldValue"]

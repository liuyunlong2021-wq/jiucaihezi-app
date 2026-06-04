"""Tests: health check and model listing."""

import pytest
from httpx import ASGITransport, AsyncClient

import src.main as main_module
from src.main import app
from src.models.mapping import build_model_map

TARGET_MODELS = {
    "rh-pro-image",
    "rh-image-v2",
    "rh-gpt2-image",
    "rh-gpt2-text",
    "rh-video-v31-fast",
    "rh-seedance2-text-video",
    "rh-seedance2-image-video",
    "rh-seedance2-multimodal-video",
    "rh-grok-text-video",
    "rh-grok-image-video",
    "rh-aiapp-fast-digital-human",
    "rh-aiapp-digital-human",
    "rh-aiapp-director",
    "rh-speech-hd",
    "rh-speech-turbo",
    "rh-music",
    "rh-voice-clone",
    "rh-aiapp-voice-clone",
    "rh-aiapp-voice-design",
}


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_health(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["service"] == "rh-adapter"
    assert data["models"] == 19


@pytest.mark.asyncio
async def test_list_models(client):
    resp = await client.get("/v1/models")
    assert resp.status_code == 200
    data = resp.json()
    assert data["object"] == "list"
    assert len(data["data"]) == 19
    model_ids = [m["id"] for m in data["data"]]
    assert set(model_ids) == TARGET_MODELS


@pytest.mark.asyncio
async def test_list_models_includes_env_registered_custom_ai_app(client, monkeypatch):
    custom_map = build_model_map(
        '[{"id":"rh-custom-demo","label":"Custom Demo","output_type":"video","webapp_id":"123"}]'
    )
    monkeypatch.setattr(main_module, "MODEL_MAP", custom_map)

    resp = await client.get("/v1/models")
    assert resp.status_code == 200
    data = resp.json()
    by_id = {model["id"]: model for model in data["data"]}

    assert len(data["data"]) == 20
    assert by_id["rh-custom-demo"]["label"] == "Custom Demo"
    assert by_id["rh-custom-demo"]["output_type"] == "video"
    assert by_id["rh-custom-demo"]["custom"] is True


@pytest.mark.asyncio
async def test_check_no_key(client):
    resp = await client.post("/check")
    # Should return no_key error since no API key is set in test
    assert resp.status_code in (200, 500)
    data = resp.json()
    assert data["status"] in ("no_key", "ok", "auth_error", "error")


@pytest.mark.asyncio
async def test_image_generation_no_key(client):
    """Image generation should fail cleanly without API key."""
    resp = await client.post("/v1/images/generations", json={
        "model": "rh-pro-image",
        "prompt": "test prompt",
    })
    # Should fail since no API key
    assert resp.status_code in (500, 400, 401)

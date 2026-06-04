"""Tests: model mapping logic."""

import pytest

from src.models.mapping import (
    build_model_map,
    MODEL_MAP,
    get_rh_endpoint,
    get_webapp_id,
    get_output_type,
    is_image_model,
    is_video_model,
    is_audio_model,
    is_ai_app_model,
    normalize_custom_ai_app_models,
)
from src.models.capabilities import get_official_capability

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

REMOVED_MODELS = {
    "rh-kling-v30-pro",
    "rh-veo-31-fast",
    "rh-veo-31-pro",
    "rh-seedance2",
    "grok-video-3",
    "rh-3d-text",
    "rh-3d-image",
    "rh-grok-video-edit",
    "rh-mimic",
    "rh-digital-human-fast",
    "rh-digital-human",
    "rh-voice-design",
}


def test_all_models_have_required_fields():
    """Every model entry must have label and output_type."""
    for model_id, info in MODEL_MAP.items():
        assert "label" in info, f"{model_id} missing label"
        assert "output_type" in info, f"{model_id} missing output_type"


def test_model_registry_is_exact_target_set():
    assert set(MODEL_MAP) == TARGET_MODELS
    assert not (set(MODEL_MAP) & REMOVED_MODELS)


def test_image_models():
    assert is_image_model("rh-pro-image")
    assert not is_image_model("rh-video-v31-fast")
    assert not is_image_model("unknown")


def test_video_models():
    assert is_video_model("rh-video-v31-fast")
    assert not is_video_model("rh-pro-image")


def test_audio_models():
    assert is_audio_model("rh-speech-hd")
    assert not is_audio_model("rh-pro-image")


def test_ai_app_detection():
    assert is_ai_app_model("rh-gpt2-image")
    assert is_ai_app_model("rh-aiapp-fast-digital-human")
    assert is_ai_app_model("rh-aiapp-voice-clone")
    assert not is_ai_app_model("rh-pro-image")  # Has direct endpoint
    assert not is_ai_app_model("rh-seedance2-text-video")


def test_get_rh_endpoint_text_to_image():
    endpoint = get_rh_endpoint("rh-pro-image", has_image=False)
    assert endpoint == "rhart-image-n-pro/text-to-image"


def test_get_rh_endpoint_image_to_image():
    endpoint = get_rh_endpoint("rh-pro-image", has_image=True)
    assert endpoint == "rhart-image-n-pro/edit"


def test_get_rh_endpoint_unknown_model():
    with pytest.raises(ValueError, match="Unknown model"):
        get_rh_endpoint("nonexistent-model")


def test_get_rh_endpoint_ai_app():
    with pytest.raises(ValueError, match="AI Application"):
        get_rh_endpoint("rh-gpt2-image")


def test_get_webapp_id():
    assert get_webapp_id("rh-gpt2-image") == "2046514150500524033"
    assert get_webapp_id("rh-aiapp-fast-digital-human") == "2028055408421642241"
    assert get_webapp_id("rh-aiapp-voice-clone") == "2046193597401276417"
    assert get_webapp_id("rh-aiapp-voice-design") == "2035739697670000642"
    assert get_webapp_id("rh-aiapp-digital-human") == "2036019863617015809"
    assert get_webapp_id("rh-aiapp-director") == "2029950473750454274"
    assert get_webapp_id("rh-pro-image") is None


def test_get_output_type():
    assert get_output_type("rh-pro-image") == "image"
    assert get_output_type("rh-video-v31-fast") == "video"
    assert get_output_type("rh-speech-hd") == "audio"
    assert get_output_type("rh-gpt2-text") == "image"


def test_video_models_have_fallback():
    """Video models with text endpoint should have image-to-video fallback."""
    assert "fallback_endpoint" in MODEL_MAP["rh-video-v31-fast"]


def test_image_models_have_fallback():
    """Image models with text endpoint should have image-to-image fallback."""
    assert "fallback_endpoint" in MODEL_MAP["rh-pro-image"]


def test_standard_model_endpoints_exist_in_official_capabilities():
    """Every non-AI-App endpoint we expose must exist in official capabilities."""
    for model_id, entry in MODEL_MAP.items():
        endpoint = entry.get("endpoint")
        if endpoint:
            assert get_official_capability(endpoint)["endpoint"] == endpoint, model_id
        fallback = entry.get("fallback_endpoint")
        if fallback:
            assert get_official_capability(fallback)["endpoint"] == fallback, model_id


def test_normalize_custom_ai_app_models_from_array():
    models = normalize_custom_ai_app_models(
        '[{"id":"rh-custom-story-video","label":"Story Video","output_type":"video","webapp_id":"123"}]'
    )

    assert models["rh-custom-story-video"] == {
        "endpoint": None,
        "label": "Story Video",
        "output_type": "video",
        "webapp_id": "123",
        "custom": True,
    }


def test_normalize_custom_ai_app_models_from_object():
    models = normalize_custom_ai_app_models(
        '{"rh-custom-image":{"label":"Custom Image","outputType":"image","webappId":"456"}}'
    )

    assert models["rh-custom-image"]["output_type"] == "image"
    assert models["rh-custom-image"]["webapp_id"] == "456"


def test_normalize_custom_ai_app_models_rejects_unknown_output_type():
    with pytest.raises(ValueError, match="Unsupported custom RH output_type"):
        normalize_custom_ai_app_models(
            '[{"id":"rh-custom-bad","output_type":"3d","webapp_id":"789"}]'
        )


def test_build_model_map_includes_custom_ai_apps_without_core_code_changes():
    model_map = build_model_map(
        '[{"id":"rh-custom-demo","label":"Custom Demo","output_type":"video","webapp_id":"123"}]'
    )

    assert model_map["rh-custom-demo"] == {
        "endpoint": None,
        "label": "Custom Demo",
        "output_type": "video",
        "webapp_id": "123",
        "custom": True,
    }


def test_build_model_map_rejects_custom_overrides_of_builtin_models():
    with pytest.raises(ValueError, match="cannot override built-in"):
        build_model_map(
            '[{"id":"rh-pro-image","label":"Override","output_type":"video","webapp_id":"123"}]'
        )

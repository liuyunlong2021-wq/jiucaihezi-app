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
    get_ai_app_directory,
)
from src.models.capabilities import get_official_capability

REMOVED_MODELS = {
    "rh-kling-v30-pro",
    "rh-veo-31-fast",
    "rh-veo-31-pro",
    "grok-video-3",
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


def test_base_model_registry_excludes_removed_models():
    assert not (set(build_model_map("")) & REMOVED_MODELS)


def test_image_models():
    assert is_image_model("rh-pro-image")
    assert not is_image_model("rh-video-v31-fast")
    assert not is_image_model("unknown")


def test_video_models():
    assert is_video_model("rh-video-v31-fast")
    assert is_video_model("rh-gemini-omni-text-video")
    assert is_video_model("rh-gemini-omni-image-video")
    assert is_video_model("rh-gemini-omni-video-edit")
    assert is_video_model("rh-seedance25-no-video-ref")
    assert is_video_model("rh-seedance25-with-video-ref")
    assert not is_video_model("rh-pro-image")


def test_audio_models():
    assert is_audio_model("rh-suno-v55-single")
    assert is_audio_model("rh-suno-v55-custom")
    assert is_audio_model("rh-suno-lyrics")
    assert is_audio_model("rh-speech-hd")
    assert not is_audio_model("rh-pro-image")


def test_ai_app_detection():
    assert not is_ai_app_model("rh-gpt2-image")
    assert is_ai_app_model("rh-aiapp-fast-digital-human")
    assert is_ai_app_model("rh-aiapp-voice-clone")
    assert not is_ai_app_model("rh-pro-image")  # Has direct endpoint
    assert not is_ai_app_model("rh-seedance2-text-video")


def test_minimax_h3_ai_apps_share_generic_billing_model():
    expected = {
        "2093604127250149377", "2093571735550521345", "2093579373894000642",
        "2093654136997900290", "2093651661213491202", "2093662476146667522",
    }
    directory = {entry["webappId"]: entry for entry in get_ai_app_directory()}
    for webapp_id in expected:
        assert directory[webapp_id]["billingModel"] == "rh-aiapp"
        assert directory[webapp_id]["outputType"] == "video"


def test_get_rh_endpoint_text_to_image():
    endpoint = get_rh_endpoint("rh-pro-image", has_image=False)
    assert endpoint == "rhart-image-n-pro/text-to-image"


def test_get_rh_endpoint_image_to_image():
    endpoint = get_rh_endpoint("rh-pro-image", has_image=True)
    assert endpoint == "rhart-image-n-pro/edit"


def test_get_rh_endpoint_unknown_model():
    with pytest.raises(ValueError, match="Unknown model"):
        get_rh_endpoint("nonexistent-model")


def test_get_rh_endpoint_gpt2_image_uses_official_image_to_image():
    endpoint = get_rh_endpoint("rh-gpt2-image", has_image=True)
    assert endpoint == "rhart-image-g-2/image-to-image"


def test_get_rh_endpoint_z_image_turbo_uses_runninghub_lora_endpoint():
    endpoint = get_rh_endpoint("z-image-turbo", has_image=False)
    assert endpoint == "rhart-image/z-image/turbo-lora"


def test_get_webapp_id():
    assert get_webapp_id("rh-gpt2-image") is None
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
    assert get_output_type("z-image-turbo") == "image"
    assert get_output_type("rh-3d-text") == "3d"


def test_video_models_have_fallback():
    """Video models with text endpoint should have image-to-video fallback."""
    assert "fallback_endpoint" in MODEL_MAP["rh-video-v31-fast"]


def test_gemini_omni_models_use_separate_official_endpoints():
    assert get_rh_endpoint("rh-gemini-omni-text-video") == "gemini-omni-flash/text-to-video"
    assert get_rh_endpoint("rh-gemini-omni-image-video", has_image=True) == "gemini-omni-flash/image-to-video"
    assert get_rh_endpoint("rh-gemini-omni-video-edit", has_image=True) == "gemini-omni-flash/video-edit"


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
        "billing_model": "rh-custom-story-video",
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


def test_normalize_custom_ai_app_models_rejects_missing_output_type():
    with pytest.raises(ValueError, match="Unsupported custom RH output_type"):
        normalize_custom_ai_app_models('[{"id":"rh-custom-bad","webapp_id":"789"}]')


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
        "billing_model": "rh-custom-demo",
    }


def test_build_model_map_rejects_custom_overrides_of_builtin_models():
    with pytest.raises(ValueError, match="cannot override built-in"):
        build_model_map(
            '[{"id":"rh-pro-image","label":"Override","output_type":"video","webapp_id":"123"}]'
        )

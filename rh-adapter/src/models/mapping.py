"""
Model name mapping: NewAPI model name → RunningHub native endpoint.

Each entry maps a NewAPI-managed model name to RunningHub API parameters.
This is the ONLY place that needs updating when RH adds/changes endpoints.
"""

from __future__ import annotations

import json
import os
from typing import Optional

# ── Image models ──

IMAGE_MODELS: dict[str, dict] = {
    "rh-pro-image": {
        "endpoint": "rhart-image-n-pro/text-to-image",
        "label": "全能图片PRO",
        "output_type": "image",
        "fallback_endpoint": "rhart-image-n-pro/edit",
    },
    "rh-image-v2": {
        "endpoint": "rhart-image-n-g31-flash/text-to-image",
        "fallback_endpoint": "rhart-image-n-g31-flash/image-to-image",
        "label": "全能图片V2",
        "output_type": "image",
    },
    "rh-gpt2-image": {
        "endpoint": "rhart-image-g-2/image-to-image",
        "label": "GPT2.0",
        "output_type": "image",
    },
    "rh-gpt2-text": {
        "endpoint": "rhart-image-g-2/text-to-image",
        "label": "GPT2.0 文生图",
        "output_type": "image",
    },
    "z-image-turbo": {
        "endpoint": "rhart-image/z-image/turbo-lora",
        "label": "Z Image Turbo",
        "output_type": "image",
    },
}

# ── Video models ──

VIDEO_MODELS: dict[str, dict] = {
    "rh-video-v31-fast": {
        "endpoint": "rhart-video-v3.1-fast/text-to-video",
        "label": "全能视频V3.1-Fast",
        "output_type": "video",
        "fallback_endpoint": "rhart-video-v3.1-fast/image-to-video",
    },
    "rh-seedance2-text-video": {
        "endpoint": "rhart-video/sparkvideo-2.0/text-to-video",
        "label": "Seedance 2.0 文生视频",
        "output_type": "video",
    },
    "rh-seedance2-image-video": {
        "endpoint": "rhart-video/sparkvideo-2.0/image-to-video",
        "label": "Seedance 2.0 图生视频",
        "output_type": "video",
    },
    "rh-seedance2-multimodal-video": {
        "endpoint": "rhart-video/sparkvideo-2.0/multimodal-video",
        "label": "Seedance 2.0 全能参考",
        "output_type": "video",
    },
    "rh-grok-text-video": {
        "endpoint": "rhart-video-g/text-to-video",
        "label": "Grok Video 文生视频",
        "output_type": "video",
    },
    "rh-grok-image-video": {
        "endpoint": "rhart-video-g/image-to-video",
        "label": "Grok Video 图生视频",
        "output_type": "video",
    },
    "rh-grok-video-edit": {
        "endpoint": "rhart-video-g-official/edit-video",
        "label": "Grok Video 视频编辑",
        "output_type": "video",
    },
    "rh-aiapp-fast-digital-human": {
        "endpoint": None,
        "label": "极速数字人",
        "output_type": "video",
        "webapp_id": "2028055408421642241",
        "custom": True,
    },
    "rh-aiapp-digital-human": {
        "endpoint": None,
        "label": "数字人",
        "output_type": "video",
        "webapp_id": "2036019863617015809",
        "custom": True,
    },
    "rh-aiapp-director": {
        "endpoint": None,
        "label": "我是导演",
        "output_type": "video",
        "webapp_id": "2029950473750454274",
        "custom": True,
    },
}

# ── Audio models ──

AUDIO_MODELS: dict[str, dict] = {
    "rh-suno-v55-single": {
        "endpoint": "rhart-audio/suno-v5.5/single",
        "label": "Suno v5.5 一句话成歌",
        "output_type": "audio",
    },
    "rh-suno-v55-custom": {
        "endpoint": "rhart-audio/suno-v5.5/custom",
        "label": "Suno v5.5 自定义成歌",
        "output_type": "audio",
    },
    "rh-suno-lyrics": {
        "endpoint": "rhart-audio/suno/lyrics",
        "label": "Suno 创作歌词",
        "output_type": "audio",
    },
    "rh-speech-hd": {
        "endpoint": "rhart-audio/text-to-audio/speech-2.8-hd",
        "label": "语音合成HD",
        "output_type": "audio",
    },
    "rh-speech-turbo": {
        "endpoint": "rhart-audio/text-to-audio/speech-2.8-turbo",
        "label": "语音合成快速",
        "output_type": "audio",
    },
    "rh-music": {
        "endpoint": "rhart-audio/text-to-audio/music-2.5",
        "label": "音乐生成",
        "output_type": "audio",
    },
    "rh-voice-clone": {
        "endpoint": "rhart-audio/text-to-audio/voice-clone",
        "label": "声音克隆",
        "output_type": "audio",
    },
    "rh-aiapp-voice-clone": {
        "endpoint": None,
        "label": "声音克隆 AI App",
        "output_type": "audio",
        "webapp_id": "2046193597401276417",
        "custom": True,
    },
    "rh-aiapp-voice-design": {
        "endpoint": None,
        "label": "设计语音",
        "output_type": "audio",
        "webapp_id": "2035739697670000642",
        "custom": True,
    },
}

# ── Custom AI App models ──

def normalize_custom_ai_app_models(raw: str) -> dict[str, dict]:
    """Parse RH_CUSTOM_AI_APPS JSON into MODEL_MAP entries.

    Expected formats:
      [{"id":"rh-custom-demo","label":"Demo","output_type":"video","webapp_id":"123"}]
      {"rh-custom-demo":{"label":"Demo","output_type":"video","webapp_id":"123"}}
    """
    if not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"RH_CUSTOM_AI_APPS invalid JSON: {e}") from e

    if isinstance(parsed, list):
        items = [(str(item.get("id", "")), item) for item in parsed if isinstance(item, dict)]
    elif isinstance(parsed, dict):
        items = [(str(model_id), value) for model_id, value in parsed.items() if isinstance(value, dict)]
    else:
        raise ValueError("RH_CUSTOM_AI_APPS must be a JSON object or array")

    models: dict[str, dict] = {}
    for model_id, item in items:
        model_id = model_id.strip()
        webapp_id = str(item.get("webapp_id") or item.get("webappId") or "").strip()
        output_type = str(item.get("output_type") or item.get("outputType") or "video").strip()
        if not model_id or not webapp_id:
            continue
        if output_type not in ("image", "video", "audio"):
            raise ValueError(f"Unsupported custom RH output_type for {model_id}: {output_type}")
        models[model_id] = {
            "endpoint": None,
            "label": str(item.get("label") or model_id),
            "output_type": output_type,
            "webapp_id": webapp_id,
            "custom": True,
        }
    return models


BASE_MODEL_MAP: dict[str, dict] = {
    **IMAGE_MODELS,
    **VIDEO_MODELS,
    **AUDIO_MODELS,
}


def build_model_map(custom_raw: str | None = None) -> dict[str, dict]:
    """Build the full model registry, including env-registered custom AI Apps."""
    custom_models = normalize_custom_ai_app_models(
        os.getenv("RH_CUSTOM_AI_APPS", "") if custom_raw is None else custom_raw
    )
    duplicate_ids = set(BASE_MODEL_MAP) & set(custom_models)
    if duplicate_ids:
        raise ValueError(f"RH_CUSTOM_AI_APPS cannot override built-in model ids: {sorted(duplicate_ids)}")
    return {**BASE_MODEL_MAP, **custom_models}


CUSTOM_AI_APP_MODELS = normalize_custom_ai_app_models(os.getenv("RH_CUSTOM_AI_APPS", ""))

# ── Combined registry ──

MODEL_MAP: dict[str, dict] = build_model_map()


def get_rh_endpoint(model: str, has_image: bool = False) -> str:
    """Resolve RunningHub endpoint for a given NewAPI model name.
    
    For text-to-image models, returns the text endpoint.
    When has_image=True, returns the image-to-X fallback if available.
    """
    entry = MODEL_MAP.get(model)
    if not entry:
        raise ValueError(f"Unknown model: {model}. Available: {list(MODEL_MAP.keys())}")
    
    endpoint = entry.get("endpoint")
    if not endpoint:
        raise ValueError(f"Model '{model}' is an AI Application (workflow), use webapp mode")
    
    if has_image:
        fallback = entry.get("fallback_endpoint")
        if fallback:
            return fallback
    
    return endpoint


def get_webapp_id(model: str) -> Optional[str]:
    """Get webapp (ComfyUI workflow) ID for AI Application models."""
    entry = MODEL_MAP.get(model)
    if not entry:
        raise ValueError(f"Unknown model: {model}")
    return entry.get("webapp_id")


def get_output_type(model: str) -> str:
    """Get the output type for a model."""
    entry = MODEL_MAP.get(model)
    if not entry:
        raise ValueError(f"Unknown model: {model}")
    return entry.get("output_type", "unknown")


def is_image_model(model: str) -> bool:
    return model in IMAGE_MODELS or MODEL_MAP.get(model, {}).get("output_type") == "image"


def is_video_model(model: str) -> bool:
    return model in VIDEO_MODELS or MODEL_MAP.get(model, {}).get("output_type") == "video"


def is_audio_model(model: str) -> bool:
    return model in AUDIO_MODELS or MODEL_MAP.get(model, {}).get("output_type") == "audio"


def is_ai_app_model(model: str) -> bool:
    """Check if model is an AI Application (ComfyUI workflow)."""
    entry = MODEL_MAP.get(model)
    if not entry:
        return False
    return entry.get("endpoint") is None and entry.get("webapp_id") is not None

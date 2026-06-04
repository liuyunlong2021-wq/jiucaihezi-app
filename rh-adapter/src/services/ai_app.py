"""RunningHub AI Application node discovery and deterministic input mapping."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from ..config import RH_AI_APP_NODE_INFO
from .rh_client import RHError, maybe_upload

logger = logging.getLogger(__name__)


async def fetch_ai_app_node_info(
    client: httpx.AsyncClient,
    api_key: str,
    webapp_id: str,
) -> list[dict[str, Any]]:
    """Fetch modifiable nodeInfoList for a RunningHub AI App via apiCallDemo."""
    try:
        resp = await client.get(
            RH_AI_APP_NODE_INFO,
            params={"apiKey": api_key, "webappId": webapp_id},
            timeout=30,
        )
        data = resp.json()
    except Exception as e:
        raise RHError(f"AI App node discovery failed: {e}", code=502)

    code = data.get("code", 0)
    if code not in (0, 200, "0", "200"):
        raise RHError(data.get("msg") or "AI App node discovery failed", code=502, rh_code=str(code))

    nodes = data.get("data", {}).get("nodeInfoList", [])
    if not isinstance(nodes, list):
        raise RHError("AI App node discovery returned invalid nodeInfoList", code=502)
    node_list = [node for node in nodes if isinstance(node, dict)]
    if not node_list:
        raise RHError(
            "AI App apiCallDemo returned no modifiable nodeInfoList; run the app once on RunningHub web first",
            code=502,
        )
    return node_list


def _text_for_match(node: dict[str, Any]) -> str:
    return " ".join(
        str(node.get(key, "")).lower()
        for key in ("fieldName", "fieldType", "description", "nodeName")
    )


def _is_media_node(node: dict[str, Any], media_type: str) -> bool:
    text = _text_for_match(node)
    field_type = str(node.get("fieldType", "")).upper()
    if field_type == media_type.upper():
        return True
    if media_type == "image":
        return any(token in text for token in ("image", "img", "图片", "图像", "照片"))
    if media_type == "video":
        return any(token in text for token in ("video", "视频"))
    if media_type == "audio":
        return any(token in text for token in ("audio", "音频", "声音"))
    return False


def _is_prompt_node(node: dict[str, Any]) -> bool:
    text = _text_for_match(node)
    field_type = str(node.get("fieldType", "")).upper()
    return field_type in ("", "STRING", "TEXT") and any(
        token in text for token in ("prompt", "text", "提示词", "文本", "描述", "文案")
    )


def _matches_scalar(node: dict[str, Any], key: str) -> bool:
    text = _text_for_match(node)
    if key == "duration":
        return any(token in text for token in ("duration", "时长", "秒"))
    if key == "ratio":
        return any(token in text for token in ("ratio", "aspect", "比例", "画幅"))
    if key == "size":
        return any(token in text for token in ("size", "尺寸"))
    return False


def _missing_inputs_message(missing: list[str]) -> str:
    return "AI App nodeInfoList missing modifiable node for: " + ", ".join(missing)


async def resolve_ai_app_node_media(
    client: httpx.AsyncClient,
    api_key: str,
    node_list: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Upload data URL media values in nodeInfoList to RH fileName tokens."""
    resolved: list[dict[str, Any]] = []
    for node in node_list:
        next_node = dict(node)
        value = next_node.get("fieldValue")
        if isinstance(value, str) and value.startswith("data:"):
            next_node["fieldValue"] = await maybe_upload(client, api_key, value, mode="ai_app")
        resolved.append(next_node)
    return resolved


async def apply_ai_app_inputs(
    client: httpx.AsyncClient,
    api_key: str,
    node_list: list[dict[str, Any]],
    *,
    prompt: str = "",
    images: list[str] | None = None,
    videos: list[str] | None = None,
    audios: list[str] | None = None,
    duration: int | str | None = None,
    ratio: str | None = None,
    size: str | None = None,
) -> list[dict[str, Any]]:
    """Fill discovered AI App nodes with user inputs using conservative matching."""
    image_values = list(images or [])
    video_values = list(videos or [])
    audio_values = list(audios or [])
    image_index = 0
    video_index = 0
    audio_index = 0
    prompt_set = False
    duration_set = False
    ratio_set = False
    size_set = False

    resolved: list[dict[str, Any]] = []
    for node in node_list:
        next_node = dict(node)

        if prompt and not prompt_set and _is_prompt_node(next_node):
            next_node["fieldValue"] = prompt
            prompt_set = True
        elif image_index < len(image_values) and _is_media_node(next_node, "image"):
            next_node["fieldValue"] = await maybe_upload(
                client,
                api_key,
                image_values[image_index],
                mode="ai_app",
            )
            image_index += 1
        elif video_index < len(video_values) and _is_media_node(next_node, "video"):
            next_node["fieldValue"] = await maybe_upload(
                client,
                api_key,
                video_values[video_index],
                mode="ai_app",
            )
            video_index += 1
        elif audio_index < len(audio_values) and _is_media_node(next_node, "audio"):
            next_node["fieldValue"] = await maybe_upload(
                client,
                api_key,
                audio_values[audio_index],
                mode="ai_app",
            )
            audio_index += 1
        elif duration is not None and not duration_set and _matches_scalar(next_node, "duration"):
            next_node["fieldValue"] = str(duration)
            duration_set = True
        elif ratio and not ratio_set and _matches_scalar(next_node, "ratio"):
            next_node["fieldValue"] = ratio
            ratio_set = True
        elif size and not size_set and _matches_scalar(next_node, "size"):
            next_node["fieldValue"] = size
            size_set = True

        resolved.append(next_node)

    missing: list[str] = []
    if prompt and not prompt_set:
        missing.append("prompt")
    if image_index < len(image_values):
        missing.append(f"image x{len(image_values) - image_index}")
    if video_index < len(video_values):
        missing.append(f"video x{len(video_values) - video_index}")
    if audio_index < len(audio_values):
        missing.append(f"audio x{len(audio_values) - audio_index}")
    if duration is not None and not duration_set:
        missing.append("duration")
    if ratio and not ratio_set:
        missing.append("ratio")
    if size and not size_set:
        missing.append("size")
    if missing:
        raise RHError(_missing_inputs_message(missing), code=400)

    return await resolve_ai_app_node_media(client, api_key, resolved)

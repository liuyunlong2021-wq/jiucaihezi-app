"""Audio generation service — TTS, music, and voice clone. Async submit, no internal polling."""

from __future__ import annotations

import logging

import httpx

from ..config import RUNNINGHUB_API_KEY
from ..models.mapping import get_rh_endpoint, get_webapp_id, is_ai_app_model
from ..models.schemas import AudioRequest
from .ai_app import apply_ai_app_inputs, fetch_ai_app_node_info, resolve_ai_app_node_media
from .rh_client import (
    submit_ai_app,
    submit_task,
    RHError,
)
from .standard_payload import build_standard_payload

logger = logging.getLogger(__name__)


def _bool_string(value: object, default: str = "false") -> str:
    if value is None:
        return default
    if isinstance(value, bool):
        return "true" if value else "false"
    normalized = str(value).strip().lower()
    return "true" if normalized in ("true", "1", "yes", "y", "on") else "false"


def _build_suno_payload(request: AudioRequest) -> dict | None:
    """Build payloads for RunningHub Suno endpoints missing from capabilities.json."""
    extra = request.extra_fields or {}
    if request.model == "rh-suno-v55-single":
        return {
            "title": request.title or extra.get("title") or "未命名歌曲",
            "description": request.description or extra.get("description") or request.prompt or request.text,
            "make_instrumental": _bool_string(request.make_instrumental or extra.get("make_instrumental")),
        }
    if request.model == "rh-suno-v55-custom":
        return {
            "title": request.title or extra.get("title") or "未命名歌曲",
            "lyrics": request.lyrics or extra.get("lyrics") or request.prompt or request.text,
            "tags": request.tags or extra.get("tags") or "",
            "negative_tags": request.negative_tags or extra.get("negative_tags") or "",
            "make_instrumental": _bool_string(request.make_instrumental or extra.get("make_instrumental")),
        }
    if request.model == "rh-suno-lyrics":
        return {
            "prompt": request.prompt or request.text,
        }
    return None


async def generate_audio(
    client: httpx.AsyncClient,
    request: AudioRequest,
    api_key: str = "",
) -> dict:
    """Submit an audio generation task to RunningHub.

    Returns immediately with {task_id, status: "processing"}.
    """
    key = api_key or RUNNINGHUB_API_KEY
    if not key:
        raise RHError("No RunningHub API key configured", code=500)

    model = request.model
    if is_ai_app_model(model):
        return await _submit_via_app(client, request, key)

    endpoint = get_rh_endpoint(model)
    logger.info("Audio submit: model=%s endpoint=%s", model, endpoint)

    payload = _build_suno_payload(request)
    if payload is None:
        payload = await build_standard_payload(client, key, endpoint, {
            "prompt": request.prompt or request.text,
            "text": request.text or request.prompt,
            "audio": request.reference_audio,
            "voice_id": request.voice,
            "custom_voice_id": request.voice,
            "language_boost": request.language,
        })

    task_data = await submit_task(client, key, endpoint, payload)
    task_id = task_data.get("taskId") or task_data.get("task_id", "")
    if not task_id:
        raise RHError("No task ID returned from RunningHub")

    logger.info("Audio task submitted: task_id=%s", task_id)
    return {"task_id": task_id, "status": "processing"}


async def _submit_via_app(
    client: httpx.AsyncClient,
    request: AudioRequest,
    api_key: str,
) -> dict:
    """Submit an audio-producing AI Application."""
    webapp_id = get_webapp_id(request.model)
    if not webapp_id:
        raise RHError(f"No webapp ID for model: {request.model}")

    # ★ 诊断日志：记录实际收到的 AudioRequest 关键字段
    ni_len = len(request.nodeInfoList) if request.nodeInfoList else 0
    logger.info(
        "[DIAG] AudioRequest: model=%s nodeInfoList_len=%d text=(%s) prompt=(%s) voice_first20=(%s)",
        request.model,
        ni_len,
        (request.text or "")[:40],
        (request.prompt or "")[:40],
        (request.voice or "")[:20],
    )

    # ★ 恢复机制：如果 NewAPI TTS adaptor 丢弃了 nodeInfoList，
    #    从前端编码的 voice 字段中恢复（前端 creationMediaRuntime.ts 同步编码）。
    if not request.nodeInfoList and request.voice and request.voice.startswith("__rh_nodeinfo__"):
        try:
            import base64
            import json as _json
            encoded = request.voice[len("__rh_nodeinfo__"):]
            decoded = _json.loads(base64.b64decode(encoded).decode("utf-8"))
            if isinstance(decoded, list) and len(decoded) > 0:
                request.nodeInfoList = decoded
                logger.info(
                    "[FIX] Recovered nodeInfoList from voice field: %d nodes, model=%s",
                    len(request.nodeInfoList),
                    request.model,
                )
            else:
                logger.warning("[FIX] voice field decoded but not a valid nodeInfoList: %s", type(decoded))
        except Exception as e:
            logger.warning("[FIX] Failed to decode voice nodeInfoList: %s", e)

    if request.nodeInfoList:
        node_list = await resolve_ai_app_node_media(client, api_key, request.nodeInfoList)
    else:
        discovered = await fetch_ai_app_node_info(client, api_key, webapp_id)
        node_list = await apply_ai_app_inputs(
            client,
            api_key,
            discovered,
            prompt=request.text or request.prompt,
            audios=[request.reference_audio] if request.reference_audio else [],
        )

    task_id = await submit_ai_app(client, api_key, webapp_id, node_list)
    logger.info("AI App audio task submitted: task_id=%s webapp=%s", task_id, webapp_id)
    return {"task_id": task_id, "status": "processing", "ai_app": True, "rh_task_id": task_id}

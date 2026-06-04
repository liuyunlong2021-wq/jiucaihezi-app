"""Video generation service — async submit, no internal polling."""

from __future__ import annotations

import logging

import httpx

from ..config import RUNNINGHUB_API_KEY
from ..models.mapping import get_rh_endpoint, is_ai_app_model, get_webapp_id
from ..models.schemas import VideoRequest
from .ai_app import apply_ai_app_inputs, fetch_ai_app_node_info, resolve_ai_app_node_media
from .rh_client import (
    submit_task,
    submit_ai_app,
    RHError,
)
from .standard_payload import build_standard_payload

logger = logging.getLogger(__name__)


async def generate_video(
    client: httpx.AsyncClient,
    request: VideoRequest,
    api_key: str = "",
) -> dict:
    """Submit a video generation task to RunningHub.

    Returns immediately with {task_id, status: "processing"}.
    """
    key = api_key or RUNNINGHUB_API_KEY
    if not key:
        raise RHError("No RunningHub API key configured", code=500)

    model = request.model
    has_image = bool(request.images)

    if is_ai_app_model(model):
        return await _submit_via_app(client, request, key)

    endpoint = get_rh_endpoint(model, has_image=has_image)
    logger.info("Video submit: model=%s endpoint=%s has_image=%s", model, endpoint, has_image)

    payload = await build_standard_payload(client, key, endpoint, {
        "prompt": request.prompt,
        "ratio": request.ratio,
        "resolution": request.resolution,
        "duration": request.duration,
        "images": request.images or [],
        "video": request.video,
        "audio": request.audio,
        "text": request.text,
        "width": request.width,
        "height": request.height,
    })

    task_data = await submit_task(client, key, endpoint, payload)
    task_id = task_data.get("taskId") or task_data.get("task_id", "")
    if not task_id:
        raise RHError("No task ID returned from RunningHub")

    logger.info("Video task submitted: task_id=%s", task_id)
    return {"task_id": task_id, "status": "processing"}


async def _submit_via_app(
    client: httpx.AsyncClient,
    request: VideoRequest,
    api_key: str,
) -> dict:
    """Submit via AI Application (e.g. Seedance 2.0)."""
    webapp_id = get_webapp_id(request.model)
    if not webapp_id:
        raise RHError(f"No webapp ID for model: {request.model}")

    if request.nodeInfoList:
        node_list = await resolve_ai_app_node_media(client, api_key, request.nodeInfoList)
    else:
        node_list = await _build_discovered_nodes(client, api_key, webapp_id, request)

    task_id = await submit_ai_app(client, api_key, webapp_id, node_list)
    logger.info("AI App video task submitted: task_id=%s webapp=%s", task_id, webapp_id)
    return {"task_id": task_id, "status": "processing", "ai_app": True}


async def _build_discovered_nodes(
    client: httpx.AsyncClient,
    api_key: str,
    webapp_id: str,
    request: VideoRequest,
) -> list[dict]:
    discovered = await fetch_ai_app_node_info(client, api_key, webapp_id)
    return await apply_ai_app_inputs(
        client,
        api_key,
        discovered,
        prompt=request.prompt,
        images=request.images or [],
        videos=[request.video] if request.video else [],
        audios=[request.audio] if request.audio else [],
        duration=request.duration,
        ratio=request.ratio,
    )

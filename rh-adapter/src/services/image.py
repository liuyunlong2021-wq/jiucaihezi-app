"""Image generation service — async submit, no internal polling."""

from __future__ import annotations

import logging

import httpx

from ..config import RUNNINGHUB_API_KEY
from ..models.mapping import get_rh_endpoint, is_ai_app_model, get_webapp_id
from ..models.schemas import ImageRequest
from .ai_app import apply_ai_app_inputs, fetch_ai_app_node_info, resolve_ai_app_node_media
from .rh_client import (
    submit_task,
    submit_ai_app,
    RHError,
)
from .standard_payload import build_standard_payload

logger = logging.getLogger(__name__)


def _aspect_ratio_from_size(size: str | None) -> str | None:
    value = str(size or "").strip().lower()
    mapping = {
        "1024x1024": "1:1",
        "2048x2048": "1:1",
        "1536x1024": "3:2",
        "1024x1536": "2:3",
        "2048x1152": "16:9",
        "3840x2160": "16:9",
        "1152x2048": "9:16",
        "2160x3840": "9:16",
    }
    return mapping.get(value)


async def generate_image(
    client: httpx.AsyncClient,
    request: ImageRequest,
    api_key: str = "",
) -> dict:
    """Submit an image generation task to RunningHub.

    Returns immediately with {task_id, status: "processing"}.
    Caller polls GET /tasks/{task_id} for result.
    """
    key = api_key or RUNNINGHUB_API_KEY
    if not key:
        raise RHError("No RunningHub API key configured", code=500)

    model = request.model
    has_image = bool(request.images or request.image)

    if is_ai_app_model(model):
        return await _submit_via_app(client, request, key)

    endpoint = get_rh_endpoint(model, has_image=has_image)
    logger.info("Image submit: model=%s endpoint=%s has_image=%s", model, endpoint, has_image)

    images = request.images or ([request.image] if request.image else [])
    aspect_ratio = request.aspect_ratio or _aspect_ratio_from_size(request.size)
    payload = await build_standard_payload(client, key, endpoint, {
        "prompt": request.prompt,
        "aspectRatio": aspect_ratio,
        "aspect_ratio": aspect_ratio,
        "ratio": aspect_ratio,
        "resolution": request.resolution,
        "size": request.size,
        "lora": request.lora,
        "lora_strength": request.lora_strength,
        "outputFormat": request.output_format,
        "images": images,
    })

    task_data = await submit_task(client, key, endpoint, payload)
    task_id = task_data.get("taskId") or task_data.get("task_id", "")
    if not task_id:
        raise RHError("No task ID returned from RunningHub")

    logger.info("Image task submitted: task_id=%s", task_id)
    return {"task_id": task_id, "status": "processing"}


async def _submit_via_app(
    client: httpx.AsyncClient,
    request: ImageRequest,
    api_key: str,
) -> dict:
    """Submit via AI Application (ComfyUI workflow)."""
    webapp_id = get_webapp_id(request.model)
    if not webapp_id:
        raise RHError(f"No webapp ID for model: {request.model}")

    if request.nodeInfoList:
        node_list = await resolve_ai_app_node_media(client, api_key, request.nodeInfoList)
    else:
        node_list = await _build_discovered_nodes(client, api_key, webapp_id, request)

    task_id = await submit_ai_app(client, api_key, webapp_id, node_list)
    logger.info("AI App image task submitted: task_id=%s webapp=%s", task_id, webapp_id)
    return {"task_id": task_id, "status": "processing", "ai_app": True}


async def _build_discovered_nodes(
    client: httpx.AsyncClient,
    api_key: str,
    webapp_id: str,
    request: ImageRequest,
) -> list[dict]:
    images = request.images or ([request.image] if request.image else [])
    discovered = await fetch_ai_app_node_info(client, api_key, webapp_id)
    return await apply_ai_app_inputs(
        client,
        api_key,
        discovered,
        prompt=request.prompt,
        images=images,
        ratio=request.aspect_ratio,
        size=request.size,
    )

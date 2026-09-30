"""Video generation service — async submit, no internal polling."""

from __future__ import annotations

import logging

import httpx

from ..config import RUNNINGHUB_API_KEY, runninghub_api_key
from ..models.mapping import get_rh_endpoint, get_rh_site, is_ai_app_model, get_webapp_id, matches_ai_app_registration
from ..models.schemas import VideoRequest
from .ai_app import apply_ai_app_inputs, fetch_ai_app_node_info, resolve_ai_app_node_media
from .rh_client import (
    submit_task,
    submit_ai_app,
    encode_task_id,
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

    metadata_app = (request.metadata or {}).get("rh_aiapp")
    if metadata_app is not None and (not isinstance(metadata_app, dict) or metadata_app.get("version") != 1):
        raise RHError("RH AI App metadata 合同版本无效", code=400)
    if metadata_app is None:
        metadata_app = {}
    for value in ((request.extra_fields or {}).get("webappId"), request.webappId):
        if value and metadata_app.get("webappId") and value != metadata_app["webappId"]:
            raise RHError("RH AI App 应用 ID 冲突，拒绝提交", code=400)
    if request.nodeInfoList and metadata_app.get("nodeInfoList") and request.nodeInfoList != metadata_app["nodeInfoList"]:
        raise RHError("RH AI App 节点参数冲突，拒绝提交", code=400)
    extra = request.extra_fields or {}
    webapp_id = extra.get("webappId") or request.webappId or metadata_app.get("webappId") or get_webapp_id(model)
    if model == "rh-aiapp" and not webapp_id:
        raise RHError("RH AI App 缺少 webappId，拒绝提交；请刷新应用节点后重试", code=400)
    if is_ai_app_model(model) or webapp_id:
        return await _submit_via_app(client, request, key, webapp_id=webapp_id, metadata_app=metadata_app)

    endpoint = get_rh_endpoint(model, has_image=has_image)
    site = get_rh_site(model)
    key = runninghub_api_key(site, key)
    logger.info("Video submit: model=%s endpoint=%s site=%s has_image=%s", model, endpoint, site, has_image)

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
        # ★ Phase 1d: 透传 extra_fields（LTX 等新模型独有字段）
        **(request.extra_fields or {}),
    }, site=site)

    task_data = await submit_task(client, key, endpoint, payload, site=site)
    task_id = task_data.get("taskId") or task_data.get("task_id", "")
    if not task_id:
        raise RHError("No task ID returned from RunningHub")

    logger.info("Video task submitted: task_id=%s", task_id)
    return {"task_id": encode_task_id(task_id, site), "status": "processing"}


async def _submit_via_app(
    client: httpx.AsyncClient,
    request: VideoRequest,
    api_key: str,
    webapp_id: str = "",
    metadata_app: dict | None = None,
) -> dict:
    """Submit via AI Application (e.g. Seedance 2.0)."""
    wid = webapp_id or get_webapp_id(request.model)
    if not wid:
        raise RHError(f"No webapp ID for model: {request.model}")
    if not matches_ai_app_registration(wid, request.model):
        raise RHError("AI app registration does not match billing model", code=403)

    from ..config import RH_AI_APP_WHITELIST
    if RH_AI_APP_WHITELIST and wid not in RH_AI_APP_WHITELIST:
        raise RHError("AI app not in whitelist", code=403)

    app_meta = metadata_app or {}
    explicit_nodes = request.nodeInfoList or app_meta.get("nodeInfoList")
    if explicit_nodes is not None and not isinstance(explicit_nodes, list):
        raise RHError("RH AI App nodeInfoList 格式无效，拒绝提交", code=400)
    if request.model == "rh-aiapp" and not explicit_nodes:
        raise RHError("RH AI App 缺少节点参数，拒绝使用工作流默认值；请刷新应用后重试", code=400)

    if explicit_nodes:
        discovered = await fetch_ai_app_node_info(client, api_key, wid)
        known_keys = {(str(n.get("nodeId", "")), str(n.get("fieldName", ""))) for n in discovered}
        supplied_keys = set()
        for node in explicit_nodes:
            if not isinstance(node, dict):
                raise RHError("RH AI App 节点参数格式无效", code=400)
            node_key = (str(node.get("nodeId", "")), str(node.get("fieldName", "")))
            if node_key not in known_keys or node_key in supplied_keys:
                raise RHError("RH AI App 节点已变化或重复，请重新发现节点", code=400)
            if node.get("fieldValue") is None or str(node["fieldValue"]).strip() == "":
                raise RHError("RH AI App 节点值为空，拒绝使用示例值", code=400)
            supplied_keys.add(node_key)
        if request.model == "rh-aiapp" and supplied_keys != known_keys:
            raise RHError("RH AI App 节点参数不完整，拒绝使用工作流示例；请重新发现节点", code=400)
        # Generic apps supply every node; do not upload or inherit demo media before overrides.
        if request.model != "rh-aiapp":
            discovered = await apply_ai_app_inputs(
                client, api_key, discovered,
                prompt="",
                images=request.images or [],
                videos=[request.video] if request.video else [],
                audios=[request.audio] if request.audio else [],
                duration=request.duration,
                ratio=request.ratio,
            )
        for mod in explicit_nodes:
            nid = str(mod.get("nodeId", ""))
            fname = str(mod.get("fieldName", ""))
            fval = str(mod.get("fieldValue", ""))
            if not nid or not fname:
                continue
            for node in discovered:
                if str(node.get("nodeId", "")) == nid and node.get("fieldName") == fname:
                    node["fieldValue"] = fval
                    break
        node_list = await resolve_ai_app_node_media(client, api_key, discovered)
    else:
        node_list = await _build_discovered_nodes(client, api_key, wid, request)

    instance_type = (request.extra_fields or {}).get("instanceType") if request.extra_fields else None
    task_id = await submit_ai_app(client, api_key, webapp_id, node_list, instance_type=instance_type or "plus")
    logger.info("AI App video task submitted: task_id=%s webapp=%s", task_id, webapp_id)
    return {"task_id": task_id, "status": "processing", "ai_app": True, "rh_task_id": task_id}


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

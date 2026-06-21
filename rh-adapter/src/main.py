"""rh-adapter — RunningHub protocol translation layer.

OpenAI-compatible API → RunningHub native API.
Sits behind New API as a custom channel. New API handles auth + billing.

Routes:
    POST /v1/images/generations   — Image generation
    POST /v1/videos               — Video generation  
    POST /v1/audio/speech         — TTS generation
    GET  /health                  — Health check
    POST /check                   — API key validation

Environment:
    RUNNINGHUB_API_KEY (required)
    HOST, PORT, LOG_LEVEL (optional)
"""

from __future__ import annotations

import logging
import sys
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from .config import RUNNINGHUB_API_KEY, LOG_LEVEL
from .models.mapping import MODEL_MAP
from .models.capabilities import load_official_capabilities
from .models.schemas import ImageRequest, VideoRequest, AudioRequest
from .services.image import generate_image
from .services.video import generate_video
from .services.audio import generate_audio
from .services.rh_client import (
    check_health, query_task, query_ai_app_task,
    extract_result_url, extract_result_text, extract_cost, extract_task_time,
    RHError,
)
from .middleware.error_handler import rh_error_handler, general_exception_handler

# ── Logging ──
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("rh-adapter")

# Shared httpx client (lazy init)
_client: httpx.AsyncClient | None = None


async def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(600.0, connect=10.0),
            follow_redirects=True,
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=20),
        )
    return _client


def build_task_status_response(task_id: str, task_data: dict) -> dict:
<<<<<<< HEAD
    """Translate one RunningHub task query response to NewAPI/Sora-friendly JSON.

    The response format matches the ``responseTask`` struct in NewAPI's
    ``relay/channel/task/sora/adaptor.go`` ParseTaskResult().  It also adds
    ``model`` / ``object`` / ``created_at`` for broad Sora compatibility.
    """
=======
    """Translate one RunningHub task query response to NewAPI/Sora-friendly JSON."""
    if not isinstance(task_data, dict):
        logger.warning("build_task_status_response received non-dict task_data: %s", type(task_data).__name__)
        return {"id": task_id, "task_id": task_id, "status": "processing", "progress": 0}

>>>>>>> media-creation-optimization
    status_raw = str(task_data.get("status", "RUNNING")).upper()
    now_ts = int(time.time())
    model_name = str(task_data.get("model", ""))

    response: dict = {
        "id": task_id,
        "task_id": task_id,
        "object": "task",
        "model": model_name,
        "created_at": now_ts,
    }

    if status_raw in ("SUCCESS", "COMPLETED", "COMPLETE", "DONE", "SUCCEEDED"):
        url = extract_result_url(task_data)
        text = extract_result_text(task_data)
        response["status"] = "completed"
        response["progress"] = 100
        response["completed_at"] = now_ts
        if url:
            response["url"] = url
        if text:
            response["text"] = text
    elif status_raw in ("FAILED", "FAILURE", "FAIL", "ERROR", "CANCELLED"):
        response["status"] = "failed"
        response["progress"] = 100
        response["completed_at"] = now_ts
        error_msg = (
            task_data.get("failReason") or
            task_data.get("fail_reason") or
            task_data.get("error") or
            task_data.get("msg") or
            "Task failed"
        )
        response["error"] = {"message": str(error_msg), "code": "TASK_FAILED"}
    else:
        response["status"] = "processing"
        response["progress"] = 0

    return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("rh-adapter starting...")
    if not RUNNINGHUB_API_KEY:
        logger.warning("RUNNINGHUB_API_KEY not set! All requests will fail.")
    yield
    global _client
    if _client and not _client.is_closed:
        await _client.aclose()
    logger.info("rh-adapter stopped.")


# ── FastAPI app ──
app = FastAPI(
    title="rh-adapter",
    description="RunningHub protocol adapter — translates OpenAI-compatible API to RunningHub native API",
    version="0.1.0",
    lifespan=lifespan,
)

# Register error handlers
app.add_exception_handler(RHError, rh_error_handler)
app.add_exception_handler(Exception, general_exception_handler)


# ── Middleware ──

@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    elapsed_ms = (time.time() - start) * 1000
    logger.info(
        "%s %s → %d (%.0fms)",
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
    )
    return response


# ── Health ──

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "rh-adapter",
        "version": "0.1.0",
        "models": len(MODEL_MAP),
    }


# ── API Key check ──

@app.post("/check")
async def check():
    if not RUNNINGHUB_API_KEY:
        return JSONResponse(
            status_code=500,
            content={"status": "no_key", "message": "RUNNINGHUB_API_KEY not configured"},
        )
    client = await get_client()
    result = await check_health(client, RUNNINGHUB_API_KEY)
    return result


# ── List models ──

@app.get("/v1/models")
async def list_models():
    """Return all RH models with official capability params from capabilities.json."""
    capabilities = load_official_capabilities()
    models_data = []
    for model_id, info in MODEL_MAP.items():
        endpoint = info.get("endpoint", "")
        cap = capabilities.get(endpoint, {})
        params = cap.get("params", [])
        # Also check fallback_endpoint for params
        if not params and info.get("fallback_endpoint"):
            cap_fallback = capabilities.get(info["fallback_endpoint"], {})
            params = cap_fallback.get("params", [])
        models_data.append({
            "id": model_id,
            "object": "model",
            "owned_by": "runninghub",
            "label": info.get("label", model_id),
            "output_type": info.get("output_type", "unknown"),
            "custom": bool(info.get("custom")),
            "params": params,
        })
    return {"object": "list", "data": models_data}


# ── Image generation ──

@app.post("/v1/images/generations")
async def create_image(request: ImageRequest):
    """Submit image generation. Returns task_id immediately."""
    if not RUNNINGHUB_API_KEY:
        raise HTTPException(500, "RUNNINGHUB_API_KEY not configured")

    client = await get_client()
    result = await generate_image(client, request, RUNNINGHUB_API_KEY)
    return result


# ── Video generation ──

@app.post("/v1/videos")
async def create_video(request: VideoRequest):
    """Submit video generation. Returns task_id immediately."""
    if not RUNNINGHUB_API_KEY:
        raise HTTPException(500, "RUNNINGHUB_API_KEY not configured")

    client = await get_client()
    result = await generate_video(client, request, RUNNINGHUB_API_KEY)
    return result


@app.get("/v1/videos/{task_id}")
async def get_video_task_status(task_id: str):
    """Sora/NewAPI polling endpoint. NewAPI polls this with the real RH task id."""
    if not RUNNINGHUB_API_KEY:
        raise HTTPException(500, "RUNNINGHUB_API_KEY not configured")

    client = await get_client()
    task_data = await query_task(client, RUNNINGHUB_API_KEY, task_id)
    return build_task_status_response(task_id, task_data)


# ── Audio generation ──

@app.post("/v1/audio/speech")
@app.post("/v1/audios")
async def create_speech(request: AudioRequest):
    """Submit audio generation. Returns task_id immediately."""
    if not RUNNINGHUB_API_KEY:
        raise HTTPException(500, "RUNNINGHUB_API_KEY not configured")

    client = await get_client()
    result = await generate_audio(client, request, RUNNINGHUB_API_KEY)
    return result


# ── Task status query (polled by frontend via Nginx, not through NewAPI) ──

@app.get("/tasks/{task_id}")
async def get_task_status(task_id: str, ai_app: bool = False):
    """Stateless query: calls RH /openapi/v2/query once, returns current status."""
    if not RUNNINGHUB_API_KEY:
        raise HTTPException(500, "RUNNINGHUB_API_KEY not configured")

    client = await get_client()

    if ai_app:
        task_data = await query_ai_app_task(client, RUNNINGHUB_API_KEY, task_id)
    else:
        task_data = await query_task(client, RUNNINGHUB_API_KEY, task_id)

    return build_task_status_response(task_id, task_data)

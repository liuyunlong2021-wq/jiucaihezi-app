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

import json
import logging
import sys
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response

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
    """Translate one RunningHub task query response to NewAPI/Sora-friendly JSON.

    The response format matches the ``responseTask`` struct in NewAPI's
    ``relay/channel/task/sora/adaptor.go`` ParseTaskResult().  It also adds
    ``model`` / ``object`` / ``created_at`` for broad Sora compatibility.
    """
    if not isinstance(task_data, dict):
        logger.warning("build_task_status_response received non-dict task_data: %s", type(task_data).__name__)
        return {"id": task_id, "task_id": task_id, "status": "processing", "progress": 0}

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


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Log Pydantic validation errors with full detail for debugging."""
    body = ""
    try:
        body = (await request.body()).decode("utf-8", errors="replace")[:800]
    except Exception:
        pass
    logger.error(
        "RequestValidationError: %s\n  body=%s",
        exc.errors(),
        body,
    )
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors()},
    )


# ── Middleware ──

@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    # ★ 调试：对图片生成请求记录原始 body
    if request.method == "POST" and request.url.path == "/v1/images/generations":
        raw_body = ""
        try:
            raw_body = (await request.body()).decode("utf-8", errors="replace")
        except Exception:
            raw_body = "<read error>"
        logger.info(">>> RAW REQUEST body keys: %s", sorted(json.loads(raw_body).keys()) if raw_body.startswith("{") else raw_body[:200])
        # 重新构造 request 以便后续 handler 可以读取 body
        async def receive():
            return {"type": "http.request", "body": raw_body.encode("utf-8")}
        request = Request(request.scope, receive)
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


# ── AI App node discovery ──

@app.get("/api/runninghub/app-info")
async def app_info(webappId: str = ""):
    """Return modifiable nodes for a RunningHub AI App (ComfyUI workflow)."""
    if not RUNNINGHUB_API_KEY:
        raise HTTPException(500, "RUNNINGHUB_API_KEY not configured")
    if not webappId:
        raise HTTPException(400, "webappId required")
    client = await get_client()
    from .services.ai_app import fetch_ai_app_node_info
    nodes = await fetch_ai_app_node_info(client, RUNNINGHUB_API_KEY, webappId)
    return {"nodeInfoList": nodes}


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


# ── RH Native API proxy (for RH_CLI fork) ──
# 韭菜盒子定制：RH_CLI fork 设置 RH_API_HOST 指向本服务后，
# 所有 RH 原生 API 请求经此路由透传到 RunningHub，
# 鉴权由服务器端 RUNNINGHUB_API_KEY 注入，用户无需自备 Key。

_RH_PROXY_ROUTES: list[tuple[str, str]] = [
    ("openapi/v2/", "https://www.runninghub.cn"),
    ("uc/", "https://www.runninghub.cn"),
    ("api/", "https://www.runninghub.cn"),
    ("task/openapi/ai-app/run", "https://www.runninghub.ai"),
    ("task/openapi/status", "https://www.runninghub.ai"),
    ("task/openapi/outputs", "https://www.runninghub.ai"),
    ("task/openapi/upload", "https://www.runninghub.cn"),
]


def _map_rh_target(path: str) -> str | None:
    for prefix, base in _RH_PROXY_ROUTES:
        if path.startswith(prefix):
            return f"{base}/{path}"
    return None


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def rh_native_proxy(request: Request, path: str):
    """透传 RH 原生 API 请求到 RunningHub，注入服务器端 API Key。"""
    if not RUNNINGHUB_API_KEY:
        raise HTTPException(500, "RUNNINGHUB_API_KEY not configured")

    target = _map_rh_target(path)
    if target is None:
        raise HTTPException(404, detail=f"Not found: /{path}")

    client = await get_client()
    body = await request.body()

    # 将 body 中的 apikey 替换为服务器端真实 Key（rh check 等接口用 body 传 key）
    if body and b"apikey" in body:
        try:
            payload = json.loads(body)
            if isinstance(payload, dict) and "apikey" in payload:
                payload["apikey"] = RUNNINGHUB_API_KEY
                body = json.dumps(payload).encode("utf-8")
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass  # 非 JSON body，原样透传

    fwd_headers: dict[str, str] = {
        "Authorization": f"Bearer {RUNNINGHUB_API_KEY}",
    }
    content_type = request.headers.get("content-type", "")
    if content_type:
        fwd_headers["Content-Type"] = content_type

    logger.info("RH proxy: %s /%s → %s", request.method, path, target)

    resp = await client.request(
        method=request.method,
        url=target,
        content=body or None,
        params=dict(request.query_params) or None,
        headers=fwd_headers,
    )

    # httpx 已自动解压，透传时去掉压缩头避免下游二次解压
    resp_headers = {k: v for k, v in resp.headers.items()
                    if k.lower() not in ("content-encoding", "transfer-encoding")}

    return Response(
        content=resp.content,
        status_code=resp.status_code,
        headers=resp_headers,
    )

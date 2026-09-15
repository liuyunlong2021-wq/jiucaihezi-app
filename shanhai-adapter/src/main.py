"""山海画布（shanhai.vnshu.cn）适配器 —— OpenAI 兼容面 → Open Canvas API。

链路：创作面板 → NewAPI（计费/鉴权）→ 本服务 /v1/videos → 山海 POST /generations
      → 轮询 GET /tasks/{id} → 成片由本服务 /v1/videos/{id}/content 代理下载。

山海不是 OpenAI 兼容上游：提交走 POST /generations（media_type + inputs + options），
完成后 output.url（/media/runs/{id}）必须带同一枚渠道 Bearer Key 才能下载，客户端不持有
渠道 Key，因此任务完成时只返回相对路径 /v1/videos/{id}/content，由 NewAPI 转发回本服务，
本服务带 Key 拉取并透传字节。

渠道 Key 沿用 NewAPI 渠道里配置的山海 API Key，由 NewAPI 以 Bearer 透传；本服务不保存 Key。
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import logging
from time import monotonic, time
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.background import BackgroundTask

SHANHAI_BASE_URL = "https://shanhai.vnshu.cn/api/v1"
SHANHAI_SUBMIT_TIMEOUT_SECONDS = 120.0
SHANHAI_HTTP_TIMEOUT = httpx.Timeout(120.0, connect=10.0)
SHANHAI_MEDIA_TIMEOUT = httpx.Timeout(600.0, connect=10.0)
MAX_REFERENCE_IMAGES = 10

logger = logging.getLogger("shanhai_adapter")

# 面板发的是 NewAPI 渠道里的**公开模型名**（山seedance2.5 / 海seedance2.5），渠道的模型映射
# 会在转发前把它换成山海的上游 id；映射未生效时按下面这张表替换，两种名字都收。
MODEL_ALIASES = {
    "山seedance2.5": "shanhai-dola-seedance-v2-5-30-9-0-7",
    "海seedance2.5": "oc-model-r5cfh8",
}

# 只接按次计费的两条 Seedance 2.5 线路（9 图参考生视频，720p）。
MODELS = {
    "shanhai-dola-seedance-v2-5-30-9-0-7",
    "oc-model-r5cfh8",
    *MODEL_ALIASES,
}

# 建单时记下这枚渠道 Key：轮询与成片下载端点可能不带渠道 Key 过来，
# 而上游三个端点都要求同一枚 Key（zx-video-adapter / boluo-minimax-adapter 同做法）。
TASK_KEYS: dict[str, tuple[float, str]] = {}
TASK_KEY_TTL_SECONDS = 6 * 3600

AUTO_RATIOS = {"", "auto", "adaptive", "empty"}
RATIO_KEYS = ("aspect_ratio", "ratio", "aspectRatio")
IMAGE_KEYS = ("images", "image", "imageUrl", "imageUrls")
AUDIO_KEYS = ("audios", "audio", "audioUrl", "audioUrls")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http = httpx.AsyncClient(timeout=SHANHAI_HTTP_TIMEOUT)
    yield
    await app.state.http.aclose()


app = FastAPI(title="Shanhai Canvas Adapter", version="0.1.0", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "shanhai-adapter", "models": sorted(MODELS)}


@app.get("/v1/models")
async def models(request: Request):
    """透传山海模型目录，用于核对渠道 Key 与上游真实能力。"""
    data = await shanhai_get(request, "/models")
    return data


@app.post("/v1/videos")
async def create_video(request: Request):
    key = bearer_token(request)
    body = await json_body(request)
    payload = generation_payload(body)
    started_at = monotonic()
    try:
        async with asyncio.timeout(SHANHAI_SUBMIT_TIMEOUT_SECONDS):
            response = await request.app.state.http.post(
                f"{SHANHAI_BASE_URL}/generations",
                headers={"Authorization": f"Bearer {key}"},
                json=payload,
            )
    except (httpx.HTTPError, TimeoutError) as exc:
        logger.warning(
            "Shanhai submit failed exception=%s elapsed=%.3fs",
            type(exc).__name__,
            monotonic() - started_at,
        )
        raise HTTPException(502, "Shanhai generation service is unavailable") from exc
    data = response_json(response)
    if not response.is_success:
        raise upstream_error(response, data)
    result = submitted_response(data, str(body.get("model") or "").strip())
    remember_task_key(result["id"], key)
    return result


@app.get("/v1/videos/{task_id}")
async def get_video(task_id: str, request: Request):
    validate_task_id(task_id)
    data = await shanhai_get(request, f"/tasks/{task_id}", task_key(task_id, request))
    return task_response(task_id, data)


@app.get("/v1/videos/{task_id}/content")
async def get_video_content(task_id: str, request: Request):
    """带渠道 Key 代理山海成片；透传 Range 以支持播放与断点续传。"""
    validate_task_id(task_id)
    key = task_key(task_id, request)
    headers = {"Authorization": f"Bearer {key}"}
    range_header = request.headers.get("range")
    if range_header:
        headers["Range"] = range_header
    stream = request.app.state.http.stream(
        "GET",
        f"{SHANHAI_BASE_URL}/media/runs/{task_id}",
        headers=headers,
        timeout=SHANHAI_MEDIA_TIMEOUT,
    )
    try:
        response = await stream.__aenter__()
    except httpx.HTTPError as exc:
        raise HTTPException(502, "Shanhai media service is unavailable") from exc
    if not response.is_success:
        await stream.__aexit__(None, None, None)
        raise HTTPException(502, f"Shanhai media download failed ({response.status_code})")
    passthrough = {
        key: value
        for key, value in response.headers.items()
        if key.lower()
        in {"content-type", "content-length", "accept-ranges", "content-range", "etag", "last-modified"}
    }
    return StreamingResponse(
        response.aiter_bytes(),
        status_code=response.status_code,
        headers=passthrough,
        background=BackgroundTask(stream.__aexit__, None, None, None),
    )


async def shanhai_get(request: Request, path: str, key: str | None = None) -> dict:
    key = key or bearer_token(request)
    try:
        response = await request.app.state.http.get(
            f"{SHANHAI_BASE_URL}{path}",
            headers={"Authorization": f"Bearer {key}"},
        )
    except httpx.HTTPError as exc:
        raise HTTPException(502, "Shanhai service is unavailable") from exc
    data = response_json(response)
    if not response.is_success:
        raise upstream_error(response, data)
    return data


def remember_task_key(task_id: str, key: str) -> None:
    # ponytail: 惰性清理，只在有请求进来时触发；单容器够用，不为它起后台线程。
    deadline = time() - TASK_KEY_TTL_SECONDS
    for stale in [
        expired for expired, (created_at, _) in TASK_KEYS.items() if created_at < deadline
    ]:
        TASK_KEYS.pop(stale, None)
    TASK_KEYS[task_id] = (time(), key)


def task_key(task_id: str, request: Request) -> str:
    incoming = bearer_token(request)
    stored = TASK_KEYS.get(task_id)
    return stored[1] if stored else incoming


def bearer_token(request: Request) -> str:
    value = request.headers.get("authorization", "").strip()
    if not value.lower().startswith("bearer ") or not value[7:].strip():
        raise HTTPException(401, "Missing Shanhai API key")
    return value[7:].strip()


async def json_body(request: Request) -> dict:
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(400, "Invalid JSON body") from exc
    if not isinstance(body, dict):
        raise HTTPException(400, "JSON object required")
    return body


def validate_task_id(task_id: str) -> None:
    if not task_id or "/" in task_id or ".." in task_id:
        raise HTTPException(400, "Invalid task ID")


def generation_payload(body: dict) -> dict:
    model = str(body.get("model") or "").strip()
    if model not in MODELS:
        raise HTTPException(400, "Unsupported Shanhai model")
    upstream_model = MODEL_ALIASES.get(model, model)
    prompt = prompt_text(body.get("prompt"))
    if not prompt:
        raise HTTPException(400, "prompt is required")
    # ponytail: 参考音频需要先走山海 POST /uploads/audio 拿公开地址，本轮未接；显式报错好过静默丢弃。
    if first_value(body, AUDIO_KEYS) is not None:
        raise HTTPException(422, "Shanhai adapter does not support audio references yet")

    payload: dict = {
        "model": upstream_model,
        "prompt": prompt,
        "media_type": "video",
    }
    images = reference_images(body)
    if images:
        payload["inputs"] = [{"type": "image", "url": url} for url in images]

    options: dict = {}
    ratio = first_text(body, RATIO_KEYS)
    if ratio and ratio.lower() not in AUTO_RATIOS:
        options["aspect_ratio"] = ratio
    resolution = first_text(body, ("resolution",))
    if resolution:
        options["resolution"] = resolution
    duration = number_text(first_value(body, ("duration", "seconds")))
    if duration:
        options["duration"] = duration
    if options:
        payload["options"] = options
    return payload


def reference_images(body: dict) -> list[str]:
    raw = first_value(body, IMAGE_KEYS)
    items = raw if isinstance(raw, list) else [raw] if raw is not None else []
    urls: list[str] = []
    for item in items:
        url = item.get("url") if isinstance(item, dict) else item
        if not isinstance(url, str) or not valid_media_url(url.strip()):
            raise HTTPException(422, "Image references must be public HTTPS URLs")
        clean = url.strip()
        if clean not in urls:
            urls.append(clean)
    if len(urls) > MAX_REFERENCE_IMAGES:
        raise HTTPException(422, f"Shanhai accepts at most {MAX_REFERENCE_IMAGES} reference images")
    return urls


def valid_media_url(value: str) -> bool:
    parsed = urlsplit(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def prompt_text(value: object) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        parts = [
            item.get("text", "")
            for item in value
            if isinstance(item, dict) and isinstance(item.get("text"), str)
        ]
        return "\n".join(part.strip() for part in parts if part.strip())
    return ""


def first_value(body: dict, keys: tuple[str, ...]) -> object:
    for key in keys:
        value = body.get(key)
        if value is None or value == "" or value == []:
            continue
        return value
    return None


def first_text(body: dict, keys: tuple[str, ...]) -> str:
    value = first_value(body, keys)
    return value.strip() if isinstance(value, str) else ""


def number_text(value: object) -> str:
    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, (int, float)):
        return str(int(value)) if float(value).is_integer() else str(value)
    if isinstance(value, str):
        clean = value.strip()
        try:
            return str(int(float(clean)))
        except ValueError:
            return clean
    return ""


def submitted_response(data: dict, model: str) -> dict:
    task_id = task_id_from(data)
    if not task_id:
        raise HTTPException(502, "Shanhai response did not include a task ID")
    return {
        "id": task_id,
        "task_id": task_id,
        "object": "video",
        "model": model,
        "status": "processing",
        "progress": 0,
        "created_at": int(time()),
    }


def task_response(task_id: str, data: dict) -> dict:
    raw_status = str(data.get("status") or "").strip().lower()
    model = str(data.get("model") or "")
    result = {
        "id": task_id,
        "task_id": task_id,
        "object": "video",
        "model": model,
        "status": normalize_status(raw_status),
        "progress": 0,
        "created_at": int(time()),
    }
    if result["status"] == "completed":
        output = data.get("output") if isinstance(data.get("output"), dict) else {}
        if not output.get("url"):
            return failed_response(result, "Shanhai finished without a media URL")
        kind = str(output.get("type") or "video")
        # 相对路径：客户端会拼上 NewAPI 域名，由 NewAPI 转发回本服务的代理端点。
        result["object"] = kind
        result["progress"] = 100
        result[f"{kind}_url"] = f"/v1/videos/{task_id}/content"
        result["completed_at"] = int(time())
        return result
    if result["status"] == "failed":
        error = data.get("error") if isinstance(data.get("error"), dict) else {}
        message = str(error.get("message") or error.get("code") or "Shanhai task failed")
        return failed_response(result, message)
    return result


def failed_response(result: dict, message: str) -> dict:
    result["status"] = "failed"
    result["error"] = {"code": "TASK_FAILED", "message": message}
    result["fail_reason"] = message
    result["completed_at"] = int(time())
    return result


def normalize_status(raw_status: str) -> str:
    if raw_status in {"succeeded", "success", "complete", "completed", "done"}:
        return "completed"
    if raw_status in {"failed", "failure", "fail", "error", "cancelled", "canceled"}:
        return "failed"
    # queued / running / pending / 未知状态都按处理中，避免把仍在生成的任务判成失败。
    return "processing"


def task_id_from(data: dict) -> str:
    inner = data.get("data") if isinstance(data.get("data"), dict) else {}
    return str(data.get("id") or data.get("task_id") or inner.get("id") or "")


def response_json(response: httpx.Response) -> dict:
    try:
        data = response.json()
    except ValueError as exc:
        raise HTTPException(502, "Shanhai returned invalid JSON") from exc
    if not isinstance(data, dict):
        raise HTTPException(502, "Shanhai returned an invalid response")
    return data


def upstream_error(response: httpx.Response, data: dict) -> HTTPException:
    error = data.get("error") if isinstance(data.get("error"), dict) else {}
    detail = error.get("message") or data.get("message") or f"Shanhai request failed ({response.status_code})"
    status = response.status_code if 400 <= response.status_code < 500 else 502
    return HTTPException(status, str(detail))


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"message": str(exc.detail), "type": "shanhai_adapter_error"}},
    )

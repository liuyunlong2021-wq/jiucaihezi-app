from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import logging
from time import monotonic, time
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

KIK_BASE_URL = "https://51kik.com/providers/volcengine"
KIK_TASKS_PATH = "/api/v3/contents/generations/tasks"
KIK_TOTAL_TIMEOUT_SECONDS = 120.0
KIK_HTTP_TIMEOUT = httpx.Timeout(120.0, connect=10.0)
logger = logging.getLogger("kik_seedance_adapter")
MODELS = {
    "doubao-seedance-2",
    "doubao-seedance-2-0-fast-260128",
    "doubao-seedance-2-mini",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http = httpx.AsyncClient(timeout=KIK_HTTP_TIMEOUT)
    yield
    await app.state.http.aclose()


app = FastAPI(title="KIK Seedance Adapter", version="0.1.0", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "kik-seedance-adapter", "models": sorted(MODELS)}


@app.get("/v1/models")
async def models():
    return {"object": "list", "data": [{"id": model, "object": "model", "owned_by": "kik"} for model in sorted(MODELS)]}


@app.post("/v1/videos")
async def create_video(request: Request):
    key = bearer_token(request)
    body = await json_body(request)
    payload = kik_payload(body)
    started_at = monotonic()
    try:
        async with asyncio.timeout(KIK_TOTAL_TIMEOUT_SECONDS):
            response = await request.app.state.http.post(
                f"{KIK_BASE_URL}{KIK_TASKS_PATH}",
                headers={"Authorization": f"Bearer {key}"},
                json=payload,
            )
    except (httpx.HTTPError, TimeoutError) as exc:
        logger.warning("KIK submit failed exception=%s elapsed=%.3fs", type(exc).__name__, monotonic() - started_at)
        raise HTTPException(502, "KIK video service is unavailable") from exc
    data = response_json(response)
    if not response.is_success:
        raise upstream_error(response, data)
    task_id = task_id_from(data)
    if not task_id:
        raise HTTPException(502, "KIK response did not include a task ID")
    return task_response(task_id, data, body["model"])


@app.get("/v1/videos/{task_id}")
async def get_video(task_id: str, request: Request):
    if not task_id or "/" in task_id:
        raise HTTPException(400, "Invalid task ID")
    key = bearer_token(request)
    started_at = monotonic()
    try:
        response = await request.app.state.http.get(
            f"{KIK_BASE_URL}{KIK_TASKS_PATH}/{task_id}",
            headers={"Authorization": f"Bearer {key}"},
        )
    except httpx.HTTPError as exc:
        logger.warning("KIK poll failed exception=%s elapsed=%.3fs", type(exc).__name__, monotonic() - started_at)
        raise HTTPException(502, "KIK video service is unavailable") from exc
    data = response_json(response)
    if not response.is_success:
        raise upstream_error(response, data)
    return task_response(task_id, data, str(data.get("model") or ""))


def bearer_token(request: Request) -> str:
    value = request.headers.get("authorization", "").strip()
    if not value.lower().startswith("bearer ") or not value[7:].strip():
        raise HTTPException(401, "Missing upstream API key")
    return value[7:].strip()


async def json_body(request: Request) -> dict:
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(400, "Invalid JSON body") from exc
    if not isinstance(body, dict):
        raise HTTPException(400, "JSON object required")
    return body


def validate_request(body: dict) -> None:
    if body.get("model") not in MODELS:
        raise HTTPException(400, "Unsupported model")
    prompt = prompt_text(body.get("prompt"))
    if not prompt:
        raise HTTPException(400, "prompt is required")
    duration = body.get("duration")
    if duration is not None and (isinstance(duration, bool) or not isinstance(duration, int) or not 4 <= duration <= 15):
        raise HTTPException(400, "duration must be an integer from 4 to 15")


def kik_payload(body: dict) -> dict:
    validate_request(body)
    content = [{"type": "text", "text": prompt_text(body.get("prompt"))}]
    prompt_media = prompt_references(body.get("prompt"))
    media_counts = {}
    for kind, sources, maximum in (
        ("image", ("image", "images"), 9),
        ("video", ("video", "video_url"), 1),
        ("audio", ("audio", "audio_url"), 1),
    ):
        value = next((body[source] for source in sources if body.get(source)), None)
        if value is None:
            value = prompt_media[kind] or None
        items = media_content(value, kind) if value is not None else []
        if len(items) > maximum:
            raise HTTPException(400, f"{kind} supports at most {maximum} reference(s)")
        media_counts[kind] = len(items)
        content.extend(items)
    if media_counts["audio"] and not (media_counts["image"] or media_counts["video"]):
        raise HTTPException(400, "audio requires an image or video reference")
    payload = {"model": body["model"], "content": content}
    for key in ("ratio", "resolution", "duration"):
        if body.get(key) is not None:
            payload[key] = body[key]
    return payload


def prompt_text(value: object) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        parts = [item.get("text", "") for item in value if isinstance(item, dict) and isinstance(item.get("text"), str)]
        return "\n".join(part.strip() for part in parts if part.strip())
    return ""


def prompt_references(value: object) -> dict[str, list[object]]:
    result: dict[str, list[object]] = {"image": [], "video": [], "audio": []}
    if not isinstance(value, list):
        return result
    for item in value:
        if not isinstance(item, dict):
            continue
        kind = {"image_url": "image", "video_url": "video", "audio_url": "audio"}.get(str(item.get("type") or ""))
        if not kind:
            continue
        result[kind].append(item)
    return result


def media_content(value: object, kind: str) -> list[dict[str, object]]:
    values = value if isinstance(value, list) else [value]
    result: list[dict[str, object]] = []
    content_type = f"{kind}_url"
    default_role = {"image": "reference_image", "video": "reference_video", "audio": "reference_audio"}[kind]
    allowed_roles = {
        "image": {"first_frame", "last_frame", "reference_image"},
        "video": {"reference_video"},
        "audio": {"reference_audio"},
    }[kind]
    for item in values:
        role = default_role
        if isinstance(item, str) and item.strip():
            url = item.strip()
        elif isinstance(item, dict):
            explicit_role = item.get("role") or item.get("type")
            if explicit_role and explicit_role != content_type:
                role = str(explicit_role)
            if role not in allowed_roles:
                raise HTTPException(400, f"Invalid {kind} role")
            url = item.get("url") or item.get(content_type)
            if isinstance(url, dict):
                url = url.get("url")
        else:
            url = None
        if not isinstance(url, str) or not valid_media_url(url.strip(), kind):
            raise HTTPException(400, f"{kind} must contain a valid URL")
        result.append({"type": content_type, content_type: {"url": url.strip()}, "role": role})
    return result


def valid_media_url(value: str, kind: str) -> bool:
    parsed = urlsplit(value)
    if parsed.scheme in {"http", "https", "asset"}:
        return bool(parsed.netloc)
    return kind == "image" and value.startswith("data:image/") and "," in value


def response_json(response: httpx.Response) -> dict:
    try:
        data = response.json()
    except ValueError as exc:
        raise HTTPException(502, "KIK returned invalid JSON") from exc
    if not isinstance(data, dict):
        raise HTTPException(502, "KIK returned an invalid response")
    return data


def task_id_from(data: dict) -> str:
    inner = data.get("data") if isinstance(data.get("data"), dict) else {}
    return str(data.get("task_id") or data.get("id") or inner.get("task_id") or inner.get("id") or "")


def task_response(task_id: str, data: dict, model: str) -> dict:
    inner = data.get("data") if isinstance(data.get("data"), dict) else data
    raw_status = str(data.get("task_status") or data.get("status") or inner.get("task_status") or inner.get("status") or "pending").strip()
    normalized_status = raw_status.lower()
    if normalized_status in {"success", "succeeded", "complete", "completed", "done"}:
        status = "completed"
    elif normalized_status in {"pending", "running", "processing", "queued", "queueing", "submitting", "in_progress"}:
        status = "processing"
    else:
        status = "failed"
    result = {
        "id": task_id,
        "task_id": task_id,
        "object": "video",
        "model": model or str(data.get("model") or ""),
        "status": status,
        "progress": 100 if status == "completed" else 0,
        "created_at": int(time()),
    }
    if status == "completed":
        url = video_url(data)
        if not url:
            raise HTTPException(502, "KIK completed without a video URL")
        result["video_url"] = url
        result["completed_at"] = int(time())
    if status in {"failed", "error"}:
        result["error"] = data.get("error") or {"code": raw_status or "TASK_FAILED", "message": str(data.get("message") or raw_status or "KIK task failed")}
        result["completed_at"] = int(time())
    return result


def video_url(data: dict) -> str:
    content = data.get("content")
    return content.get("video_url", "") if isinstance(content, dict) and isinstance(content.get("video_url"), str) else ""


def upstream_error(response: httpx.Response, data: dict) -> HTTPException:
    detail = data.get("error") or data.get("message") or f"KIK request failed ({response.status_code})"
    if isinstance(detail, dict):
        detail = detail.get("message") or detail.get("code") or f"KIK request failed ({response.status_code})"
    return HTTPException(response.status_code if response.status_code >= 400 else 502, str(detail))


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": {"message": str(exc.detail), "type": "kik_seedance_error"}})

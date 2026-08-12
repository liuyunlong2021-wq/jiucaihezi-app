from __future__ import annotations

from contextlib import asynccontextmanager
from time import time

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

KIK_BASE_URL = "https://51kik.com/video"
MODELS = {
    "doubao-seedance-2",
    "doubao-seedance-2-0-fast-260128",
    "doubao-seedance-2-mini",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0))
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
    validate_request(body)
    try:
        response = await request.app.state.http.post(
            f"{KIK_BASE_URL}/v1/generations",
            headers={"Authorization": f"Bearer {key}"},
            json=kik_payload(body),
        )
    except httpx.HTTPError as exc:
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
    try:
        response = await request.app.state.http.get(
            f"{KIK_BASE_URL}/v1/tasks/{task_id}",
            headers={"Authorization": f"Bearer {key}"},
        )
    except httpx.HTTPError as exc:
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


def kik_payload(body: dict) -> dict:
    payload = {key: body[key] for key in ("model", "ratio", "resolution") if body.get(key) is not None}
    payload["prompt"] = prompt_text(body.get("prompt"))
    prompt_media = prompt_references(body.get("prompt"))
    for target, sources, role in (
        ("image", ("image", "images"), "reference_image"),
        ("video", ("video", "video_url"), "reference_video"),
        ("audio", ("audio", "audio_url"), "reference_audio"),
    ):
        value = next((body[source] for source in sources if body.get(source) is not None), None)
        if value is None:
            value = prompt_media.get(target)
        if value is not None:
            payload[target] = media_references(value, role)
    options = dict(body.get("upstream_options") or {})
    if body.get("duration") is not None:
        try:
            options["duration"] = float(body["duration"])
        except (TypeError, ValueError) as exc:
            raise HTTPException(400, "duration must be a number") from exc
    if options:
        payload["upstream_options"] = options
    return payload


def prompt_text(value: object) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        parts = [item.get("text", "") for item in value if isinstance(item, dict) and isinstance(item.get("text"), str)]
        return "\n".join(part.strip() for part in parts if part.strip())
    return ""


def prompt_references(value: object) -> dict[str, list[dict[str, str]]]:
    result: dict[str, list[dict[str, str]]] = {"image": [], "video": [], "audio": []}
    if not isinstance(value, list):
        return result
    for item in value:
        if not isinstance(item, dict):
            continue
        kind = {"image_url": "image", "video_url": "video", "audio_url": "audio"}.get(str(item.get("type") or ""))
        if not kind:
            continue
        raw = item.get(item.get("type"))
        url = raw.get("url") if isinstance(raw, dict) else raw
        if isinstance(url, str) and url.strip():
            result[kind].append({"type": {"image": "reference_image", "video": "reference_video", "audio": "reference_audio"}[kind], "url": url.strip()})
    return result


def media_references(value: object, default_role: str) -> object:
    values = value if isinstance(value, list) else [value]
    result = []
    for item in values:
        if isinstance(item, str) and item.strip():
            result.append({"type": default_role, "url": item.strip()})
        elif isinstance(item, dict):
            url = item.get("url") or item.get("image_url") or item.get("video_url") or item.get("audio_url")
            if isinstance(url, dict):
                url = url.get("url")
            if isinstance(url, str) and url.strip():
                result.append({"type": str(item.get("type") or default_role), "url": url.strip()})
    if not result:
        raise HTTPException(400, f"{default_role} must contain a valid URL")
    return result[0] if len(result) == 1 else result


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
    raw_status = str(data.get("task_status") or data.get("status") or inner.get("task_status") or inner.get("status") or "pending").lower()
    status = {"success": "completed", "succeeded": "completed", "complete": "completed", "pending": "processing", "running": "processing", "cancelled": "failed", "canceled": "failed"}.get(raw_status, raw_status)
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
        result["error"] = data.get("error") or {"code": "TASK_FAILED", "message": str(data.get("message") or "KIK task failed")}
        result["completed_at"] = int(time())
    return result


def video_url(data: dict) -> str:
    for source in (data, data.get("data")):
        if not isinstance(source, dict):
            continue
        if isinstance(source.get("url"), str):
            return source["url"]
        items = source.get("data")
        if isinstance(items, list) and items and isinstance(items[0], dict) and isinstance(items[0].get("url"), str):
            return items[0]["url"]
    return ""


def upstream_error(response: httpx.Response, data: dict) -> HTTPException:
    detail = data.get("error") or data.get("message") or f"KIK request failed ({response.status_code})"
    return HTTPException(response.status_code if response.status_code >= 400 else 502, str(detail))


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": {"message": str(exc.detail), "type": "kik_seedance_error"}})

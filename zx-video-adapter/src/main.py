from __future__ import annotations

import base64
import binascii
import json
import logging
import mimetypes
import re
from contextlib import asynccontextmanager
from ipaddress import ip_address
from time import time
from urllib.parse import unquote

import httpx
from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

BASE_URL = "https://img-api.zxcode.vip"
MODELS = {
    "grok-1.5-video-6s": 6,
    "grok-1.5-video-10s": 10,
    "grok-1.5-video-15s": 15,
}
MAX_PROMPT_CHARS = 5000
MAX_IMAGE_BYTES = 20 * 1024 * 1024
DATA_URL_RE = re.compile(r"^data:(?P<mime>[^;,]+)(?:;[^,]*)?;base64,(?P<data>.+)$", re.I | re.S)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] zx-video-adapter: %(message)s")
logger = logging.getLogger("zx-video-adapter")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http = httpx.AsyncClient(
        timeout=httpx.Timeout(120.0, connect=10.0),
        follow_redirects=True,
        limits=httpx.Limits(max_keepalive_connections=5, max_connections=20),
    )
    yield
    await app.state.http.aclose()


app = FastAPI(title="ZX Grok Video Adapter", version="0.1.0", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "zx-video-adapter", "models": list(MODELS)}


@app.get("/v1/models")
async def models():
    return {
        "object": "list",
        "data": [{"id": model, "object": "model", "owned_by": "zx"} for model in MODELS],
    }


@app.post("/v1/videos")
async def create_video(request: Request):
    authorization = require_authorization(request)
    content_type = request.headers.get("content-type", "")
    if content_type.lower().startswith("multipart/"):
        payload, image = await parse_multipart(request)
    else:
        payload = await parse_json(request)
        image = first_reference(payload)

    model = payload.get("model")
    prompt = payload.get("prompt")
    size = payload.get("size") or "1280x720"
    validate_request(model, prompt, size, image)

    image_name, image_bytes, image_mime = await materialize_image(image, request.app.state.http)
    form = {
        "model": str(model),
        "prompt": str(prompt),
        "size": str(size),
    }
    files = {"input_reference": (image_name, image_bytes, image_mime)}
    try:
        response = await request.app.state.http.post(
            f"{BASE_URL}/v1/videos",
            headers={"Authorization": authorization},
            data=form,
            files=files,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="ZX video service is unavailable") from exc
    body = decode_json(response)
    if not response.is_success:
        raise HTTPException(status_code=502, detail=upstream_error(body, response.status_code))
    task_id = body.get("id") or body.get("task_id")
    if not task_id:
        raise HTTPException(status_code=502, detail="ZX response did not include a task ID")
    logger.info("video submitted: model=%s task=%s", model, task_id)
    return {
        "id": task_id,
        "task_id": task_id,
        "object": "video",
        "model": model,
        "status": normalize_status(body.get("status"), "processing"),
        "progress": body.get("progress", 0),
        "created_at": body.get("created_at", int(time())),
    }


@app.get("/v1/videos/{task_id}")
async def get_video(task_id: str, request: Request):
    authorization = require_authorization(request)
    if not task_id or "/" in task_id:
        raise HTTPException(status_code=400, detail="Invalid task ID")
    try:
        response = await request.app.state.http.get(
            f"{BASE_URL}/v1/videos/{task_id}",
            headers={"Authorization": authorization},
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="ZX video service is unavailable") from exc
    body = decode_json(response)
    if not response.is_success:
        raise HTTPException(status_code=502, detail=upstream_error(body, response.status_code))
    status = normalize_status(body.get("status"), "processing")
    result = {
        "id": body.get("id", task_id),
        "task_id": body.get("task_id", body.get("id", task_id)),
        "object": "video",
        "model": body.get("model", ""),
        "status": status,
        "progress": body.get("progress", 0 if status == "processing" else 100),
        "created_at": body.get("created_at", int(time())),
    }
    if status == "completed":
        video_url = body.get("video_url") or body.get("metadata", {}).get("url")
        if not video_url:
            raise HTTPException(status_code=502, detail="ZX completed without video_url")
        result["video_url"] = video_url
        result["completed_at"] = body.get("completed_at", int(time()))
    elif status == "failed":
        result["error"] = body.get("error") or {
            "code": "TASK_FAILED",
            "message": body.get("errorMessage") or body.get("message") or "ZX video task failed",
        }
        result["completed_at"] = body.get("completed_at", int(time()))
    return result


def require_authorization(request: Request) -> str:
    value = request.headers.get("authorization", "").strip()
    if not value.lower().startswith("bearer ") or not value[7:].strip():
        raise HTTPException(status_code=401, detail="Missing upstream API key")
    return value


async def parse_json(request: Request) -> dict:
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON body") from exc
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="JSON object required")
    return body


async def parse_multipart(request: Request) -> tuple[dict, UploadFile | str | None]:
    try:
        form = await request.form()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid multipart body") from exc
    payload = {key: value for key, value in form.items() if not is_upload(value)}
    image = form.get("input_reference") or form.get("image")
    if is_upload(image):
        return payload, image
    return payload, image if isinstance(image, str) else None


def first_reference(payload: dict):
    for key in ("input_reference", "image"):
        value = payload.get(key)
        if value:
            return value
    for key in ("images", "reference_images"):
        value = payload.get(key)
        if isinstance(value, list) and value:
            first = value[0]
            if isinstance(first, dict):
                return first.get("url") or first.get("image_url")
            return first
    return None


def validate_request(model, prompt, size, image):
    if model not in MODELS:
        raise HTTPException(status_code=400, detail="Unsupported ZX Grok video model")
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > MAX_PROMPT_CHARS:
        raise HTTPException(status_code=400, detail="Prompt is required and too long")
    if size != "1280x720":
        raise HTTPException(status_code=400, detail="ZX Grok video requires size=1280x720")
    if not image:
        raise HTTPException(status_code=400, detail="ZX Grok video requires one reference image")


async def materialize_image(image, client: httpx.AsyncClient):
    if is_upload(image):
        data = await image.read(MAX_IMAGE_BYTES + 1)
        await image.close()
        if len(data) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="Reference image is too large")
        return image.filename or "reference.jpg", data, image.content_type or "image/jpeg"
    if not isinstance(image, str):
        raise HTTPException(status_code=400, detail="Reference image is invalid")
    match = DATA_URL_RE.match(image)
    if match:
        try:
            data = base64.b64decode(match.group("data"), validate=True)
        except (binascii.Error, ValueError) as exc:
            raise HTTPException(status_code=400, detail="Reference data URL is invalid") from exc
        if len(data) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="Reference image is too large")
        mime = match.group("mime").lower()
        if not mime.startswith("image/"):
            raise HTTPException(status_code=400, detail="Reference must be an image")
        return "reference" + (mimetypes.guess_extension(mime) or ".jpg"), data, mime
    url = validate_public_url(image)
    try:
        response = await client.get(url)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=400, detail="Reference image could not be downloaded") from exc
    if not response.is_success or not response.content:
        raise HTTPException(status_code=400, detail="Reference image could not be downloaded")
    if len(response.content) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Reference image is too large")
    mime = response.headers.get("content-type", "image/jpeg").split(";", 1)[0].lower()
    if not mime.startswith("image/"):
        raise HTTPException(status_code=400, detail="Reference must be an image")
    return "reference" + (mimetypes.guess_extension(mime) or ".jpg"), response.content, mime


def validate_public_url(value: str) -> str:
    try:
        url = httpx.URL(unquote(value))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Reference URL is invalid") from exc
    host = (url.host or "").lower()
    if url.scheme not in ("http", "https") or not host or url.userinfo or host == "localhost" or host.endswith((".localhost", ".local")):
        raise HTTPException(status_code=400, detail="Reference URL is invalid")
    try:
        address = ip_address(host)
    except ValueError:
        return str(url)
    if not address.is_global:
        raise HTTPException(status_code=400, detail="Reference URL is invalid")
    return str(url)


def is_upload(value) -> bool:
    return isinstance(value, UploadFile) or (
        value is not None
        and callable(getattr(value, "read", None))
        and isinstance(getattr(value, "filename", None), str)
    )


def decode_json(response: httpx.Response) -> dict:
    try:
        body = response.json()
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail="ZX returned invalid JSON") from exc
    if not isinstance(body, dict):
        raise HTTPException(status_code=502, detail="ZX returned an invalid response")
    return body


def normalize_status(value, default: str) -> str:
    status = str(value or "").lower()
    if status in {"completed", "complete", "succeeded", "success", "done"}:
        return "completed"
    if status in {"failed", "failure", "error", "cancelled", "canceled"}:
        return "failed"
    return default


def upstream_error(body: dict, status_code: int) -> str:
    error = body.get("error")
    if isinstance(error, dict):
        return str(error.get("message") or error.get("code") or f"ZX request failed ({status_code})")
    return str(body.get("message") or body.get("errorMessage") or f"ZX request failed ({status_code})")

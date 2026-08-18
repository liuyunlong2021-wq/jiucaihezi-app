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
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

BASE_URL = "https://img-api.zxcode.vip"
GROK_MODELS = {
    "grok-1.5-video-6s": 6,
    "grok-1.5-video-10s": 10,
    "grok-1.5-video-15s": 15,
}
SEEDANCE_MODEL = "doubao-seedance-2-5-260628"
MODELS = {**GROK_MODELS, SEEDANCE_MODEL: None, "omni-fast": None, "omni-v2v": None}
SEEDANCE_TASKS: set[str] = set()
MAX_PROMPT_CHARS = 5000
SEEDANCE_MAX_PROMPT_CHARS = 20480
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


app = FastAPI(title="ZX Video Adapter", version="0.2.0", lifespan=lifespan)


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
        payload, images = await parse_multipart(request)
    else:
        payload = await parse_json(request)
        images = references(payload)

    model = payload.get("model")
    prompt = payload.get("prompt")
    validate_common(model, prompt)

    if model == SEEDANCE_MODEL:
        return await submit_seedance(payload, authorization, request.app.state.http)
    if model in GROK_MODELS:
        size = payload.get("size") or "1280x720"
        if size != "1280x720":
            raise HTTPException(status_code=400, detail="ZX Grok video requires size=1280x720")
        if len(images) > 7:
            raise HTTPException(status_code=400, detail="ZX Grok video supports at most 7 reference images")
        if images:
            materialized = [await materialize_image(image, request.app.state.http) for image in images]
            post_kwargs = {
                "data": {"model": str(model), "prompt": str(prompt), "size": str(size)},
                "files": [("input_reference", image) for image in materialized],
            }
        else:
            post_kwargs = {
                "json": {
                    "model": str(model),
                    "prompt": str(prompt),
                    "resolution": str(payload.get("resolution") or "720p"),
                }
            }
    else:
        post_kwargs = {"json": omni_payload(payload, images)}
    try:
        response = await request.app.state.http.post(
            f"{BASE_URL}/v1/videos",
            headers={"Authorization": authorization},
            **post_kwargs,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="ZX video service is unavailable") from exc
    return submitted_response(response, model)


@app.post("/v1/video/generations")
async def create_seedance_video(request: Request):
    authorization = require_authorization(request)
    payload = await parse_json(request)
    model = payload.get("model")
    prompt = payload.get("prompt")
    validate_common(model, prompt)
    if model != SEEDANCE_MODEL:
        raise HTTPException(status_code=400, detail="Unsupported ZX Seedance video model")
    return await submit_seedance(payload, authorization, request.app.state.http)


async def submit_seedance(payload: dict, authorization: str, client: httpx.AsyncClient) -> dict:
    body = seedance_payload(payload)
    try:
        response = await client.post(
            f"{BASE_URL}/v1/video/generations",
            headers={"Authorization": authorization},
            json=body,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="ZX video service is unavailable") from exc
    result = submitted_response(response, SEEDANCE_MODEL)
    SEEDANCE_TASKS.add(result["id"])
    return result


@app.get("/v1/videos/{task_id}/content")
async def get_video_content(task_id: str, request: Request):
    authorization = require_authorization(request)
    validate_task_id(task_id)
    stream = request.app.state.http.stream(
        "GET",
        f"{BASE_URL}/v1/videos/{task_id}/content",
        headers={"Authorization": authorization},
    )
    try:
        response = await stream.__aenter__()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="ZX video service is unavailable") from exc
    if not response.is_success:
        await stream.__aexit__(None, None, None)
        raise HTTPException(status_code=502, detail=f"ZX video download failed ({response.status_code})")
    return StreamingResponse(
        response.aiter_bytes(),
        media_type=response.headers.get("content-type", "video/mp4"),
        background=BackgroundTask(stream.__aexit__, None, None, None),
    )


@app.get("/v1/videos/{task_id}")
async def get_video(task_id: str, request: Request):
    authorization = require_authorization(request)
    validate_task_id(task_id)
    try:
        if task_id in SEEDANCE_TASKS:
            response = await request.app.state.http.get(
                f"{BASE_URL}/v1/video/generations/{task_id}",
                headers={"Authorization": authorization},
            )
        else:
            response = await request.app.state.http.get(
                f"{BASE_URL}/v1/videos/{task_id}",
                headers={"Authorization": authorization},
            )
            if response.status_code in {400, 404}:
                seedance_response = await request.app.state.http.get(
                    f"{BASE_URL}/v1/video/generations/{task_id}",
                    headers={"Authorization": authorization},
                )
                if seedance_response.is_success:
                    response = seedance_response
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="ZX video service is unavailable") from exc
    return normalized_task_response(response, task_id)


@app.get("/v1/video/generations/{task_id}")
async def get_seedance_video(task_id: str, request: Request):
    authorization = require_authorization(request)
    validate_task_id(task_id)
    try:
        response = await request.app.state.http.get(
            f"{BASE_URL}/v1/video/generations/{task_id}",
            headers={"Authorization": authorization},
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="ZX video service is unavailable") from exc
    return normalized_task_response(response, task_id)


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


async def parse_multipart(request: Request) -> tuple[dict, list[UploadFile | str]]:
    try:
        form = await request.form()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid multipart body") from exc
    payload = {key: value for key, value in form.items() if not is_upload(value)}
    images = [
        value for key, value in form.multi_items()
        if key in {"input_reference", "image"} and (is_upload(value) or isinstance(value, str))
    ]
    return payload, images


def references(payload: dict) -> list:
    result = []
    for key in ("input_reference", "image"):
        value = payload.get(key)
        if value:
            result.extend(value if isinstance(value, list) else [value])
    for key in ("images", "reference_images"):
        value = payload.get(key)
        if isinstance(value, list):
            result.extend(value)
    normalized = []
    for value in result:
        if isinstance(value, dict):
            image_url = value.get("image_url")
            value = value.get("url") or (image_url.get("url") if isinstance(image_url, dict) else image_url)
        if value:
            normalized.append(value)
    return normalized


def validate_common(model, prompt):
    if model not in MODELS:
        raise HTTPException(status_code=400, detail="Unsupported ZX video model")
    max_chars = SEEDANCE_MAX_PROMPT_CHARS if model == SEEDANCE_MODEL else MAX_PROMPT_CHARS
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > max_chars:
        raise HTTPException(status_code=400, detail="Prompt is required and too long")


def omni_payload(payload: dict, images: list) -> dict:
    model = payload["model"]
    if model not in {"omni-fast", "omni-v2v"}:
        raise HTTPException(status_code=400, detail="Unsupported ZX Omni video model")
    image_urls = [validate_public_url(str(image)) for image in images]
    video_url = payload.get("video_url") or payload.get("video") or payload.get("videoUrl")
    if model == "omni-v2v" and not video_url:
        raise HTTPException(status_code=400, detail="omni-v2v requires video_url")
    return compact({
        "model": model,
        "prompt": payload["prompt"],
        "aspect_ratio": payload.get("aspect_ratio") or payload.get("ratio") or "16:9",
        "resolution": payload.get("resolution") or "720p",
        "images": image_urls or None,
        "video_url": validate_public_url(str(video_url)) if video_url else None,
    })


def seedance_payload(payload: dict) -> dict:
    duration = payload.get("seconds", payload.get("duration", 5))
    try:
        duration_number = int(duration)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Seedance duration must be 4-30 or -1") from exc
    if duration_number != -1 and not 4 <= duration_number <= 30:
        raise HTTPException(status_code=400, detail="Seedance duration must be 4-30 or -1")
    images = references(payload)
    videos = reference_list(payload, "video_urls", "videoUrls", "video_url")
    audios = reference_list(payload, "audio_urls", "audioUrls", "audio_url")
    if len(images) > 30 or len(videos) > 10 or len(audios) > 10:
        raise HTTPException(status_code=400, detail="Seedance supports at most 30 images, 10 videos and 10 audios")
    content = [
        {"type": "image_url", "role": "reference_image", "image_url": {"url": validate_public_url(str(url))}}
        for url in images
    ]
    for values, kind in ((videos, "video"), (audios, "audio")):
        for url in values:
            content.append({"type": f"{kind}_url", "role": f"reference_{kind}", f"{kind}_url": {"url": validate_public_url(str(url))}})
    metadata = compact({
        "ratio": payload.get("aspect_ratio") or payload.get("ratio") or "adaptive",
        "resolution": str(payload.get("resolution") or "720p").lower(),
        "content": content or None,
        "generate_audio": payload.get("generate_audio"),
        "conversion_slots": payload.get("conversion_slots"),
        "return_last_frame": payload.get("return_last_frame"),
        "real_person_mode": payload.get("real_person_mode"),
        "bitrate_mode": payload.get("bitrate_mode"),
        "seed": payload.get("seed"),
        "output_format": payload.get("output_format"),
        "omni_reference_task_type": payload.get("omni_reference_task_type"),
    })
    return compact({
        "model": payload["model"],
        "prompt": payload["prompt"],
        "seconds": None if duration_number == -1 else str(duration_number),
        "metadata": metadata,
        "webhook_url": payload.get("webhook_url"),
    })


def reference_list(payload: dict, *keys: str) -> list:
    for key in keys:
        value = payload.get(key)
        if value:
            return value if isinstance(value, list) else [value]
    return []


def compact(payload: dict) -> dict:
    return {key: value for key, value in payload.items() if value is not None and value != ""}


def submitted_response(response: httpx.Response, model: str) -> dict:
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


def normalized_task_response(response: httpx.Response, task_id: str) -> dict:
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
        if not video_url and isinstance(body.get("content"), dict):
            video_url = body["content"].get("video_url")
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


def validate_task_id(task_id: str):
    if not task_id or "/" in task_id:
        raise HTTPException(status_code=400, detail="Invalid task ID")


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

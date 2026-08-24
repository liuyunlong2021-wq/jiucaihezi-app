from __future__ import annotations

from contextlib import asynccontextmanager
from time import time

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.background import BackgroundTask
from starlette.datastructures import UploadFile

XIAOYI_BASE_URL = "https://image.xiaoyiapi.xyz/v1"
VIDEO_MODELS = {
    "MiniMaxH3-2k-pro-sec": "2k",
    "MiniMaxH3-2k-sec": "2k",
    "MiniMaxH3-720p-sec": "720p",
}
PUBLIC_MODELS = {
    "gpt-image-2-1k",
    "gpt-image-2-低质量",
    "gpt-image-2-中质量",
    "gpt-image-2-vip",
    "gpt-image-2-官方",
    "gemini-3-pro-image-preview",
    "gemini-3.1-flash-image-preview",
    *VIDEO_MODELS,
}
MODEL_MAP = {
    "gpt-image-2": "gpt-image-2",
    "gpt-image-2-1k": "gpt-image-2",
    "gpt-image-2-低质量": "gpt-image-2",
    "gpt-image-2-中质量": "gpt-image-2",
    "gpt-image-2-vip": "gpt-image-2-vip",
    "gpt-image-2-官方": "gpt-image-2",
    "gemini-3-pro-image-preview": "gemini-3-pro-image-preview",
    "gemini-3.1-flash-image-preview": "gemini-3.1-flash-image-preview",
}
MAX_UPLOADS = 10
MAX_UPLOAD_BYTES = 20 * 1024 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0))
    yield
    await app.state.http.aclose()


app = FastAPI(title="Xiaoyi Image Adapter", version="0.1.0", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "xiaoyi-image-adapter", "models": sorted(PUBLIC_MODELS)}


@app.get("/v1/models")
async def models(request: Request):
    key = bearer_token(request)
    try:
        response = await request.app.state.http.get(
            f"{XIAOYI_BASE_URL}/models",
            headers={"Authorization": f"Bearer {key}"},
        )
    except httpx.HTTPError as exc:
        raise HTTPException(502, "Xiaoyi model service is unavailable") from exc
    data = response_json(response)
    if not response.is_success:
        raise upstream_error(response, data)
    items = data.get("data")
    if not isinstance(items, list):
        raise HTTPException(502, "Xiaoyi model response did not include a model list")
    visible = {
        str(item.get("id"))
        for item in items
        if isinstance(item, dict) and item.get("id")
    }
    models = [model for model in sorted(PUBLIC_MODELS) if MODEL_MAP.get(model, model) in visible]
    return {"object": "list", "data": [{"id": model, "object": "model", "owned_by": "xiaoyi"} for model in models]}


@app.post("/v1/videos")
async def create_image_task(request: Request):
    key = bearer_token(request)
    if request.headers.get("content-type", "").startswith("application/json"):
        body = await json_body(request)
        if body.get("model") in VIDEO_MODELS:
            return await create_video_task(body, key, request.app.state.http)
        fields = {name: str(value) for name, value in body.items() if value is not None}
        images = []
    else:
        fields, images = await request_fields(request)
    model = str(fields.get("model") or "")
    if model not in MODEL_MAP:
        raise HTTPException(400, "Unsupported model")
    prompt = str(fields.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(400, "prompt is required")
    validate_gemini_request(model, prompt, images)
    payload = upstream_payload(model, fields)
    try:
        if images:
            response = await request.app.state.http.post(
                f"{XIAOYI_BASE_URL}/images/edits/async",
                headers={"Authorization": f"Bearer {key}"}, data=payload, files=images,
            )
        else:
            response = await request.app.state.http.post(
                f"{XIAOYI_BASE_URL}/images/generations/async",
                headers={"Authorization": f"Bearer {key}"}, json=payload,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(502, "Xiaoyi image service is unavailable") from exc
    data = response_json(response)
    if not response.is_success:
        raise upstream_error(response, data)
    task_id = task_id_from(data)
    if not task_id:
        raise HTTPException(502, "Xiaoyi response did not include a task ID")
    return task_response(task_id, "processing", model)


@app.get("/v1/videos/{task_id}")
async def get_image_task(task_id: str, request: Request):
    if not task_id or "/" in task_id:
        raise HTTPException(400, "Invalid task ID")
    key = bearer_token(request)
    try:
        response = await request.app.state.http.get(f"{XIAOYI_BASE_URL}/images/tasks/{task_id}", headers={"Authorization": f"Bearer {key}"})
        if response.status_code == 404:
            response = await request.app.state.http.get(f"{XIAOYI_BASE_URL}/videos/{task_id}", headers={"Authorization": f"Bearer {key}"})
    except httpx.HTTPError:
        return task_response(task_id, "processing", "")
    if response.status_code == 429 or response.status_code >= 500:
        return task_response(task_id, "processing", "")
    data = response_json(response)
    if not response.is_success:
        raise upstream_error(response, data)
    if str(data.get("status") or "").lower() in {"queued", "in_progress", "completed"}:
        if str(data.get("status")).lower() == "completed":
            data["metadata"] = {"url": f"/v1/videos/{task_id}/content"}
        return data
    raw_status = str(data.get("status") or "running").lower()
    status = {"success": "completed", "failed": "failed"}.get(raw_status, "processing")
    result = task_response(task_id, status, str(data.get("model") or ""))
    if status == "completed":
        url = image_url(data)
        if not url:
            raise HTTPException(502, "Xiaoyi completed without an image result")
        result["metadata"] = {"url": url}
        result["completed_at"] = int(time())
    if status == "failed":
        result["error"] = error_from(data)
        result["completed_at"] = int(time())
    return result


@app.get("/v1/videos/{task_id}/content")
async def get_video_content(task_id: str, request: Request):
    if not task_id or "/" in task_id:
        raise HTTPException(400, "Invalid task ID")
    key = bearer_token(request)
    stream = request.app.state.http.stream("GET", f"{XIAOYI_BASE_URL}/videos/{task_id}/content", headers={"Authorization": f"Bearer {key}"})
    try:
        response = await stream.__aenter__()
    except httpx.HTTPError as exc:
        raise HTTPException(502, "Xiaoyi video service is unavailable") from exc
    if not response.is_success:
        await stream.__aexit__(None, None, None)
        raise HTTPException(response.status_code, "Xiaoyi video download failed")
    return StreamingResponse(
        response.aiter_bytes(),
        media_type=response.headers.get("content-type", "video/mp4"),
        background=BackgroundTask(stream.__aexit__, None, None, None),
    )


async def create_video_task(body: dict, key: str, client: httpx.AsyncClient) -> dict:
    payload = video_payload(body)
    try:
        response = await client.post(f"{XIAOYI_BASE_URL}/videos", headers={"Authorization": f"Bearer {key}"}, json=payload)
    except httpx.HTTPError as exc:
        raise HTTPException(502, "Xiaoyi video service is unavailable") from exc
    data = response_json(response)
    if not response.is_success:
        raise upstream_error(response, data)
    task_id = task_id_from(data)
    if not task_id:
        raise HTTPException(502, "Xiaoyi response did not include a task ID")
    return data


async def json_body(request: Request) -> dict:
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(400, "Invalid JSON body") from exc
    if not isinstance(body, dict):
        raise HTTPException(400, "JSON object required")
    return body


def video_payload(body: dict) -> dict:
    model = str(body.get("model") or "")
    prompt = str(body.get("prompt") or "").strip()
    if model not in VIDEO_MODELS:
        raise HTTPException(400, "Unsupported model")
    if not prompt:
        raise HTTPException(400, "prompt is required")
    duration = body.get("duration", body.get("seconds", 5))
    if isinstance(duration, bool) or not isinstance(duration, (int, str)) or not str(duration).isdigit() or not 5 <= int(duration) <= 15:
        raise HTTPException(400, "duration must be from 5 to 15 seconds")
    ratio = str(body.get("aspect_ratio") or body.get("ratio") or "16:9")
    if ratio not in {"16:9", "9:16", "1:1"}:
        raise HTTPException(400, "Unsupported aspect ratio")
    resolution = str(body.get("resolution") or VIDEO_MODELS[model]).lower()
    if resolution != VIDEO_MODELS[model]:
        raise HTTPException(400, "Unsupported resolution")
    references = []
    for kind, keys, maximum in (
        ("image", ("images", "image_urls", "image"), 9),
        ("video", ("video_urls", "videos", "video_url"), 3),
        ("audio", ("audio_urls", "audios", "audio_url"), 3),
    ):
        value = next((body[key] for key in keys if body.get(key)), [])
        values = value if isinstance(value, list) else [value]
        if len(values) > maximum:
            raise HTTPException(400, f"{kind} supports at most {maximum} references")
        for item in values:
            url = item.get("url") if isinstance(item, dict) else item
            if not isinstance(url, str) or not url.startswith("https://"):
                raise HTTPException(400, f"{kind} reference must be an HTTPS URL")
            content_type = f"{kind}_url"
            references.append({"type": content_type, content_type: {"url": url}, "role": f"reference_{kind}"})
    return {
        "model": model,
        "seconds": str(duration),
        "aspect_ratio": ratio,
        "resolution": resolution,
        "content": [{"type": "text", "text": prompt}, *references],
    }


def bearer_token(request: Request) -> str:
    value = request.headers.get("authorization", "").strip()
    if not value.lower().startswith("bearer ") or not value[7:].strip():
        raise HTTPException(401, "Missing upstream API key")
    return value[7:].strip()


async def request_fields(request: Request) -> tuple[dict[str, str], list[tuple[str, tuple[str, bytes, str]]]]:
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("application/json"):
        try:
            body = await request.json()
        except Exception as exc:
            raise HTTPException(400, "Invalid JSON body") from exc
        if not isinstance(body, dict):
            raise HTTPException(400, "JSON object required")
        return {key: str(value) for key, value in body.items() if value is not None}, []
    form = await request.form()
    fields: dict[str, str] = {}
    images: list[tuple[str, tuple[str, bytes, str]]] = []
    uploads = [(key, value) for key, value in form.multi_items() if isinstance(value, UploadFile)]
    try:
        if len(uploads) > MAX_UPLOADS:
            raise HTTPException(413, f"At most {MAX_UPLOADS} images are allowed")
        for key, value in form.multi_items():
            if not isinstance(value, UploadFile):
                fields[key] = value
                continue
            if key != "image" or not (value.content_type or "").startswith("image/"):
                raise HTTPException(400, "Only image uploads are allowed")
            content = await value.read(MAX_UPLOAD_BYTES + 1)
            if len(content) > MAX_UPLOAD_BYTES:
                raise HTTPException(413, "Image exceeds the 20 MB limit")
            images.append(("image", (value.filename or "image.png", content, value.content_type or "image/png")))
    finally:
        for _, upload in uploads:
            await upload.close()
    return fields, images


def upstream_payload(model: str, fields: dict[str, str]) -> dict[str, str]:
    payload = {"model": MODEL_MAP[model], "prompt": fields["prompt"], "response_format": "url"}
    if fields.get("size") and fields["size"] != "auto":
        payload["size"] = fields["size"]
    return payload


def validate_gemini_request(model: str, prompt: str, images: list[tuple[str, tuple[str, bytes, str]]]) -> None:
    if not model.startswith("gemini-"):
        if len(images) > 8:
            raise HTTPException(413, "At most 8 images are allowed")
        if sum(len(image[1][1]) for image in images) > 64 * 1024 * 1024:
            raise HTTPException(413, "Images exceed the 64 MB total limit")
        return
    if len(prompt) > 20_000:
        raise HTTPException(400, "Prompt exceeds the 20000 character limit")
    if any(len(image[1][1]) > 10 * 1024 * 1024 for image in images):
        raise HTTPException(413, "Gemini images cannot exceed 10 MB each")


def response_json(response: httpx.Response) -> dict:
    try:
        data = response.json()
    except ValueError as exc:
        raise HTTPException(502, "Xiaoyi returned invalid JSON") from exc
    if not isinstance(data, dict):
        raise HTTPException(502, "Xiaoyi returned an invalid response")
    return data


def task_id_from(data: dict) -> str:
    return str(data.get("task_id") or data.get("id") or "")


def image_url(data: dict) -> str:
    result = data.get("result") if isinstance(data.get("result"), dict) else data
    items = result.get("data") if isinstance(result, dict) else None
    if not isinstance(items, list) or not items or not isinstance(items[0], dict):
        return ""
    item = items[0]
    if isinstance(item.get("url"), str) and item["url"]:
        return item["url"]
    if isinstance(item.get("b64_json"), str) and item["b64_json"]:
        return f"data:image/png;base64,{item['b64_json']}"
    return ""


def error_from(data: dict) -> dict[str, str]:
    error = data.get("error")
    if isinstance(error, dict):
        return {"code": str(error.get("code") or "TASK_FAILED"), "message": str(error.get("message") or "Xiaoyi task failed")}
    return {"code": "TASK_FAILED", "message": str(error or data.get("message") or "Xiaoyi task failed")}


def task_response(task_id: str, status: str, model: str) -> dict:
    return {"id": task_id, "task_id": task_id, "object": "video", "model": model, "status": status, "progress": 100 if status == "completed" else 0, "created_at": int(time())}


def upstream_error(response: httpx.Response, data: dict) -> HTTPException:
    detail = data.get("error") or data.get("message") or f"Xiaoyi request failed ({response.status_code})"
    if isinstance(detail, dict):
        detail = detail.get("message") or detail.get("code") or "Xiaoyi request failed"
    return HTTPException(response.status_code if response.status_code >= 400 else 502, str(detail))


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": {"code": str(exc.status_code), "message": str(exc.detail), "type": "xiaoyi_image_error"}})

from __future__ import annotations

import base64
import email.utils
import hashlib
import hmac
import uuid
from time import time

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.background import BackgroundTask

BASE = "https://aimanplay.cn"
MODEL = "minimax_h3_image_audio_to_video_v2_15s"
RESOLUTIONS = {"480p竖", "768p竖", "480p横", "768p横"}
MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_AUDIO_BYTES = 20 * 1024 * 1024

app = FastAPI(title="Boluo MiniMax Adapter", version="0.1.0")


@app.on_event("startup")
async def startup():
    app.state.http = httpx.AsyncClient(timeout=httpx.Timeout(120, connect=15))


@app.on_event("shutdown")
async def shutdown():
    await app.state.http.aclose()


def token(request: Request) -> str:
    value = request.headers.get("authorization", "")
    if not value.lower().startswith("bearer ") or not value[7:].strip():
        raise HTTPException(401, "Missing upstream API key")
    return value[7:].strip()


@app.get("/health")
async def health():
    return {"status": "ok", "service": "boluo-minimax-adapter", "model": MODEL}


@app.get("/v1/models")
async def models(request: Request):
    token(request)
    return {"object": "list", "data": [{"id": MODEL, "object": "model", "owned_by": "boluo"}]}


@app.post("/v1/videos")
async def create_video(request: Request):
    key = token(request)
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(400, "Invalid JSON body") from exc
    if not isinstance(body, dict) or body.get("model") != MODEL:
        raise HTTPException(400, "Unsupported model")
    prompt = str(body.get("prompt") or "").strip()
    if not prompt or len(prompt) > 12000:
        raise HTTPException(400, "prompt is required and must be at most 12000 characters")
    duration = body.get("duration", body.get("seconds", 15))
    if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not 1 <= duration <= 15:
        raise HTTPException(400, "duration must be from 1 to 15 seconds")
    resolution = str(body.get("resolution") or "768p竖")
    ratio = str(body.get("aspect_ratio") or body.get("ratio") or "")
    if ratio == "16:9" and resolution.endswith("竖"):
        resolution = resolution[:-1] + "横"
    elif ratio == "9:16" and resolution.endswith("横"):
        resolution = resolution[:-1] + "竖"
    if resolution not in RESOLUTIONS:
        raise HTTPException(400, "Unsupported resolution")
    images = media_values(body, ("images", "image_urls", "image"))
    audios = media_values(body, ("audios", "audio_urls", "audio"))
    if len(images) > 9:
        raise HTTPException(400, "At most 9 reference images are allowed")
    if len(audios) > 3:
        raise HTTPException(400, "At most 3 reference audios are allowed")
    sts = await get_sts(key)
    payload = {"model": MODEL, "prompt": prompt, "duration": duration, "resolution": resolution}
    for index, url in enumerate(images):
        payload[f"ref_image_{index}"] = await upload_url(url, sts, "image", key)
    for index, url in enumerate(audios):
        payload[f"ref_audio_{index}"] = await upload_url(url, sts, "audio", key)
    response = await app.state.http.post(f"{BASE}/v1/videos", headers={"Authorization": f"Bearer {key}"}, json=payload)
    data = response_json(response)
    if not response.is_success:
        raise HTTPException(response.status_code, str(data.get("message") or data.get("error") or "Boluo request failed"))
    return data


@app.get("/v1/videos/{task_id}")
async def get_video(task_id: str, request: Request):
    key = token(request)
    response = await app.state.http.get(f"{BASE}/v1/videos/{task_id}", headers={"Authorization": f"Bearer {key}"})
    data = response_json(response)
    if not response.is_success:
        raise HTTPException(response.status_code, str(data.get("message") or "Boluo request failed"))
    return data


@app.get("/v1/videos/{task_id}/content")
async def content(task_id: str, request: Request):
    key = token(request)
    stream = app.state.http.stream("GET", f"{BASE}/v1/videos/{task_id}/content", headers={"Authorization": f"Bearer {key}"})
    response = await stream.__aenter__()
    if not response.is_success:
        await stream.__aexit__(None, None, None)
        raise HTTPException(response.status_code, "Boluo video download failed")
    return StreamingResponse(response.aiter_bytes(), media_type=response.headers.get("content-type", "video/mp4"), background=BackgroundTask(stream.__aexit__, None, None, None))


def media_values(body: dict, keys: tuple[str, ...]) -> list[str]:
    value = next((body[key] for key in keys if body.get(key) is not None), [])
    values = value if isinstance(value, list) else [value]
    output = []
    for item in values:
        url = item.get("url") if isinstance(item, dict) else item
        if not isinstance(url, str) or not url.startswith(("http://", "https://")):
            raise HTTPException(400, "reference media must be a URL")
        output.append(url)
    return output


async def get_sts(key: str) -> dict:
    response = await app.state.http.post(f"{BASE}/api/video-upload/oss-sts", headers={"Authorization": f"Bearer {key}"})
    data = response_json(response)
    if not response.is_success or not data.get("success"):
        raise HTTPException(response.status_code if response.status_code >= 400 else 502, str(data.get("message") or "OSS STS unavailable"))
    return data


async def upload_url(url: str, sts: dict, kind: str, key: str) -> str:
    source = await app.state.http.get(url)
    if not source.is_success:
        raise HTTPException(400, f"Unable to fetch reference {kind}")
    limit = MAX_IMAGE_BYTES if kind == "image" else MAX_AUDIO_BYTES
    if len(source.content) > limit:
        raise HTTPException(413, f"Reference {kind} exceeds 20 MB")
    content_type = source.headers.get("content-type", "image/png" if kind == "image" else "audio/mpeg").split(";")[0]
    date = email.utils.formatdate(usegmt=True)
    ext = ".png" if kind == "image" else ".mp3"
    path = f'{sts["dir"].rstrip("/")}/{uuid.uuid4().hex}{ext}'
    canonical = "\n".join(sorted([f"x-oss-date:{date}", "x-oss-object-acl:public-read", f'x-oss-security-token:{sts["securityToken"]}']))
    string_to_sign = "\n".join(["PUT", "", content_type, date, canonical, f'/{sts["bucket"]}/{path}'])
    signature = base64.b64encode(hmac.new(sts["accessKeySecret"].encode(), string_to_sign.encode(), hashlib.sha1).digest()).decode()
    response = await app.state.http.put(f'{sts["host"].rstrip("/")}/{path}', content=source.content, headers={"Authorization": f'OSS {sts["accessKeyId"]}:{signature}', "Content-Type": content_type, "x-oss-date": date, "x-oss-object-acl": "public-read", "x-oss-security-token": sts["securityToken"]})
    if not response.is_success:
        raise HTTPException(502, "OSS upload failed")
    return f'{sts["host"].rstrip("/")}/{path}'


def response_json(response: httpx.Response) -> dict:
    try:
        data = response.json()
    except ValueError as exc:
        raise HTTPException(502, "Boluo returned invalid JSON") from exc
    return data if isinstance(data, dict) else {}


@app.exception_handler(HTTPException)
async def errors(_: Request, exc: HTTPException):
    return JSONResponse(exc.status_code, {"error": {"code": str(exc.status_code), "message": str(exc.detail), "type": "boluo_minimax_error"}})

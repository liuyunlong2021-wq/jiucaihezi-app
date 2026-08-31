from __future__ import annotations

from contextlib import asynccontextmanager
from time import time
from uuid import uuid4

import httpx
from fastapi import FastAPI, HTTPException, Request

BASE_URL = "https://43.254.166.196"
MODEL = "dola-seedance2.5"
MAX_PROMPT = 3000
MAX_IMAGES = 30
MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http = httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=15.0), follow_redirects=True)
    yield
    await app.state.http.aclose()


app = FastAPI(title="Dola Seedance 2.5 Adapter", version="0.1.0", lifespan=lifespan)


@app.get("/health")
@app.get("/healthz")
async def health():
    return {"status": "ok", "service": "dola-seedance-adapter", "models": [MODEL]}


@app.get("/v1/models")
async def models(request: Request):
    require_auth(request)
    return {"object": "list", "data": [{"id": MODEL, "object": "model", "owned_by": "dola"}]}


@app.post("/v1/videos")
async def create_video(request: Request):
    authorization = require_auth(request)
    body = await json_body(request)
    if body.get("model") != MODEL:
        raise HTTPException(400, "Unsupported Dola Seedance model")
    prompt = str(body.get("prompt") or "").strip()
    if not prompt or len(prompt) > MAX_PROMPT:
        raise HTTPException(400, "prompt must contain 1-3000 characters")
    ratio = str(body.get("ratio") or body.get("aspect_ratio") or "16:9")
    if ratio not in {"16:9", "9:16", "1:1", "3:4", "4:3", "21:9"}:
        raise HTTPException(400, "Unsupported ratio")
    images = body.get("images") or body.get("image") or []
    images = images if isinstance(images, list) else [images]
    if len(images) > MAX_IMAGES:
        raise HTTPException(400, "Dola Seedance supports at most 30 images")
    files = []
    total_bytes = 0
    for index, url in enumerate(images, 1):
        if not isinstance(url, str) or not url.startswith(("http://", "https://")):
            raise HTTPException(400, "Reference images must be URLs")
        try:
            response = await request.app.state.http.get(url)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise HTTPException(400, "Unable to fetch reference image") from exc
        content_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
        if content_type not in {"image/jpeg", "image/png"}:
            raise HTTPException(400, "Only JPG, JPEG and PNG images are supported")
        if len(response.content) > MAX_IMAGE_BYTES:
            raise HTTPException(413, "Reference image exceeds 20 MiB")
        total_bytes += len(response.content)
        if total_bytes > MAX_TOTAL_IMAGE_BYTES:
            raise HTTPException(413, "Reference images exceed 20 MiB total")
        extension = "png" if content_type == "image/png" else "jpg"
        files.append(("images[]", (f"reference-{index}.{extension}", response.content, content_type)))
    form = {"prompt": prompt, "ratio": ratio, "seconds": "30"}
    try:
        response = await request.app.state.http.post(
            f"{BASE_URL}/api/v1/videos",
            headers={"Authorization": authorization, "Idempotency-Key": str(uuid4())},
            data=form,
            files=files or None,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(502, "Dola service is unavailable") from exc
    payload = response.json()
    if not response.is_success or payload.get("code") != "1":
        raise HTTPException(response.status_code if response.status_code >= 400 else 502, payload.get("message", "Dola request failed"))
    task_id = str(payload.get("task_id") or "")
    if not task_id:
        raise HTTPException(502, "Dola response did not include task_id")
    return {"id": task_id, "task_id": task_id, "object": "video", "model": MODEL, "status": payload.get("status", "queued"), "progress": 0, "created_at": int(time())}


@app.get("/v1/videos/{task_id}")
async def get_video(task_id: str, request: Request):
    authorization = require_auth(request)
    try:
        response = await request.app.state.http.get(f"{BASE_URL}/api/v1/videos/{task_id}", headers={"Authorization": authorization})
    except httpx.HTTPError as exc:
        raise HTTPException(502, "Dola service is unavailable") from exc
    payload = response.json()
    if not response.is_success:
        raise HTTPException(502, payload.get("message", "Dola query failed"))
    task = payload.get("task") or {}
    status = str(task.get("status") or "processing")
    code = str(payload.get("code") or "")
    if code not in {"0", "1"}:
        raise HTTPException(502, payload.get("message", "Invalid Dola response code"))
    if (status == "succeeded") != (code == "1"):
        raise HTTPException(502, payload.get("message", "Inconsistent Dola task response"))
    result = {"id": task_id, "task_id": task_id, "object": "video", "model": MODEL, "status": "completed" if status == "succeeded" else status, "progress": 100 if status == "succeeded" else 0}
    if status == "succeeded": result["video_url"] = task.get("url")
    if status == "failed": result["error"] = task.get("error") or "Dola task failed"
    return result


def require_auth(request: Request) -> str:
    value = request.headers.get("authorization", "").strip()
    if not value.lower().startswith("bearer ") or not value[7:].strip():
        raise HTTPException(401, "Missing upstream API key")
    return value


async def json_body(request: Request) -> dict:
    try: body = await request.json()
    except Exception as exc: raise HTTPException(400, "Invalid JSON body") from exc
    if not isinstance(body, dict): raise HTTPException(400, "JSON object required")
    return body

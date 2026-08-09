from __future__ import annotations

import base64
import binascii
from contextlib import asynccontextmanager
from uuid import uuid4

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

UPSTREAM_URL = "https://openspeech.bytedance.com/api/v3/tts/create"
MODEL = "seed-audio-1.0"
FORMATS = {
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "pcm": "audio/pcm",
    "opus": "audio/ogg",
    "ogg_opus": "audio/ogg",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http = httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=10.0))
    yield
    await app.state.http.aclose()


app = FastAPI(title="Seed Audio Adapter", version="0.1.0", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "seed-audio-adapter", "models": [MODEL]}


@app.get("/v1/models")
async def models():
    return {"object": "list", "data": [{"id": MODEL, "object": "model", "owned_by": "volcengine"}]}


@app.post("/v1/audio/speech")
async def create_speech(request: Request):
    api_key = bearer_token(request)
    if not api_key:
        return error(401, "Missing upstream API key", "missing_api_key")
    try:
        body = await request.json()
    except Exception:
        return error(400, "Invalid JSON body", "invalid_request")
    if not isinstance(body, dict):
        return error(400, "JSON object required", "invalid_request")
    if body.get("model") != MODEL:
        return error(400, "Unsupported model", "invalid_model")

    text = body.get("input")
    if not isinstance(text, str) or not text.strip() or len(text) > 2048:
        return error(400, "input must contain 1-2048 characters", "invalid_input")
    audio_format = str(body.get("response_format") or "mp3").lower()
    upstream_format = "ogg_opus" if audio_format == "opus" else audio_format
    if audio_format not in FORMATS:
        return error(400, "response_format must be mp3, wav, pcm, opus, or ogg_opus", "invalid_format")

    try:
        upstream = await request.app.state.http.post(
            UPSTREAM_URL,
            headers={
                "Content-Type": "application/json",
                "X-Api-Key": api_key,
                "X-Api-Request-Id": str(uuid4()),
            },
            json={
                "model": MODEL,
                "text_prompt": text,
                "audio_config": {"format": upstream_format, "sample_rate": 24000},
                "watermark": {},
            },
        )
    except httpx.HTTPError:
        return error(502, "Seed Audio service is unavailable", "upstream_unavailable")

    try:
        result = upstream.json()
    except ValueError:
        return error(502, "Seed Audio returned invalid JSON", "invalid_upstream_response")
    if not isinstance(result, dict):
        return error(502, "Seed Audio returned an invalid response", "invalid_upstream_response")
    if not upstream.is_success or result.get("code") not in (None, 0, 20000000):
        message = str(result.get("message") or f"Seed Audio request failed ({upstream.status_code})")
        return error(upstream.status_code if upstream.status_code >= 400 else 502, message, str(result.get("code") or "upstream_error"))

    data = result.get("data")
    encoded = result.get("audio") or (data.get("audio") if isinstance(data, dict) else data)
    if not isinstance(encoded, str) or not encoded:
        return error(502, "Seed Audio returned no audio", "missing_audio")
    try:
        audio = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        return error(502, "Seed Audio returned invalid audio", "invalid_audio")
    if not audio:
        return error(502, "Seed Audio returned empty audio", "empty_audio")

    headers = {}
    if log_id := upstream.headers.get("X-Tt-Logid"):
        headers["X-Tt-Logid"] = log_id
    return Response(audio, media_type=FORMATS[audio_format], headers=headers)


def bearer_token(request: Request) -> str:
    value = request.headers.get("authorization", "").strip()
    if not value.lower().startswith("bearer ") or not value[7:].strip():
        return ""
    return value[7:].strip()


def error(status: int, message: str, code: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"message": message, "type": "seed_audio_error", "code": code}},
    )

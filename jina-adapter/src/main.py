from contextlib import asynccontextmanager
from ipaddress import ip_address
from time import time
from uuid import uuid4

import httpx
from fastapi import FastAPI, HTTPException, Request

SEARCH_MODEL = "jina-search"
READER_MODEL = "jina-reader"
JINA_SEARCH_URL = "https://s.jina.ai/"
JINA_READER_URL = "https://r.jina.ai/"
MAX_QUERY_CHARS = 500
MAX_RESPONSE_CHARS = 2_000_000


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=3.0))
    yield
    await app.state.http.aclose()


app = FastAPI(title="Jina Search Adapter", version="0.1.0", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "jina-adapter", "models": [SEARCH_MODEL, READER_MODEL]}


@app.get("/v1/models")
async def models():
    return {"object": "list", "data": [
        {"id": SEARCH_MODEL, "object": "model", "owned_by": "jina"},
        {"id": READER_MODEL, "object": "model", "owned_by": "jina"},
    ]}


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    authorization = request.headers.get("authorization", "").strip()
    if not authorization.lower().startswith("bearer ") or not authorization[7:].strip():
        raise HTTPException(status_code=401, detail="Missing upstream API key")

    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON body") from exc

    model = payload.get("model")
    if model not in (SEARCH_MODEL, READER_MODEL):
        raise HTTPException(status_code=400, detail="Unsupported model")
    if payload.get("stream") is True:
        raise HTTPException(status_code=400, detail="Streaming is not supported")

    messages = payload.get("messages")
    if not isinstance(messages, list):
        raise HTTPException(status_code=400, detail="Messages are required")
    query = next(
        (
            message.get("content", "").strip()
            for message in reversed(messages)
            if isinstance(message, dict)
            and message.get("role") == "user"
            and isinstance(message.get("content"), str)
        ),
        "",
    )
    if not query or len(query) > MAX_QUERY_CHARS:
        raise HTTPException(status_code=400, detail="Query is invalid")

    try:
        if model == SEARCH_MODEL:
            upstream = await request.app.state.http.post(
                JINA_SEARCH_URL,
                headers={"Authorization": authorization, "Accept": "text/plain"},
                json={"q": query},
            )
        else:
            validate_public_url(query)
            upstream = await request.app.state.http.get(
                f"{JINA_READER_URL}{query}",
                headers={"Authorization": authorization, "Accept": "text/plain"},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Jina is unavailable") from exc
    if not upstream.is_success:
        raise HTTPException(status_code=502, detail=f"Jina request failed ({upstream.status_code})")

    content = upstream.text.strip()
    if not content:
        raise HTTPException(status_code=502, detail="Jina returned an empty response")
    if len(content) > MAX_RESPONSE_CHARS:
        raise HTTPException(status_code=413, detail="Jina response is too large")
    return {
        "id": f"{model}-{uuid4().hex}",
        "object": "chat.completion",
        "created": int(time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
    }


def validate_public_url(value: str) -> None:
    try:
        url = httpx.URL(value)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Reader URL is invalid") from exc
    host = (url.host or "").lower()
    if url.scheme not in ("http", "https") or not host or url.userinfo or host == "localhost" or host.endswith((".localhost", ".local")):
        raise HTTPException(status_code=400, detail="Reader URL is invalid")
    try:
        address = ip_address(host)
    except ValueError:
        return
    if not address.is_global:
        raise HTTPException(status_code=400, detail="Reader URL is invalid")

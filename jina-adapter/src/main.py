from contextlib import asynccontextmanager
from time import time
from uuid import uuid4

import httpx
from fastapi import FastAPI, HTTPException, Request

MODEL = "jina-search"
JINA_SEARCH_URL = "https://s.jina.ai/"
MAX_QUERY_CHARS = 500


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=3.0))
    yield
    await app.state.http.aclose()


app = FastAPI(title="Jina Search Adapter", version="0.1.0", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "jina-adapter", "model": MODEL}


@app.get("/v1/models")
async def models():
    return {"object": "list", "data": [{"id": MODEL, "object": "model", "owned_by": "jina"}]}


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    authorization = request.headers.get("authorization", "").strip()
    if not authorization.lower().startswith("bearer ") or not authorization[7:].strip():
        raise HTTPException(status_code=401, detail="Missing upstream API key")

    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON body") from exc

    if payload.get("model") != MODEL:
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
        raise HTTPException(status_code=400, detail="Search query is invalid")

    try:
        upstream = await request.app.state.http.post(
            JINA_SEARCH_URL,
            headers={"Authorization": authorization, "Accept": "text/plain"},
            json={"q": query},
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Jina search is unavailable") from exc
    if not upstream.is_success:
        raise HTTPException(status_code=502, detail=f"Jina search failed ({upstream.status_code})")

    content = upstream.text.strip()
    if not content:
        raise HTTPException(status_code=502, detail="Jina search returned an empty response")
    return {
        "id": f"jina-search-{uuid4().hex}",
        "object": "chat.completion",
        "created": int(time()),
        "model": MODEL,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
    }

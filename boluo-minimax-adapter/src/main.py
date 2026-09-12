from __future__ import annotations

import asyncio
import base64
import email.utils
import hashlib
import hmac
import logging
import os
import uuid
from time import time
from urllib.parse import urlsplit

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.background import BackgroundTask

BASE = "https://aimanplay.cn"
MODEL = "minimax_h3_image_audio_to_video_v2_15s"
ZM_U24 = "minimax_h3_zm_u24"
# 两个图音参考生模型的请求字段完全相同（图 ≤9 + 音频 ≤3、时长 1-15），
# 只有分辨率枚举和默认时长不同；首尾帧与纯文生模型未接入。
MODELS: dict[str, dict] = {
    MODEL: {
        "default_duration": 15,
        "resolutions": ("480p竖", "768p竖", "480p横", "768p横"),
    },
    ZM_U24: {
        "default_duration": 5,
        "resolutions": ("480p竖", "768p竖", "480p横", "768p横", "480p(1:1)", "768p(1:1)"),
    },
}
MAX_DURATION = 15
# 这两个模型没有比例参数，方向完全写在 resolution 的后缀里；比例只用于“没给分辨率”时的推导。
RATIO_AXIS = {"16:9": "横", "9:16": "竖", "1:1": "(1:1)"}
RESOLUTION_AXIS = {"竖": "9:16", "横": "16:9", "(1:1)": "1:1"}
DEFAULT_RESOLUTION = "768p竖"
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_AUDIO_BYTES = 20 * 1024 * 1024
STS_TIMEOUT_SECONDS = 30.0
REFERENCE_TIMEOUT_SECONDS = float(os.environ.get("REFERENCE_TIMEOUT_SECONDS", "60"))
TASK_TTL_SECONDS = 2 * 60 * 60
# 参考素材存在自家 NewAPI 上。公网域名经 Cloudflare 会拦非浏览器请求（实测 403），
# 而 docker 内网同一个 NewAPI 是 200/0.03s，所以匹配到自家域名就改走内网。
ASSET_FETCH_ORIGIN = os.environ.get("ASSET_FETCH_ORIGIN", "").strip().rstrip("/")
ASSET_INTERNAL_BASE = os.environ.get("ASSET_INTERNAL_BASE", "").strip().rstrip("/")

logger = logging.getLogger("boluo-minimax-adapter")

# 本地任务表：素材搬运和上游提交都在后台完成，创建请求立即返回本地任务 ID。
# ponytail: 单容器内存表，容器重启即丢；那时客户端再轮询这个 ID 会拿到上游的错误响应而不是本地结果。要跨重启就换落盘存储。
TASKS: dict[str, dict] = {}

app = FastAPI(title="Boluo MiniMax Adapter", version="0.2.0")


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
    return {"status": "ok", "service": "boluo-minimax-adapter", "models": sorted(MODELS)}


@app.get("/v1/models")
async def models(request: Request):
    token(request)
    return {"object": "list", "data": [{"id": model, "object": "model", "owned_by": "boluo"} for model in sorted(MODELS)]}


@app.post("/v1/videos")
async def create_video(request: Request, background: BackgroundTasks):
    key = token(request)
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(400, "Invalid JSON body") from exc
    if not isinstance(body, dict) or body.get("model") not in MODELS:
        # 把收到的名字回显出来：NewAPI 渠道映射写错时一眼就能看出转发的是什么。
        raise HTTPException(400, f"Unsupported model: {body.get('model') if isinstance(body, dict) else body!r}; expected one of {sorted(MODELS)}")
    model = str(body["model"])
    spec = MODELS[model]
    prompt = str(body.get("prompt") or "").strip()
    if not prompt or len(prompt) > 12000:
        raise HTTPException(400, "prompt is required and must be at most 12000 characters")
    duration = body.get("duration", body.get("seconds"))
    if duration is None:  # 显式传 null 和没传一样走默认值，不要让它掉进比较里炸成 500
        duration = spec["default_duration"]
    if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not 1 <= duration <= MAX_DURATION:
        raise HTTPException(400, f"duration must be from 1 to {MAX_DURATION} seconds")
    resolution = resolve_resolution(spec, body, model)
    images = media_values(body, ("images", "image_urls", "image"))
    audios = media_values(body, ("audios", "audio_urls", "audio"))
    if len(images) > 9:
        raise HTTPException(400, "At most 9 reference images are allowed")
    if len(audios) > 3:
        raise HTTPException(400, "At most 3 reference audios are allowed")
    seed = body.get("seed")
    if seed is not None and (isinstance(seed, bool) or not isinstance(seed, int) or seed < 0):
        raise HTTPException(400, "seed must be a non-negative integer")
    # 校验全部同步完成后再建任务：参数错误仍然是立即 4xx，不会变成异步失败。
    purge_tasks()
    task_id = uuid.uuid4().hex
    payload = {"model": model, "prompt": prompt, "duration": duration, "resolution": resolution}
    if seed is not None:
        payload["seed"] = seed
    TASKS[task_id] = {
        "created_at": int(time()),
        "key": key,
        "model": model,
        "status": "queued",
        "progress": 0,
        "upstream": "",
        "error": "",
        "payload": payload,
        "media": [("image", url) for url in images] + [("audio", url) for url in audios],
    }
    background.add_task(run_task, task_id)
    logger.info("task=%s stage=accepted model=%s images=%d audios=%d", task_id, model, len(images), len(audios))
    return task_response(task_id)


@app.get("/v1/videos/{task_id}")
async def get_video(task_id: str, request: Request):
    key = token(request)
    purge_tasks()
    task = TASKS.get(task_id)
    if task and not task["upstream"]:
        return task_response(task_id)
    upstream_id = task["upstream"] if task else task_id
    authorization = task["key"] if task else key
    response = await app.state.http.get(f"{BASE}/v1/videos/{upstream_id}", headers={"Authorization": f"Bearer {authorization}"})
    data = response_json(response)
    if not response.is_success:
        raise HTTPException(response.status_code, str(data.get("message") or "Boluo request failed"))
    if task:
        # 客户端只会用创建时拿到的 ID 轮询，响应里的 ID 保持同一个。
        data["id"] = task_id
        data["task_id"] = task_id
    return data


@app.get("/v1/videos/{task_id}/content")
async def content(task_id: str, request: Request):
    key = token(request)
    purge_tasks()
    task = TASKS.get(task_id)
    upstream_id = task["upstream"] if task and task["upstream"] else task_id
    authorization = task["key"] if task else key
    stream = app.state.http.stream("GET", f"{BASE}/v1/videos/{upstream_id}/content", headers={"Authorization": f"Bearer {authorization}"})
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


def purge_tasks() -> None:
    # ponytail: 惰性清理，只在有请求进来时触发；单容器够用，不为它起后台线程。
    deadline = time() - TASK_TTL_SECONDS
    for stale in [task_id for task_id, task in TASKS.items() if task["created_at"] < deadline]:
        TASKS.pop(stale, None)


def task_response(task_id: str) -> dict:
    task = TASKS[task_id]
    payload = {
        "id": task_id,
        "task_id": task_id,
        "object": "video",
        "model": task["model"],
        "status": task["status"],
        "progress": task["progress"],
        "created_at": task["created_at"],
    }
    if task["error"]:
        # 轮询期表达失败：HTTP 200 + status failed，和上游任务对象同构。
        payload["error"] = {"message": task["error"], "code": "adapter_error"}
    return payload


async def run_task(task_id: str) -> None:
    task = TASKS.get(task_id)
    if task is None:
        return
    started = time()
    try:
        sts = await get_sts(task["key"])
        task.update(status="in_progress", progress=5)
        references = await upload_all(task["media"], sts)
        payload = dict(task["payload"])
        counters = {"image": 0, "audio": 0}
        for (kind, _), uploaded in zip(task["media"], references):
            payload[f"ref_{kind}_{counters[kind]}"] = uploaded
            counters[kind] += 1
        response = await app.state.http.post(f"{BASE}/v1/videos", headers={"Authorization": f"Bearer {task['key']}"}, json=payload)
        data = response_json(response)
        if not response.is_success:
            raise HTTPException(response.status_code, str(data.get("message") or data.get("error") or "Boluo request failed"))
        upstream = str(data.get("id") or "")
        if not upstream:
            raise HTTPException(502, "Boluo did not return a task ID")
        task["upstream"] = upstream
        logger.info("task=%s stage=submitted upstream=%s elapsed=%.1fs", task_id, upstream, time() - started)
    except HTTPException as exc:
        task.update(status="failed", error=str(exc.detail))
        logger.warning("task=%s stage=failed status=%s detail=%s", task_id, exc.status_code, exc.detail)
    except Exception as exc:  # 后台任务必须兜住所有异常，否则会变成 ASGI 层未处理错误
        task.update(status="failed", error=f"{type(exc).__name__}: {exc}")
        logger.warning("task=%s stage=failed error=%s", task_id, exc)


async def upload_all(media: list[tuple[str, str]], sts: dict) -> list[str]:
    # 全部素材并发搬运；任一失败就取消其余，避免失败后还在空转上传。
    running = [asyncio.create_task(upload_reference(kind, url, sts)) for kind, url in media]
    try:
        return list(await asyncio.gather(*running))
    except Exception:
        for task in running:
            task.cancel()
        await asyncio.gather(*running, return_exceptions=True)
        raise


def reference_fetch_url(url: str) -> str:
    """自家素材改走 docker 内网；没配或不是自家域名就原样返回。

    严格用 `origin + /` 做前缀匹配，`api.jiucaihezi.studio.evil.com` 这类域名不会被改写。
    """
    if not ASSET_FETCH_ORIGIN or not ASSET_INTERNAL_BASE:
        return url
    prefix = f"{ASSET_FETCH_ORIGIN}/"
    if not url.startswith(prefix):
        return url
    return f"{ASSET_INTERNAL_BASE}/{url[len(prefix):]}"


async def upload_reference(kind: str, url: str, sts: dict) -> str:
    host = urlsplit(url).hostname or "unknown-host"
    limit = reference_limit(kind, sts)
    started = time()
    try:
        async with asyncio.timeout(REFERENCE_TIMEOUT_SECONDS):
            uploaded = await transfer_reference(kind, url, sts, limit, host)
    except TimeoutError as exc:
        # 带上实际抓取目标：能一眼看出改写有没有生效（内网 vs 公网）。
        raise HTTPException(
            504,
            f"Reference {kind} from {host} timed out after {REFERENCE_TIMEOUT_SECONDS:.0f}s "
            f"(fetching {urlsplit(reference_fetch_url(url)).netloc})",
        ) from exc
    logger.info("reference kind=%s host=%s stage=uploaded elapsed=%.1fs", kind, host, time() - started)
    return uploaded


def resolution_axis(resolution: str) -> str:
    """从分辨率后缀读出它暗示的画幅。"""
    for suffix, ratio in RESOLUTION_AXIS.items():
        if resolution.endswith(suffix):
            return ratio
    return ""


def resolve_resolution(spec: dict, body: dict, model: str) -> str:
    """方向以 resolution 为准；只有没给 resolution 时才用 ratio 推导，
    两者都给了且互相矛盾就打回 400 —— 不能让客户端拿到一个方向不对的视频。"""
    resolution = str(body.get("resolution") or "")
    ratio = str(body.get("aspect_ratio") or body.get("ratio") or "")
    if not resolution:
        axis = RATIO_AXIS.get(ratio)
        resolution = f"768p{axis}" if axis else DEFAULT_RESOLUTION
    elif ratio in RATIO_AXIS and ratio != resolution_axis(resolution):
        raise HTTPException(
            400,
            f"resolution {resolution} conflicts with aspect_ratio {ratio} for {model}: "
            "这两个模型只认 resolution，请传带竖/横/(1:1) 后缀的分辨率",
        )
    if resolution not in spec["resolutions"]:
        raise HTTPException(400, f"Unsupported resolution for {model}: {resolution}")
    return resolution


def reference_limit(kind: str, sts: dict) -> int:
    """STS 声明的上限优先，缺省用文档默认值（图片 10 MB、音频 20 MB）。"""
    declared = sts.get("maxImageBytes" if kind == "image" else "maxAudioBytes")
    if isinstance(declared, (int, float)) and not isinstance(declared, bool) and declared > 0:
        return int(declared)
    return MAX_IMAGE_BYTES if kind == "image" else MAX_AUDIO_BYTES


EXTENSIONS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
    "image/heic": ".heic",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mp4": ".m4a",
    "audio/aac": ".aac",
    "audio/ogg": ".ogg",
    "audio/flac": ".flac",
}


def object_extension(content_type: str) -> str:
    """对象 key 的扩展名跟着真实 Content-Type 走；未知类型按文档回退。"""
    if content_type in EXTENSIONS:
        return EXTENSIONS[content_type]
    return ".mp3" if content_type.startswith("audio/") else ".bin"


async def transfer_reference(kind: str, url: str, sts: dict, limit: int, host: str) -> str:
    # httpx 的 AsyncClient 不接受文件对象当 body（会被包成同步流，直接 RuntimeError），
    # 所以边下边攒成 bytes 再 PUT，线格式与上游文档的 `requests.put(data=f)` 一致（带 Content-Length）。
    # ponytail: 内存上限就是前面校验过的单文件上限（图片 10 MB / 音频 20 MB），并发转存时按文件数叠加。
    fetch_url = reference_fetch_url(url)
    async with app.state.http.stream("GET", fetch_url) as source:
        if not source.is_success:
            raise HTTPException(400, f"Unable to fetch reference {kind} from {host} (HTTP {source.status_code})")
        content_type = source.headers.get("content-type", "image/png" if kind == "image" else "audio/mpeg").split(";")[0]
        body = bytearray()
        async for chunk in source.aiter_bytes():
            body.extend(chunk)
            if len(body) > limit:
                raise HTTPException(413, f"Reference {kind} from {host} exceeds {limit // (1024 * 1024)} MB")
    date = email.utils.formatdate(usegmt=True)
    ext = object_extension(content_type)
    path = f'{sts["dir"].rstrip("/")}/{uuid.uuid4().hex}{ext}'
    canonical = "\n".join(sorted([f"x-oss-date:{date}", "x-oss-object-acl:public-read", f'x-oss-security-token:{sts["securityToken"]}']))
    string_to_sign = "\n".join(["PUT", "", content_type, date, canonical, f'/{sts["bucket"]}/{path}'])
    signature = base64.b64encode(hmac.new(sts["accessKeySecret"].encode(), string_to_sign.encode(), hashlib.sha1).digest()).decode()
    response = await app.state.http.put(f'{sts["host"].rstrip("/")}/{path}', content=bytes(body), headers={"Authorization": f'OSS {sts["accessKeyId"]}:{signature}', "Content-Type": content_type, "x-oss-date": date, "x-oss-object-acl": "public-read", "x-oss-security-token": sts["securityToken"]})
    if not response.is_success:
        raise HTTPException(502, f"OSS upload failed for reference {kind} from {host} (HTTP {response.status_code})")
    return f'{sts["host"].rstrip("/")}/{path}'


async def get_sts(key: str) -> dict:
    response = await app.state.http.post(f"{BASE}/api/video-upload/oss-sts", headers={"Authorization": f"Bearer {key}"}, timeout=STS_TIMEOUT_SECONDS)
    data = response_json(response)
    if not response.is_success or not data.get("success"):
        raise HTTPException(response.status_code if response.status_code >= 400 else 502, str(data.get("message") or "OSS STS unavailable"))
    return data


def response_json(response: httpx.Response) -> dict:
    try:
        data = response.json()
    except ValueError as exc:
        raise HTTPException(502, "Boluo returned invalid JSON") from exc
    return data if isinstance(data, dict) else {}


@app.exception_handler(HTTPException)
async def errors(_: Request, exc: HTTPException):
    return JSONResponse({"error": {"code": str(exc.status_code), "message": str(exc.detail), "type": "boluo_minimax_error"}}, exc.status_code)

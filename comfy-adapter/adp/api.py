"""FastAPI 应用：OpenAI 兼容的图片生成接口。"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import mimetypes
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .comfy_client import ComfyClient, ComfyError, ComfyTimeout, ComfyUnavailable
from .config import AppConfig, load_config
from .images import ImageInputError, ReferenceImage, from_upload, resolve_many
from .service import Busy, GenerationService, GenResult, UnknownModel
from .storage import ImageStore
from .tasks import CANCELLED, FAILED, QUEUED, RUNNING, SUCCEEDED, Task, TaskStore
from .template import TemplateError, load_templates

log = logging.getLogger("adp.api")


# ------------------------------------------------------------------ 错误响应


def oa_error(status: int, message: str, err_type: str = "invalid_request_error",
             code: str | None = None) -> JSONResponse:
    """OpenAI 风格错误体，new-api 能识别并透传。"""
    return JSONResponse(
        status_code=status,
        content={"error": {"message": message, "type": err_type, "param": None, "code": code}},
    )


#: multipart 表单里需要转成整数的字段
_NUM_FIELDS = {
    "n": int,
    "width": int,
    "height": int,
    "length": int,
    "seed": int,
    "steps": int,
    "resolution": int,
}

#: 落盘时保留的扩展名（决定 /files 返回的 Content-Type）
_KNOWN_EXT = {
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp",
    ".mp4", ".webm", ".mkv", ".mov", ".avi",
    ".mp3", ".wav", ".m4a", ".flac", ".ogg",
}


def _is_true(value: Any) -> bool:
    """宽松解析布尔（multipart 表单里全是字符串）。"""
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in ("1", "true", "yes", "on", "y")


def _coerce_text_fields(raw: dict) -> dict:
    """multipart 表单值全是字符串，这里把数值字段转回来。"""
    out = dict(raw)
    for key, caster in _NUM_FIELDS.items():
        v = out.get(key)
        if isinstance(v, str):
            v = v.strip()
            if v == "":
                out.pop(key, None)
                continue
            try:
                out[key] = caster(v)
            except ValueError as e:
                raise ImageInputError(f"字段 {key} 需要整数，收到 {v!r}") from e
    return out


# ------------------------------------------------------------------ 请求模型


class ImageGenerationRequest(BaseModel):
    """OpenAI Images API 请求体（额外字段一律忽略，保证向前兼容）。"""

    # populate_by_name：让 async_ 字段既能用 "async" 也能用 "async_" 传
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    model: str | None = Field(default=None, description="模型 id，如 qwen-image-2.1 / minimax-h3")
    prompt: str = Field(description="提示词")
    n: int = Field(default=1, ge=1, le=8, description="生成张数")
    size: str | None = Field(default=None, description="如 1024x1024；也可用 width/height")
    width: int | None = Field(default=None, description="非标准扩展：直接指定宽")
    height: int | None = Field(default=None, description="非标准扩展：直接指定高")
    length: int | None = Field(
        default=None, description="非标准扩展：视频帧数（24fps，节点会自动对齐到 17n+5）"
    )
    duration: float | None = Field(
        default=None,
        description="非标准扩展：视频时长（秒）。模板声明 duration_fps 时换算成 length 帧数；"
                    "minimax-h3-ref2v 这类模板本身就是按秒参数，原样透传",
    )
    images: list[str] | None = Field(
        default=None,
        description="非标准扩展：参考图（data URL / http(s) URL），1~10 张；给了就走编辑/参考生成",
    )
    image: str | None = Field(
        default=None,
        description="非标准扩展：单张参考图。OpenAI 习惯单图用 image、多图用 images，这里两个都收",
    )
    first_frame: str | None = Field(
        default=None, description="非标准扩展：首帧图（data URL / http(s) URL），用于图生视频"
    )
    last_frame: str | None = Field(
        default=None, description="非标准扩展：尾帧图，首+尾帧一起给就是 FL2VA"
    )
    async_: bool | None = Field(
        default=None,
        alias="async",
        description="非标准扩展：true 立即返回任务 id 并轮询；false 同步等结果。"
                    "不传时按模型类型定（视频默认 true，图片默认 false）",
    )
    response_format: str | None = Field(default=None, description="b64_json | url")
    seed: int | None = Field(default=None, description="非标准扩展：随机种子")
    steps: int | None = Field(default=None, description="非标准扩展：采样步数")
    resolution: int | str | None = Field(
        default=None, description="非标准扩展：参考图缩放基准边长（整数，非数值一律忽略）"
    )
    negative_prompt: str | None = Field(default=None, description="非标准扩展：负面提示词")
    quality: str | None = None
    style: str | None = None
    user: str | None = None

    @field_validator("resolution", mode="before")
    @classmethod
    def _numeric_resolution(cls, value: Any) -> int | None:
        """`resolution` 只能用整数（参考图缩放基准边长）。

        调用方（例如创作面板）可能带着别的模型残留的画质字符串（'720p'/'2k'）过来。
        那是别的模型的参数，不该让整条请求 422 —— 直接丢弃并记日志。
        """
        if value is None or isinstance(value, bool):
            return None
        if isinstance(value, int):
            return value
        text = str(value).strip()
        if not text:
            return None
        if text.isdigit():
            return int(text)
        log.warning("忽略非数值 resolution=%r：本模板只用整数（参考图缩放基准）", value)
        return None


# ------------------------------------------------------------------ 依赖


def make_auth(cfg: AppConfig):
    async def require_auth(
        authorization: str | None = Header(default=None),
        x_api_key: str | None = Header(default=None),
    ) -> None:
        if not cfg.auth.enabled:
            return
        token = None
        if authorization and authorization.lower().startswith("bearer "):
            token = authorization[7:].strip()
        elif x_api_key:
            token = x_api_key.strip()
        if not token or token not in cfg.auth.effective_keys:
            raise HTTPException(status_code=401, detail="Invalid API key")

    return require_auth


# ------------------------------------------------------------------ 应用工厂


def create_app(cfg: AppConfig | None = None) -> FastAPI:
    cfg = cfg or load_config()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        templates = load_templates(cfg.models)
        if not templates:
            log.warning("没有加载到任何模型，请检查 config.yaml 的 models 配置")

        client = ComfyClient(
            cfg.comfy.base_url,
            client_id=cfg.comfy.client_id,
            poll_interval=cfg.comfy.poll_interval,
            submit_timeout=cfg.comfy.submit_timeout,
            job_timeout=cfg.comfy.job_timeout,
            progress_log_interval=cfg.comfy.progress_log_interval,
        )
        service = GenerationService(cfg, client, templates)
        store = ImageStore(cfg.output.static_path, cfg.server.public_base_url, cfg.output.static_ttl)
        tasks = TaskStore(ttl=cfg.tasks.ttl, max_entries=cfg.tasks.max_entries)

        app.state.cfg = cfg
        app.state.client = client
        app.state.service = service
        app.state.store = store
        app.state.tasks = tasks

        store.cleanup()

        # 后台清理：产物超时删除 + 任务记录过期回收
        async def _sweeper() -> None:
            while True:
                await asyncio.sleep(600)
                try:
                    store.cleanup()
                    tasks.sweep()
                except Exception as e:  # noqa: BLE001
                    log.warning("后台清理出错: %s", e)

        sweeper = asyncio.create_task(_sweeper())

        if cfg.comfy.healthcheck_on_startup:
            try:
                stats = await client.ping()
                devs = [d.get("name") for d in (stats.get("devices") or [])]
                log.info("ComfyUI 在线: %s | 设备: %s", cfg.comfy.base_url, devs)
            except ComfyError as e:
                log.error("ComfyUI 不可用：%s（仍会启动，稍后自动重试）", e)

        log.info("已注册模型: %s", ", ".join(sorted(templates)))
        if not cfg.auth.enabled:
            log.warning("鉴权: 关闭（没有配置任何 api_key）—— 只允许本机/隧道内网访问！")
        elif cfg.auth.using_placeholder:
            log.warning(
                "鉴权: 开启，但 api_keys 里还是占位符！"
                "请改成自己的随机密钥（python -c \"import secrets;print(secrets.token_hex(24))\"）"
            )
        else:
            log.info("鉴权: 开启（%d 个密钥）", len(cfg.auth.effective_keys))
        log.info(
            "产物: 本地磁盘 %s，%s 后自动删除，对外地址 %s",
            cfg.output.static_path,
            f"{cfg.output.static_ttl}s" if cfg.output.static_ttl else "永不",
            cfg.server.public_base_url,
        )
        try:
            yield
        finally:
            sweeper.cancel()
            await client.aclose()

    app = FastAPI(
        title="comfy-adapter",
        description="把本地 ComfyUI 包装成 OpenAI 兼容的图片生成 API",
        version="0.1.0",
        lifespan=lifespan,
    )

    require_auth = make_auth(cfg)
    cfg.output.static_path.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------ 产物服务
    def _send_static(name: str, request: Request) -> Response:
        """按文件名回产物。支持 Range 请求 —— 不然视频播放器没法拖动进度条。

        故意不加鉴权：URL 是随机名，且 24 小时后自动删除。
        """
        if "/" in name or "\\" in name or name.startswith("."):
            raise HTTPException(status_code=400, detail="非法文件名")
        path = cfg.output.static_path / name
        if not path.is_file():
            raise HTTPException(status_code=404, detail="文件不存在或已过期")

        size = path.stat().st_size
        ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
        ttl = max(300, cfg.output.static_ttl or 3600)
        headers = {
            "Cache-Control": f"public, max-age={ttl}",
            "X-Content-Type-Options": "nosniff",
            "Accept-Ranges": "bytes",
        }

        rng = request.headers.get("range") or ""
        if rng.startswith("bytes="):
            m = re.match(r"bytes=(\d*)-(\d*)$", rng.strip())
            if m and (m.group(1) or m.group(2)):
                start = int(m.group(1)) if m.group(1) else 0
                end = int(m.group(2)) if m.group(2) else size - 1
                end = min(end, size - 1)
                if 0 <= start <= end < size:
                    chunk = path.read_bytes()[start : end + 1]
                    headers["Content-Range"] = f"bytes {start}-{end}/{size}"
                    headers["Content-Length"] = str(len(chunk))
                    return Response(
                        content=chunk, status_code=206, media_type=ctype, headers=headers
                    )

        return FileResponse(path, media_type=ctype, headers=headers)

    @app.api_route("/files/{name}", methods=["GET", "HEAD"])
    async def get_file(name: str, request: Request):
        return _send_static(name, request)

    # ------------------------------------------------- 视频任务（NewAPI 轮询合同）
    # 创作面板 / NewAPI 认的是 GET /v1/videos/{id} + GET /v1/videos/{id}/content，
    # 而本服务原生只暴露 /v1/tasks/{id}。这两个别名不改变任务表本身，只是换个形状。
    # 与 rh-adapter 一致，不加鉴权：NewAPI 在它自己的边界上做鉴权和计费。
    _VIDEO_TASK_STATUS = {
        QUEUED: "queued",
        RUNNING: "in_progress",
        SUCCEEDED: "completed",
        FAILED: "failed",
        CANCELLED: "failed",
    }

    def _require_task(task_id: str) -> Task:
        task = app.state.tasks.get(task_id)
        if task is None:
            raise HTTPException(status_code=404, detail=f"任务不存在或已过期: {task_id}")
        return task

    def _output_name(task: Task) -> str:
        """从任务结果里取第一个产物的本地文件名（落盘名，不是对外 URL）。"""
        data = (task.result or {}).get("data")
        if not isinstance(data, list) or not data or not isinstance(data[0], dict):
            return ""
        url = str(data[0].get("url") or "")
        return url.rsplit("/files/", 1)[-1] if "/files/" in url else ""

    @app.get("/v1/videos/{task_id}")
    async def get_video_task(task_id: str):
        task = _require_task(task_id)
        view: dict[str, Any] = {
            "id": task.id,
            "task_id": task.id,
            "object": "video",
            "model": task.model,
            "status": _VIDEO_TASK_STATUS.get(task.status, "in_progress"),
            "progress": 100 if task.status == SUCCEEDED else 0,
            "created_at": int(task.created_at),
        }
        name = _output_name(task)
        if name:
            view["metadata"] = {"url": app.state.store.url_for(name)}
        if task.error:
            view["error"] = task.error
        return view

    @app.get("/v1/videos/{task_id}/content")
    async def get_video_content(task_id: str, request: Request):
        task = _require_task(task_id)
        name = _output_name(task)
        if not name:
            raise HTTPException(status_code=409, detail=f"任务尚未产出成片（{task.status}）")
        return _send_static(name, request)

    # ---------------------------------------------------------- 异常处理器
    @app.exception_handler(RequestValidationError)
    async def _validation_err(_: Request, exc: RequestValidationError):
        """把 FastAPI 的 422 也翻译成 OpenAI 错误体，方便上游客户端解析 error.message。"""
        parts = []
        for e in exc.errors():
            loc = ".".join(str(x) for x in e.get("loc", ()) if x != "body")
            parts.append(f"{loc}: {e.get('msg')}" if loc else str(e.get("msg")))
        return oa_error(422, "参数校验失败 -> " + "; ".join(parts), "invalid_request_error")

    @app.exception_handler(HTTPException)
    async def _http_exc(_: Request, exc: HTTPException):
        return oa_error(exc.status_code, str(exc.detail), "invalid_request_error")

    @app.exception_handler(UnknownModel)
    async def _unknown_model(_: Request, exc: UnknownModel):
        return oa_error(400, str(exc), "invalid_request_error", "model_not_found")

    @app.exception_handler(TemplateError)
    async def _tpl_err(_: Request, exc: TemplateError):
        return oa_error(400, f"模板错误: {exc}", "invalid_request_error")

    @app.exception_handler(ImageInputError)
    async def _img_err(_: Request, exc: ImageInputError):
        return oa_error(400, f"参考图错误: {exc}", "invalid_request_error")

    @app.exception_handler(Busy)
    async def _busy(_: Request, exc: Busy):
        return oa_error(429, str(exc), "rate_limit_error", "server_busy")

    @app.exception_handler(ComfyTimeout)
    async def _timeout(_: Request, exc: ComfyTimeout):
        return oa_error(504, str(exc), "api_error", "upstream_timeout")

    @app.exception_handler(ComfyUnavailable)
    async def _unavail(_: Request, exc: ComfyUnavailable):
        return oa_error(503, str(exc), "api_error", "upstream_unavailable")

    @app.exception_handler(ComfyError)
    async def _comfy_err(_: Request, exc: ComfyError):
        return oa_error(502, str(exc), "api_error", "generation_failed")

    # ------------------------------------------------------------ 基础路由
    @app.get("/")
    async def root():
        return {
            "name": "comfy-adapter",
            "version": "0.1.0",
            "comfyui": cfg.comfy.base_url,
            "models": sorted(app.state.service.templates),
            "endpoints": [
                "/health",
                "/v1/models",
                "/v1/images/generations",
                "/v1/images/edits",
                "/v1/videos/generations",
                "/v1/videos",
                "/v1/videos/{id}",
                "/v1/videos/{id}/content",
                "/v1/tasks",
                "/v1/tasks/{id}",
                "/files/{name}",
            ],
        }

    @app.get("/health")
    async def health():
        info: dict[str, Any] = await app.state.service.health()
        s = app.state.service.stats
        info["stats"] = {
            "total": s.total, "ok": s.ok, "failed": s.failed, "rejected": s.rejected,
            "last_elapsed_seconds": round(s.last_elapsed, 2),
        }
        info["tasks"] = app.state.tasks.stats()
        info["storage"] = {
            "driver": "local",
            "dir": str(cfg.output.static_path),
            "ttl_seconds": cfg.output.static_ttl,
            "files": len(list(cfg.output.static_path.glob("*"))),
        }
        status = 200 if info.get("comfyui") == "ok" else 503
        return JSONResponse(status_code=status, content=info)

    # ------------------------------------------------------------ 模型列表
    @app.get("/v1/models", dependencies=[Depends(require_auth)])
    async def list_models():
        return {"object": "list", "data": app.state.service.list_models()}

    @app.get("/v1/models/{model_id}", dependencies=[Depends(require_auth)])
    async def get_model(model_id: str):
        for m in app.state.service.list_models():
            if m["id"] == model_id:
                return m
        raise UnknownModel(f"未知模型 {model_id!r}")

    # ------------------------------------------------------------ 产出编码
    def _suffix(meta: dict) -> str:
        ext = Path(str(meta.get("filename") or "")).suffix.lower()
        if ext in _KNOWN_EXT:
            return ext
        return {"video": ".mp4", "audio": ".m4a"}.get(str(meta.get("kind")), ".png")

    def _encode_outputs(result: GenResult, fmt: str | None) -> list[dict[str, str]]:
        """按 response_format 组装 data 数组。

        视频 / 音频**强制走 URL**：一个 20MB 的 mp4 转 base64 会膨胀到 27MB，
        塞进 JSON 既浪费带宽又容易撞上各层的大小限制。
        """
        fmt = (fmt or cfg.output.default_response_format).lower()
        if fmt not in ("b64_json", "url"):
            raise TemplateError(f"不支持的 response_format: {fmt}")

        metas = list(result.outputs or [])
        kinds = [str(m.get("kind") or "image") for m in metas]
        non_image = any(k != "image" for k in kinds)

        data: list[dict[str, str]] = []
        if fmt == "url" or non_image:
            app.state.store.cleanup()
            for idx, blob in enumerate(result.images):
                meta = metas[idx] if idx < len(metas) else {}
                name = app.state.store.save(blob, suffix=_suffix(meta))
                item: dict[str, str] = {"url": app.state.store.url_for(name)}
                ctype, _ = mimetypes.guess_type(name)
                if ctype:
                    item["content_type"] = ctype
                if meta.get("kind") and meta["kind"] != "image":
                    item["kind"] = str(meta["kind"])
                data.append(item)
        else:
            for blob in result.images:
                data.append({"b64_json": base64.b64encode(blob).decode("ascii")})
        return data

    def _image_payload(result: GenResult, fmt: str | None) -> dict:
        return {
            "created": int(time.time()),
            "data": _encode_outputs(result, fmt),
            "model": result.model,
            # 以下为扩展字段，方便排障；标准客户端会忽略
            "elapsed_seconds": round(result.elapsed, 2),
            "prompt_id": result.prompt_id,
            "params": {
                k: v
                for k, v in result.params.items()
                if k not in ("prompt", "reference_images", "first_frame", "last_frame")
            },
        }

    def _image_response(result: GenResult, fmt: str | None) -> JSONResponse:
        return JSONResponse(content=_image_payload(result, fmt))

    # ------------------------------------------------------------ 异步任务
    def _task_response(task: Task, *, include_result: bool = True) -> dict:
        view = task.view(include_result=include_result)
        # task_id 是给中转网关认的：仓库里其它适配器（shanhai / boluo / xiaoyi /
        # kik / zx-video）的提交体都同时给 id 与 task_id，NewAPI 按这个约定取任务号。
        view["task_id"] = task.id
        view["status_url"] = f"/v1/tasks/{task.id}"
        return view

    def _task_error_code(exc: BaseException) -> str:
        if isinstance(exc, Busy):
            return "server_busy"
        if isinstance(exc, ComfyTimeout):
            return "upstream_timeout"
        if isinstance(exc, ComfyUnavailable):
            return "upstream_unavailable"
        if isinstance(exc, ComfyError):
            return "generation_failed"
        if isinstance(exc, (TemplateError, ImageInputError, UnknownModel)):
            return "invalid_request_error"
        return "api_error"

    async def _run_task(
        task: Task, model: str | None, raw: dict, image_inputs: dict
    ) -> None:
        """后台执行任务，把结果 / 异常写回 task 对象。"""
        if task.cancel_requested:
            task.status = CANCELLED
            task.finished_at = time.time()
            return

        def _on_start() -> None:
            # 拿到并发名额、真正开始跑的时刻。之前的等待都算排队
            task.status = RUNNING
            task.started_at = time.time()
            log.info(
                "[任务 %s] 开始执行（排队 %.1fs）", task.id, task.started_at - task.created_at
            )

        try:
            result = await app.state.service.generate(
                model, raw, image_inputs, on_start=_on_start
            )
            task.result = _image_payload(result, raw.get("response_format"))
            task.status = SUCCEEDED
        except asyncio.CancelledError:
            task.status = CANCELLED
            raise
        except Exception as e:  # noqa: BLE001
            task.status = FAILED
            task.error = {
                "message": str(e),
                "type": type(e).__name__,
                "code": _task_error_code(e),
            }
            log.warning("[任务 %s] 失败: %s: %s", task.id, type(e).__name__, e)
        finally:
            if task.finished_at is None:
                task.finished_at = time.time()
            log.info(
                "[任务 %s] %s（%s），排队 %ss + 执行 %ss",
                task.id, task.status, task.type, task.queued_seconds, task.elapsed,
            )

    def _submit_task(
        task_type: str, model: str | None, raw: dict, image_inputs: dict
    ) -> JSONResponse:
        try:
            task = app.state.tasks.create(task_type, model, raw)
        except RuntimeError as e:
            raise Busy(str(e)) from e
        asyncio.create_task(_run_task(task, model, raw, image_inputs))
        log.info("[任务 %s] 已入队（%s，模型 %s）", task.id, task_type, model)
        # 必须回 200：NewAPI 只把 200 当中继成功，收到 202 会判为失败，
        # 把它自己的响应体当作错误 message 丢回面板（表现为「后台成功但面板报错」）。
        # 仓库里其它适配器的异步提交也都是 200。
        return JSONResponse(status_code=200, content=_task_response(task, include_result=False))

    async def _refs_from_strings(items) -> list[ReferenceImage]:
        return await resolve_many(
            list(items or []),
            max_bytes=cfg.edit.max_image_bytes,
            timeout=cfg.edit.fetch_url_timeout,
            limit=cfg.edit.max_reference_images,
        )

    def _split_image_list(value: str) -> list[str]:
        """文本字段里的图片列表：JSON 数组或换行分隔都认。"""
        raw = value.strip()
        if not raw:
            return []
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return [s for s in raw.splitlines() if s.strip()]
        if isinstance(parsed, str):
            return [parsed]
        return [str(s) for s in parsed if s]

    def _route_images(
        tpl,
        generic: list[ReferenceImage],
        first: list[ReferenceImage],
        last: list[ReferenceImage],
    ) -> dict[str, list[ReferenceImage]]:
        """把「通用图 / 首帧 / 尾帧」映射到模板声明的动态块参数名。

        multipart 里的 `image` / `images` 是通用字段，语义由模板决定：
          * 模板有 reference_images → 当参考图（Qwen 编辑）
          * 模板只有 first_frame     → 当首帧（图生视频的 input_reference 就是这个意思）
        """
        params = tpl.dynamic_params
        out: dict[str, list[ReferenceImage]] = {}
        if first:
            out["first_frame"] = first
        if last:
            out["last_frame"] = last
        if generic:
            if "reference_images" in params:
                out["reference_images"] = generic
            elif "first_frame" in params and "first_frame" not in out:
                out["first_frame"] = generic[:1]
            else:
                out["reference_images"] = generic
        return out

    async def _collect_images(
        req: ImageGenerationRequest, raw: dict
    ) -> dict[str, list[ReferenceImage]]:
        """从 JSON 请求里收集图片输入，并从 raw 里摘掉这些字段。"""
        # 单图用 image、多图用 images —— OpenAI 习惯两种写法，这里都收
        listed = list(req.images or [])
        if req.image:
            listed.append(req.image)
        generic = await _refs_from_strings(listed)
        first = await _refs_from_strings([req.first_frame] if req.first_frame else [])
        last = await _refs_from_strings([req.last_frame] if req.last_frame else [])
        for key in ("images", "image", "first_frame", "last_frame"):
            raw.pop(key, None)
        tpl = app.state.service.get_template(req.model)
        return _route_images(tpl, generic, first, last)

    async def _generate(req: ImageGenerationRequest):
        """图片 / 视频生成的统一入口。

        `async` 不传时按模型定：视频默认异步（要跑几分钟，同步必踩 Cloudflare 100s）。
        """
        raw = req.model_dump()
        tpl = app.state.service.get_template(req.model)
        image_inputs = await _collect_images(req, raw)
        use_async = req.async_ if req.async_ is not None else tpl.default_async

        if tpl.output_kind == "video":
            kind = "video.generation"
        elif image_inputs:
            kind = "image.edit"
        else:
            kind = "image.generation"

        if use_async:
            return _submit_task(kind, req.model, raw, image_inputs)
        result = await app.state.service.generate(req.model, raw, image_inputs)
        return _image_response(result, req.response_format)

    @app.post("/v1/images/generations", dependencies=[Depends(require_auth)])
    async def images_generations(req: ImageGenerationRequest):
        return await _generate(req)

    @app.post("/v1/videos/generations", dependencies=[Depends(require_auth)])
    async def videos_generations(req: ImageGenerationRequest):
        return await _generate(req)

    @app.post("/v1/videos", dependencies=[Depends(require_auth)])
    async def videos_create(req: ImageGenerationRequest):
        """Sora 风格的别名，行为和 /v1/videos/generations 一致。"""
        return await _generate(req)

    @app.post("/v1/images/edits", dependencies=[Depends(require_auth)])
    async def images_edits(request: Request):
        """OpenAI 兼容的图片编辑（单图 / 多图参考）。

        支持两种传法：
          * ``multipart/form-data``：文件字段 ``image`` / ``image[]`` / ``images``（可重复），
            其余为普通文本字段（prompt / model / size / n / seed / steps ...）
          * ``application/json``：``images`` 为字符串数组（data URL / http(s) URL / 已上传文件名）
        """
        ctype = (request.headers.get("content-type") or "").lower()
        generic: list[ReferenceImage] = []
        first: list[ReferenceImage] = []
        last: list[ReferenceImage] = []

        if ctype.startswith(("multipart/form-data", "application/x-www-form-urlencoded")):
            form = await request.form()
            raw: dict[str, Any] = {}
            uploads: dict[str, list[ReferenceImage]] = {}
            for key, value in form.multi_items():
                if hasattr(value, "read") and hasattr(value, "filename"):
                    data = await value.read()
                    base = str(key).rstrip("[]")
                    uploads.setdefault(base, []).append(
                        from_upload(
                            getattr(value, "filename", None) or "upload.png",
                            data,
                            max_bytes=cfg.edit.max_image_bytes,
                        )
                    )
                elif key in ("mask", "mask[]"):
                    log.warning("收到 mask 字段，但当前模板不支持局部重绘，已忽略")
                else:
                    raw[str(key)] = value
            raw = _coerce_text_fields(raw)

            generic = uploads.pop("image", []) + uploads.pop("images", [])
            first = uploads.pop("first_frame", [])
            last = uploads.pop("last_frame", [])
            for leftover, items in uploads.items():
                log.warning("multipart 里未知的图片字段 %r，已忽略（%d 张）", leftover, len(items))

            # 文本字段里也可能塞图片（URL / data URL / JSON 数组）
            if not generic:
                maybe = raw.get("images") or raw.get("image")
                if isinstance(maybe, str) and maybe.strip():
                    generic = await _refs_from_strings(_split_image_list(maybe))
            if not first:
                v = raw.get("first_frame")
                if isinstance(v, str) and v.strip():
                    first = await _refs_from_strings(_split_image_list(v))
            if not last:
                v = raw.get("last_frame")
                if isinstance(v, str) and v.strip():
                    last = await _refs_from_strings(_split_image_list(v))
        else:
            body = await request.json()
            if not isinstance(body, dict):
                raise ImageInputError("请求体必须是 JSON 对象")
            raw = dict(body)
            generic = await _refs_from_strings(raw.pop("images", None))
            ff = raw.pop("first_frame", None)
            lf = raw.pop("last_frame", None)
            if ff:
                first = await _refs_from_strings([ff])
            if lf:
                last = await _refs_from_strings([lf])

        model = raw.get("model")
        tpl = app.state.service.get_template(model)
        image_inputs = _route_images(tpl, generic, first, last)

        if not image_inputs:
            raise ImageInputError(
                "编辑请求至少需要 1 张图片"
                "（multipart 用 image / first_frame 字段，JSON 用 images / first_frame）"
            )
        if not raw.get("prompt"):
            raise ImageInputError("缺少 prompt 字段")

        for key in ("images", "image", "first_frame", "last_frame", "async_"):
            raw.pop(key, None)

        explicit_async = raw.pop("async", None)
        use_async = _is_true(explicit_async) if explicit_async is not None else tpl.default_async

        if use_async:
            return _submit_task("image.edit", model, raw, image_inputs)

        result = await app.state.service.generate(model, raw, image_inputs)
        return _image_response(result, raw.get("response_format"))

    # ------------------------------------------------------------ 任务查询
    @app.post("/v1/tasks", dependencies=[Depends(require_auth)])
    async def create_task(req: ImageGenerationRequest):
        """通用异步入口：无论模型默认是否异步，这里一律按异步处理。"""
        raw = req.model_dump()
        tpl = app.state.service.get_template(req.model)
        image_inputs = await _collect_images(req, raw)
        if tpl.output_kind == "video":
            kind = "video.generation"
        elif image_inputs:
            kind = "image.edit"
        else:
            kind = "image.generation"
        return _submit_task(kind, req.model, raw, image_inputs)

    @app.get("/v1/tasks", dependencies=[Depends(require_auth)])
    async def list_tasks(limit: int = 50):
        return {
            "object": "list",
            "tasks": app.state.tasks.stats(),
            "data": [
                _task_response(t, include_result=False)
                for t in app.state.tasks.all(max(1, min(limit, 500)))
            ],
        }

    @app.get("/v1/tasks/{task_id}", dependencies=[Depends(require_auth)])
    async def get_task(task_id: str):
        task = app.state.tasks.get(task_id)
        if task is None:
            raise HTTPException(status_code=404, detail=f"任务不存在或已过期: {task_id}")
        return _task_response(task)

    @app.post("/v1/tasks/{task_id}/cancel", dependencies=[Depends(require_auth)])
    @app.delete("/v1/tasks/{task_id}", dependencies=[Depends(require_auth)])
    async def cancel_task(task_id: str):
        task = app.state.tasks.get(task_id)
        if task is None:
            raise HTTPException(status_code=404, detail=f"任务不存在或已过期: {task_id}")
        if task.is_terminal:
            return _task_response(task)
        if not cfg.tasks.allow_cancel:
            raise HTTPException(status_code=400, detail="当前配置不允许取消任务")

        task.cancel_requested = True
        if task.status == RUNNING:
            # 并发为 1，所以 interrupt 命中的就是它
            await app.state.client.interrupt()
        else:
            task.status = CANCELLED
            task.finished_at = time.time()
        log.info("[任务 %s] 请求取消", task.id)
        return _task_response(task)

    return app

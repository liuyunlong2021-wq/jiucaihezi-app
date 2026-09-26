"""生成服务：并发闸门 + 提交 + 等结果 + 取图。"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from .comfy_client import ComfyClient, ComfyError
from .config import AppConfig
from .images import ReferenceImage, image_size
from .template import TemplateError, WorkflowTemplate

log = logging.getLogger("adp.service")


class Busy(RuntimeError):
    """队列已满 / 等待超时，应返回 429 / 503。"""


class UnknownModel(ValueError):
    """请求的模型不在注册表里。"""


@dataclass
class GenResult:
    model: str
    prompt_id: str
    images: list[bytes]
    elapsed: float
    params: dict[str, Any] = field(default_factory=dict)
    #: 每个产出文件的元信息（filename / subfolder / type / kind），与 images 一一对应。
    #: kind 是 image / video / audio —— 视频要从 VHS 的 gifs 字段里取，别只认 images。
    outputs: list[dict] = field(default_factory=list)
    node_errors: dict | None = None


@dataclass
class Stats:
    total: int = 0
    ok: int = 0
    failed: int = 0
    rejected: int = 0
    last_error: str | None = None
    last_elapsed: float = 0.0


class GenerationService:
    def __init__(self, cfg: AppConfig, client: ComfyClient, templates: dict[str, WorkflowTemplate]):
        self.cfg = cfg
        self.client = client
        self.templates = templates
        # 并发闸门：4090 48G 上跑 20GB 模型，1 条并发最稳
        self._sem = asyncio.Semaphore(max(1, cfg.limits.max_concurrency))
        # 在途任务数（含排队中）
        self._inflight = 0
        self._lock = asyncio.Lock()
        self.stats = Stats()

    # ------------------------------------------------------------- 注册表
    def get_template(self, model_id: str | None) -> WorkflowTemplate:
        if not self.templates:
            raise UnknownModel("适配层没有加载任何模型")
        if not model_id:
            # 未指定时用第一个（也是唯一常用的）
            return next(iter(self.templates.values()))
        tpl = self.templates.get(model_id)
        if tpl is None:
            raise UnknownModel(
                f"未知模型 {model_id!r}，可用: {', '.join(sorted(self.templates))}"
            )
        return tpl

    def list_models(self) -> list[dict]:
        return [t.describe() for t in self.templates.values()]

    # --------------------------------------------------------------- 主流程
    async def generate(
        self,
        model_id: str | None,
        raw_params: dict,
        image_inputs: dict[str, list[ReferenceImage]] | None = None,
        on_start: Callable[[], None] | None = None,
    ) -> GenResult:
        """生成一次。

        `image_inputs` 形如 ``{"reference_images": [...], "first_frame": [...]}``，
        键名必须和模板 meta 里 `dynamic_blocks[].param` 对上。
        """
        tpl = self.get_template(model_id)
        inputs = {k: list(v) for k, v in (image_inputs or {}).items() if v}
        raw = dict(raw_params)

        if inputs:
            unknown = sorted(set(inputs) - tpl.dynamic_params)
            if unknown:
                support = ", ".join(sorted(tpl.dynamic_params)) or "无"
                raise TemplateError(
                    f"模型 {tpl.id} 不接受这些图片输入: {', '.join(unknown)}（它支持: {support}）"
                )

            # 没显式指定尺寸时，沿用第一张输入图的宽高（OpenAI 编辑接口的惯例）
            if self.cfg.edit.default_to_reference_size and not any(
                raw.get(k) for k in ("size", "width", "height")
            ):
                flat = inputs.get("first_frame") or next(iter(inputs.values()))
                dims = next(
                    (
                        image_size(r.data)
                        for r in flat
                        if r.data is not None and image_size(r.data)
                    ),
                    None,
                )
                if dims:
                    raw["width"], raw["height"] = dims
                    log.info("[%s] 未指定 size，沿用输入图尺寸 %dx%d", tpl.id, *dims)

        values = tpl.normalize(raw, max_batch=self.cfg.limits.max_batch)

        # 把输入图上传到 ComfyUI 的 input 目录，换成 LoadImage 能直接读的引用。
        # 模板里对应的 dynamic_blocks 会据此动态生成 LoadImage 节点并接线。
        for param, refs in inputs.items():
            uploaded: list[str] = []
            for im in refs:
                if im.data is not None:
                    ref = await self.client.upload_image(
                        im.data, im.filename, subfolder=self.cfg.edit.upload_subfolder
                    )
                else:
                    ref = im.existing
                uploaded.append(ref)
            values[param] = uploaded
            log.info("[%s] %s 输入 %d 张 -> %s", tpl.id, param, len(uploaded), uploaded)

        rendered = tpl.render(values)

        async with self._lock:
            self._inflight += 1
            inflight_now = self._inflight

        if inflight_now > self.cfg.limits.max_queue + self.cfg.limits.max_concurrency:
            async with self._lock:
                self._inflight -= 1
            self.stats.rejected += 1
            self.stats.total += 1
            raise Busy(f"队列已满（在途 {inflight_now - 1}），请稍后重试")

        acquired = False
        started = 0.0
        self.stats.total += 1
        try:
            try:
                await asyncio.wait_for(self._sem.acquire(), timeout=self.cfg.limits.wait_timeout)
                acquired = True
            except asyncio.TimeoutError as e:
                self.stats.rejected += 1
                raise Busy("排队等待超时，请稍后重试") from e

            # 计时从「真正拿到并发名额」开始，排队时间不算在生成耗时里
            started = time.monotonic()

            if on_start is not None:
                on_start()

            log.info(
                "[%s] 开始生成 width=%s height=%s n=%s steps=%s seed=%s",
                tpl.id, values.get("width"), values.get("height"),
                values.get("batch_size"), values.get("steps"), values.get("seed"),
            )

            prompt_id = await self.client.submit(rendered)
            log.info("[%s] 已提交 prompt_id=%s", tpl.id, prompt_id)

            entry = await self.client.wait_for_result(prompt_id)
            err = self.client.extract_error(entry)
            if err:
                raise ComfyError(f"ComfyUI 执行失败: {err}")

            outputs = self.client.extract_images(entry)
            if not outputs:
                raise ComfyError(
                    "任务完成，但没有找到任何产出文件（检查模板里的 SaveImage / VHS_VideoCombine 节点）"
                )

            blobs: list[bytes] = []
            metas: list[dict] = []
            for item in outputs:
                blobs.append(await self.client.fetch_image(item))
                metas.append(
                    {
                        "filename": item.get("filename"),
                        "subfolder": item.get("subfolder", ""),
                        "type": item.get("type", "output"),
                        "kind": self.client.guess_kind(item),
                    }
                )

            elapsed = time.monotonic() - started
            self.stats.ok += 1
            self.stats.last_elapsed = elapsed
            log.info(
                "[%s] 完成，%d 个产出（%s），耗时 %.2fs",
                tpl.id,
                len(blobs),
                ", ".join(m["kind"] for m in metas),
                elapsed,
            )
            return GenResult(
                model=tpl.id,
                prompt_id=prompt_id,
                images=blobs,
                elapsed=elapsed,
                params=values,
                outputs=metas,
            )

        except (ComfyError, TemplateError, Busy):
            self.stats.failed += 1
            raise
        except Exception as e:  # noqa: BLE001
            self.stats.failed += 1
            self.stats.last_error = f"{type(e).__name__}: {e}"
            raise
        finally:
            if acquired:
                self._sem.release()
            async with self._lock:
                self._inflight -= 1

    # ---------------------------------------------------------------- 状态
    async def health(self) -> dict:
        info: dict[str, Any] = {
            "adapter": "ok",
            "models": sorted(self.templates),
            "inflight": self._inflight,
            "max_concurrency": self.cfg.limits.max_concurrency,
        }
        try:
            stats = await self.client.ping()
            q = await self.client.queue_info()
            info["comfyui"] = "ok"
            info["comfyui_devices"] = [
                d.get("name") for d in (stats.get("devices") or [])
            ]
            info["comfyui_version"] = (stats.get("system") or {}).get("comfyui_version")
            info["queue"] = {
                "running": len(q.get("queue_running") or []),
                "pending": len(q.get("queue_pending") or []),
            }
        except ComfyError as e:
            info["comfyui"] = "unreachable"
            info["comfyui_error"] = str(e)
        return info

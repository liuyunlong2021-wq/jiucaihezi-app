"""ComfyUI HTTP 客户端：提交任务、轮询历史、取回图片。"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from typing import Any

import httpx

log = logging.getLogger("adp.comfy")


class ComfyError(RuntimeError):
    """ComfyUI 返回的业务错误（节点校验失败、执行异常等）。"""

    def __init__(self, message: str, *, detail: Any = None):
        super().__init__(message)
        self.detail = detail


class ComfyTimeout(ComfyError):
    """等待任务完成超时。"""


class ComfyUnavailable(ComfyError):
    """连不上 ComfyUI。"""


class ComfyClient:
    def __init__(
        self,
        base_url: str,
        *,
        client_id: str = "comfy-adapter",
        poll_interval: float = 0.5,
        submit_timeout: float = 30.0,
        job_timeout: float = 1800.0,
        progress_log_interval: float = 15.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.client_id = client_id
        self.poll_interval = poll_interval
        self.submit_timeout = submit_timeout
        self.job_timeout = job_timeout
        self.progress_log_interval = progress_log_interval
        self._http = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=httpx.Timeout(60.0, connect=10.0),
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    # ---------------------------------------------------------------- 基础
    async def ping(self) -> dict:
        try:
            r = await self._http.get("/system_stats", timeout=10.0)
            r.raise_for_status()
            return r.json()
        except httpx.HTTPError as e:
            raise ComfyUnavailable(f"连不上 ComfyUI ({self.base_url}): {e}") from e

    async def queue_info(self) -> dict:
        r = await self._http.get("/queue", timeout=10.0)
        r.raise_for_status()
        return r.json()

    async def object_info(self) -> dict:
        r = await self._http.get("/object_info", timeout=180.0)
        r.raise_for_status()
        return r.json()

    # ------------------------------------------------------------ 提交任务
    async def submit(self, prompt: dict) -> str:
        """把渲染好的 API 格式 prompt 提交到 ComfyUI，返回 prompt_id。"""
        payload = {"prompt": prompt, "client_id": self.client_id}
        try:
            r = await self._http.post("/prompt", json=payload, timeout=self.submit_timeout)
        except httpx.HTTPError as e:
            raise ComfyUnavailable(f"提交任务失败（网络）: {e}") from e

        if r.status_code == 200:
            data = r.json()
            pid = data.get("prompt_id")
            if not pid:
                raise ComfyError(f"ComfyUI 未返回 prompt_id: {data}")
            return pid

        # 400 = 节点校验失败
        try:
            body = r.json()
        except Exception:  # noqa: BLE001
            body = {"raw": r.text[:1000]}
        err = body.get("error") or {}
        msg = err.get("message") or f"ComfyUI 返回 HTTP {r.status_code}"
        details = err.get("details") or ""
        node_errors = body.get("node_errors") or {}
        pretty = json.dumps(node_errors, ensure_ascii=False)[:2000] if node_errors else ""
        raise ComfyError(
            f"{msg} {details}".strip(),
            detail={"node_errors": node_errors, "raw": pretty or body},
        )

    # ------------------------------------------------------------ 等待结果
    async def wait_for_result(self, prompt_id: str, *, timeout: float | None = None) -> dict:
        """轮询 /history 直到任务结束，返回该条 history 记录。"""
        deadline = time.monotonic() + (timeout if timeout is not None else self.job_timeout)
        last_log = 0.0
        started = time.monotonic()

        while True:
            entry = await self._get_history(prompt_id)
            if entry:
                status = entry.get("status") or {}
                if status.get("completed") is True or status.get("status_str") == "error":
                    return entry

            now = time.monotonic()
            if now > deadline:
                raise ComfyTimeout(
                    f"任务 {prompt_id} 超时（{timeout if timeout is not None else self.job_timeout:.0f}s）"
                )
            if now - last_log >= self.progress_log_interval:
                last_log = now
                log.info("任务 %s 执行中… 已等待 %.0fs", prompt_id, now - started)
            await asyncio.sleep(self.poll_interval)

    async def _get_history(self, prompt_id: str) -> dict | None:
        try:
            r = await self._http.get(f"/history/{prompt_id}", timeout=30.0)
        except httpx.HTTPError as e:
            log.warning("查询 history 失败，重试: %s", e)
            return None
        if r.status_code != 200:
            return None
        try:
            data = r.json()
        except Exception:  # noqa: BLE001
            return None
        if not data:
            return None
        return data.get(prompt_id)

    # ---------------------------------------------------------- 结果解析
    @staticmethod
    def extract_error(entry: dict) -> str | None:
        """从 history 记录里提取错误信息（成功返回 None）。"""
        status = entry.get("status") or {}
        if status.get("status_str") != "error":
            return None

        messages = status.get("messages") or []
        for m in messages:
            # 形如 ["execution_error", {...}]
            if isinstance(m, (list, tuple)) and len(m) == 2 and m[0] == "execution_error":
                info = m[1] or {}
                return (
                    f"{info.get('exception_type', 'Error')}: {info.get('exception_message', '')}"
                    f"  (node_type={info.get('node_type')}, node_id={info.get('node_id')})"
                )
        return "ComfyUI 执行失败（未提供详细信息，请看 ComfyUI 日志）"

    #: 产出文件的字段名。「图片不一定是 images」——这一点很坑：
    #:   SaveImage       -> images
    #:   VHS_VideoCombine -> gifs   （视频也是放这里）
    #:   SaveVideo       -> videos
    OUTPUT_KEYS = ("images", "gifs", "videos", "audio", "audio_files")

    @classmethod
    def extract_images(cls, entry: dict) -> list[dict]:
        """收集所有产出文件（图片 / 视频 / 音频），带 _node 与 _key 便于排障。"""
        out: list[dict] = []
        for node_id, node_out in (entry.get("outputs") or {}).items():
            if not isinstance(node_out, dict):
                continue
            for key in cls.OUTPUT_KEYS:
                for item in node_out.get(key) or []:
                    if not isinstance(item, dict) or not item.get("filename"):
                        continue
                    if item.get("type") == "temp":
                        continue
                    out.append({**item, "_node": node_id, "_key": key})
        return out

    @staticmethod
    def guess_kind(item: dict) -> str:
        """按扩展名判断产出类型：image / video / audio / other。"""
        name = str(item.get("filename", "")).lower()
        if name.endswith((".mp4", ".webm", ".mkv", ".mov", ".avi")):
            return "video"
        if name.endswith((".gif",)):
            return "video"
        if name.endswith((".mp3", ".wav", ".flac", ".m4a", ".ogg")):
            return "audio"
        if name.endswith((".png", ".jpg", ".jpeg", ".webp", ".bmp")):
            return "image"
        return "other"

    async def fetch_image(self, img: dict) -> bytes:
        params = {
            "filename": img.get("filename"),
            "subfolder": img.get("subfolder", ""),
            "type": img.get("type", "output"),
        }
        r = await self._http.get("/view", params=params, timeout=120.0)
        r.raise_for_status()
        return r.content

    async def interrupt(self) -> None:
        try:
            await self._http.post("/interrupt", timeout=10.0)
        except httpx.HTTPError as e:
            log.warning("interrupt 失败: %s", e)

    # ------------------------------------------------------------ 上传图片
    async def upload_image(
        self,
        data: bytes,
        filename: str,
        *,
        subfolder: str = "",
        overwrite: bool = True,
    ) -> str:
        """把参考图上传到 ComfyUI 的 input 目录。

        返回可直接喂给 LoadImage 的 ``image`` 值（``subfolder/name`` 或 ``name``）。
        """
        form: dict[str, str] = {"type": "input"}
        if overwrite:
            form["overwrite"] = "true"
        if subfolder:
            form["subfolder"] = subfolder

        files = {"image": (filename, data, "application/octet-stream")}
        try:
            r = await self._http.post(
                "/upload/image", data=form, files=files, timeout=180.0
            )
        except httpx.HTTPError as e:
            raise ComfyUnavailable(f"上传参考图失败（网络）: {e}") from e

        if r.status_code != 200:
            raise ComfyError(f"上传参考图失败: HTTP {r.status_code} {r.text[:300]}")

        j = r.json()
        name = j.get("name")
        if not name:
            raise ComfyError(f"上传参考图返回异常: {j}")
        sub = (j.get("subfolder") or "").strip().strip("/")
        return f"{sub}/{name}" if sub else name

    # ------------------------------------------------------------- 调试
    @staticmethod
    def new_client_id() -> str:
        return str(uuid.uuid4())

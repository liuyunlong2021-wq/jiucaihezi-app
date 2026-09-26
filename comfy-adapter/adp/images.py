"""参考图解析：把 multipart / data URL / http(s) URL / 已有文件名 统一成 ReferenceImage。

编辑类请求的图片可能以四种形式进来：
  1. multipart 上传的原始字节
  2. `data:image/png;base64,...`
  3. `https://...` 远程 URL
  4. 已经在 ComfyUI input 目录里的相对路径（高级用法，直接透传）
"""

from __future__ import annotations

import base64
import hashlib
import logging
import re
import struct
from dataclasses import dataclass

import httpx

log = logging.getLogger("adp.images")


class ImageInputError(ValueError):
    """参考图无法解析 / 超限。"""


@dataclass
class ReferenceImage:
    filename: str
    #: 需要上传的原始字节（None 表示复用 ComfyUI input 目录里已有的文件）
    data: bytes | None = None
    #: 已存在于 ComfyUI input 目录中的相对路径
    existing: str | None = None

    @property
    def is_upload(self) -> bool:
        return self.data is not None


# ------------------------------------------------------------------ 格式识别

_DATA_URL_RE = re.compile(
    r"^data:(?P<mime>[^;,]*)?(?:;charset=[^;,]*)?;base64,(?P<b64>.*)$", re.S | re.I
)

_MAGIC: list[tuple[bytes, str]] = [
    (b"\x89PNG\r\n\x1a\n", ".png"),
    (b"\xff\xd8\xff", ".jpg"),
    (b"GIF87a", ".gif"),
    (b"GIF89a", ".gif"),
    (b"BM", ".bmp"),
]

ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}


def sniff_ext(data: bytes) -> str:
    for magic, ext in _MAGIC:
        if data.startswith(magic):
            return ext
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return ".png"


def content_name(data: bytes) -> str:
    """用内容哈希做文件名 —— 同一张图重复上传不会重复占盘，也天然去重。"""
    return hashlib.sha256(data).hexdigest()[:24] + sniff_ext(data)


def parse_data_url(value: str) -> bytes:
    m = _DATA_URL_RE.match(value.strip())
    if not m:
        raise ImageInputError("data URL 格式不对，应形如 data:image/png;base64,....")
    try:
        return base64.b64decode(m.group("b64"), validate=False)
    except Exception as e:  # noqa: BLE001
        raise ImageInputError(f"data URL base64 解码失败: {e}") from e


# ------------------------------------------------------------------ 尺寸探测


def image_size(data: bytes) -> tuple[int, int] | None:
    """读取 PNG / JPEG 的宽高（用于编辑时默认沿用参考图尺寸）。失败返回 None。"""
    try:
        if len(data) > 24 and data.startswith(b"\x89PNG\r\n\x1a\n"):
            w, h = struct.unpack(">II", data[16:24])
            return int(w), int(h)
        if data.startswith(b"\xff\xd8"):
            i, n = 2, len(data)
            while i + 9 < n:
                if data[i] != 0xFF:
                    i += 1
                    continue
                marker = data[i + 1]
                # SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
                if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                              0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                    h, w = struct.unpack(">HH", data[i + 5:i + 9])
                    return int(w), int(h)
                if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                    i += 2
                    continue
                seg_len = struct.unpack(">H", data[i + 2:i + 4])[0]
                i += 2 + max(seg_len, 2)
    except Exception:  # noqa: BLE001
        return None
    return None


# ------------------------------------------------------------------ 归一化


async def _fetch_remote(url: str, timeout: float, max_bytes: int) -> bytes:
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as c:
            r = await c.get(url)
            r.raise_for_status()
            data = r.content
    except httpx.HTTPError as e:
        raise ImageInputError(f"下载参考图失败 {url}: {e}") from e
    if len(data) > max_bytes:
        raise ImageInputError(f"参考图超过上限 {max_bytes} 字节: {url}")
    return data


def _check_size(data: bytes, max_bytes: int, what: str) -> None:
    if not data:
        raise ImageInputError(f"参考图为空: {what}")
    if len(data) > max_bytes:
        raise ImageInputError(
            f"参考图 {what} 体积 {len(data):,} 字节，超过上限 {max_bytes:,} 字节"
        )


async def resolve_one(
    item: str,
    *,
    max_bytes: int,
    timeout: float,
) -> ReferenceImage:
    """把单个字符串形式（data URL / http URL / 已有文件名）解析成 ReferenceImage。"""
    if item.startswith("data:"):
        data = parse_data_url(item)
        _check_size(data, max_bytes, "data URL")
        return ReferenceImage(filename=content_name(data), data=data)

    if item.startswith(("http://", "https://")):
        data = await _fetch_remote(item, timeout, max_bytes)
        _check_size(data, max_bytes, item)
        return ReferenceImage(filename=content_name(data), data=data)

    # 其余当作 ComfyUI input 目录里已有的相对路径
    return ReferenceImage(filename=item.rsplit("/", 1)[-1], existing=item)


async def resolve_many(
    items: list[str],
    *,
    max_bytes: int,
    timeout: float,
    limit: int,
) -> list[ReferenceImage]:
    items = [str(i) for i in items if i not in (None, "")]
    if len(items) > limit:
        raise ImageInputError(f"参考图最多 {limit} 张，收到 {len(items)} 张")
    out: list[ReferenceImage] = []
    for it in items:
        out.append(await resolve_one(it, max_bytes=max_bytes, timeout=timeout))
    return out


def from_upload(filename: str, data: bytes, *, max_bytes: int) -> ReferenceImage:
    """multipart 上传的字节 → ReferenceImage（文件名重建为内容哈希，避免重名）。"""
    _check_size(data, max_bytes, filename or "upload")
    return ReferenceImage(filename=content_name(data), data=data)

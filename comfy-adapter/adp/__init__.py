"""comfy-adapter：把本地 ComfyUI 包装成 OpenAI 兼容的图片生成 API。"""

from __future__ import annotations

import sys

__version__ = "0.1.0"


def harden_stdout() -> None:
    """让 stdout/stderr 永不因编码抛异常。

    Windows 下把输出重定向到管道或文件时，Python 会按本地编码（GBK）编码，
    这时打印 emoji（✅ ❌ ⚠️）会抛 UnicodeEncodeError 直接崩掉脚本。

    注意**只放宽 errors，不改 encoding**：
    - 直接输出到控制台时 Python 走 UTF-16 写控制台，emoji 正常显示
    - 重定向时 emoji 退化成 `?`，但中文照常，且不会崩
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            pass

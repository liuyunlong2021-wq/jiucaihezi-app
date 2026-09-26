"""生成结果落盘与清理（response_format=url 时使用）。"""

from __future__ import annotations

import logging
import time
import uuid
from pathlib import Path

log = logging.getLogger("adp.storage")


class ImageStore:
    def __init__(self, static_path: Path, public_base_url: str, ttl: int = 86400) -> None:
        self.root = Path(static_path)
        self.root.mkdir(parents=True, exist_ok=True)
        self.public_base_url = public_base_url.rstrip("/")
        self.ttl = int(ttl or 0)

    def save(self, data: bytes, suffix: str = ".png") -> str:
        name = f"{time.strftime('%Y%m%d')}-{uuid.uuid4().hex[:16]}{suffix}"
        (self.root / name).write_bytes(data)
        return name

    def url_for(self, name: str) -> str:
        return f"{self.public_base_url}/files/{name}"

    def cleanup(self) -> int:
        """删除超过 TTL 的文件，返回删除数量。TTL<=0 时不做任何事。"""
        if self.ttl <= 0:
            return 0
        cutoff = time.time() - self.ttl
        removed = 0
        for p in self.root.glob("*"):
            try:
                if p.is_file() and p.stat().st_mtime < cutoff:
                    p.unlink()
                    removed += 1
            except OSError as e:  # noqa: PERF203
                log.warning("清理文件失败 %s: %s", p, e)
        if removed:
            log.info("已清理 %d 个过期图片", removed)
        return removed

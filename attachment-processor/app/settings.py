"""Settings for the attachment-processor service.

All values can be overridden via environment variables.
"""

from __future__ import annotations

import os

# ── Server ──
HOST: str = os.getenv("HOST", "0.0.0.0")
PORT: int = int(os.getenv("PORT", "8091"))
LOG_LEVEL: str = os.getenv("LOG_LEVEL", "info")

# ── Limits ──
MAX_UPLOAD_MB: int = int(os.getenv("MAX_UPLOAD_MB", "20"))
MAX_UPLOAD_BYTES: int = MAX_UPLOAD_MB * 1024 * 1024
MAX_PDF_PAGES: int = int(os.getenv("MAX_PDF_PAGES", "20"))
MAX_TEXT_CHARS: int = int(os.getenv("MAX_TEXT_CHARS", "500000"))  # ~500KB
SYNC_PARSE_TIMEOUT_S: int = int(os.getenv("SYNC_PARSE_TIMEOUT_S", "120"))

# ── Storage ──
STORAGE_DIR: str = os.getenv("STORAGE_DIR", "/app/storage")
UPLOAD_TTL_HOURS: int = int(os.getenv("UPLOAD_TTL_HOURS", "24"))
PARSED_TTL_DAYS: int = int(os.getenv("PARSED_TTL_DAYS", "7"))

# ── Internal services ──
# 8090 Office/Graphify 服务地址。
# 宿主机直连（非 Docker）: http://127.0.0.1:8090
# Docker 容器内访问宿主机: http://host.docker.internal:8090
OFFICE_GRAPHIFY_BASE_URL: str = os.getenv(
    "OFFICE_GRAPHIFY_BASE_URL", "http://127.0.0.1:8090"
)
OFFICE_TIMEOUT_S: int = int(os.getenv("OFFICE_TIMEOUT_S", "60"))

# ── Auth ──
# 8091 只监听 127.0.0.1，鉴权由 Nginx 在代理层完成。
# Nginx 必须设置 X-Nginx-Proxy 头，8091 仅信任带此头的请求。
# 不要在 Web 前端硬编码任何共享密钥。

# ── PaddleOCR ──
# PaddleOCR model directory for caching
PADDLE_MODEL_DIR: str = os.getenv("PADDLE_MODEL_DIR", "/root/.paddlex")
# Internal PaddleX serving endpoint (if using split deployment)
PADDLEX_SERVING_URL: str = os.getenv("PADDLEX_SERVING_URL", "")
# Use PaddleX Python API directly when no serving URL
PADDLE_USE_LOCAL: bool = os.getenv("PADDLE_USE_LOCAL", "1") == "1"

# ── Allowed extensions ──
TEXT_EXTENSIONS: set[str] = {
    ".txt", ".md", ".csv", ".json", ".xml", ".yaml", ".yml",
    ".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css",
    ".sh", ".bash", ".zsh", ".sql", ".r", ".java", ".go",
    ".rs", ".c", ".cpp", ".h", ".hpp", ".swift", ".kt",
    ".toml", ".ini", ".cfg", ".conf", ".log",
}
IMAGE_EXTENSIONS: set[str] = {
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".tif", ".webp",
}
PDF_EXTENSIONS: set[str] = {".pdf"}
OFFICE_EXTENSIONS: set[str] = {
    ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt",
    ".odt", ".ods", ".odp",
}

# ── MIME sniffing map (extension → MIME) ──
EXT_TO_MIME: dict[str, str] = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".xml": "application/xml",
    ".yaml": "text/yaml",
    ".yml": "text/yaml",
    ".py": "text/x-python",
    ".js": "text/javascript",
    ".ts": "text/typescript",
    ".html": "text/html",
    ".css": "text/css",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".ppt": "application/vnd.ms-powerpoint",
}

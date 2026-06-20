"""attachment-processor — Web 上传资料解析服务

FastAPI service on :8091.
Receives file uploads via /api/attachments/parse, routes to the appropriate
parser (text/PDF/OCR/Office/Graphify), and returns a unified AttachmentDocument.

This is the ONLY public API surface for Web uploaded material parsing.
Internal 8090 Office/Graphify services are called as helpers, not exposed.

=== 鉴权模型 ===
8091 只监听 127.0.0.1，不直接暴露公网。所有请求必须经过 Nginx 代理。
Nginx 负责验证用户登录态（与 /v1/chat/completions 共用同一套 session/auth）。
8091 信任来自 Nginx 的请求，通过 X-Nginx-Proxy 头做基本来源校验。

禁止：
- 公网直连 8091
- 在 Web 前端硬编码共享密钥
"""

from __future__ import annotations

import asyncio
import logging
import mimetypes
import os
import sys
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

from .schemas import AttachmentDocument, HealthResponse, ParseResponse
from .settings import (
    HOST,
    LOG_LEVEL,
    MAX_UPLOAD_BYTES,
    MAX_UPLOAD_MB,
    PORT,
    STORAGE_DIR,
    SYNC_PARSE_TIMEOUT_S,
    TEXT_EXTENSIONS,
    IMAGE_EXTENSIONS,
    PDF_EXTENSIONS,
    OFFICE_EXTENSIONS,
)

# ── Logging ──
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("attachment-processor")


# ── App lifetime ──

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: ensure storage dirs exist. Shutdown: nothing yet."""
    os.makedirs(os.path.join(STORAGE_DIR, "uploads"), exist_ok=True)
    os.makedirs(os.path.join(STORAGE_DIR, "parsed"), exist_ok=True)
    logger.info("attachment-processor starting on %s:%s", HOST, PORT)
    logger.info("max upload: %s MB, storage: %s", MAX_UPLOAD_MB, STORAGE_DIR)
    yield
    logger.info("attachment-processor shutting down")


app = FastAPI(
    title="jc-attachment-processor",
    version="0.1.0",
    lifespan=lifespan,
)

# ── Health ──

@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check with real parser availability detection."""
    parsers = ["text", "pdf-text"]

    # ── Test OCR availability ──
    ocr_available = False
    try:
        from .parsers.paddle_parser import _ocr_instance, _structure_instance
        from .settings import PADDLE_USE_LOCAL, PADDLEX_SERVING_URL
        if PADDLEX_SERVING_URL:
            # Remote serving: try a lightweight ping
            import httpx
            try:
                r = httpx.get(f"{PADDLEX_SERVING_URL}/health", timeout=3)
                ocr_available = r.status_code == 200
            except Exception:
                ocr_available = False
        elif PADDLE_USE_LOCAL:
            # Local: check if paddleocr/paddlex modules are importable
            try:
                import paddleocr  # noqa: F401
                ocr_available = True
            except ImportError:
                pass
            if not ocr_available:
                try:
                    import paddlex  # noqa: F401
                    ocr_available = True
                except ImportError:
                    pass
    except Exception:
        pass

    if ocr_available:
        parsers.extend(["pp-ocr-v6", "pp-structure-v3"])

    # ── Test 8090 Office availability (Graphify module not installed) ──
    try:
        from .parsers.office_client import check_office_health
        if check_office_health():
            parsers.append("office-8090")
    except Exception:
        pass

    return HealthResponse(parsers=parsers)


# ── Main parse endpoint ──

@app.post("/api/attachments/parse", response_model=ParseResponse)
async def parse_attachment(
    request: Request,
    file: UploadFile = File(...),
    mode: str = Form(default="auto"),
):
    """Parse an uploaded file and return AttachmentDocument.

    Auth model (current implementation):
      Nginx terminates TLS, forwards Authorization/x-api-key headers,
      and hardcodes X-Nginx-Proxy "true" (external clients cannot forge).
      Nginx does NOT independently validate the token — it only forwards.
      
      8091 checks:
        1. X-Nginx-Proxy present → proves request came through Nginx
        2. Authorization header is a well-formed Bearer token (format only)
      
      ⚠️ Token validity (expiry, signature, user identity) is NOT verified
      against NewAPI in the current implementation. This means any caller
      with a plausible-looking Bearer token can reach the parse endpoint.
      For production hardening, add Nginx auth_request or validate the
      token against NewAPI's /v1/models endpoint before parsing.
    """
    t_start = time.monotonic()

    # ── Auth: must come through Nginx with a plausible token ──
    if not request.headers.get("X-Nginx-Proxy"):
        raise HTTPException(status_code=403, detail="Direct access not allowed")
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer ") or len(auth_header) < 20:
        raise HTTPException(status_code=401, detail="Valid Authorization required")

    # ── Validate file presence ──
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    original_name = file.filename
    logger.info("parse request: name=%s mode=%s", original_name, mode)

    # ── Read file into memory (size-limited) ──
    content = await file.read()
    size_bytes = len(content)

    if size_bytes == 0:
        return ParseResponse(ok=False, error="文件为空")

    if size_bytes > MAX_UPLOAD_BYTES:
        return ParseResponse(ok=False, error=f"文件过大 (>{MAX_UPLOAD_MB}MB)")

    # ── Detect MIME type ──
    mime_type, _ = mimetypes.guess_type(original_name)
    if not mime_type:
        mime_type = _sniff_mime(content, original_name)

    # ── Save to temp storage ──
    ext = Path(original_name).suffix.lower()
    tmp_name = f"{uuid.uuid4().hex}{ext}"
    tmp_path = Path(STORAGE_DIR) / "uploads" / tmp_name
    tmp_path.write_bytes(content)

    try:
        # ── Route to parser with timeout ──
        doc = await asyncio.wait_for(
            asyncio.to_thread(_route_parse, str(tmp_path), original_name, mime_type, mode, size_bytes),
            timeout=SYNC_PARSE_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        logger.warning("parse timeout: %s (limit=%ss)", original_name, SYNC_PARSE_TIMEOUT_S)
        doc = _error_document(
            original_name, mime_type, size_bytes,
            "unsupported", "PARSE_TIMEOUT",
            f"解析超时 ({SYNC_PARSE_TIMEOUT_S}s)，文件可能过大或格式复杂",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("parse failed: %s", original_name)
        doc = _error_document(
            original_name, mime_type, size_bytes,
            "unsupported", "INTERNAL_ERROR",
            f"解析服务内部错误: {_sanitize_error(e)}",
        )
    finally:
        try:
            tmp_path.unlink()
        except Exception:
            pass

    elapsed_ms = int((time.monotonic() - t_start) * 1000)
    logger.info(
        "parse done: name=%s parser=%s status=%s elapsed=%sms",
        original_name, doc.parser, doc.status, elapsed_ms,
    )

    return ParseResponse(ok=doc.status != "error", document=doc)


# ── Parser routing ──

def _route_parse(
    file_path: str, original_name: str, mime_type: str,
    mode: str, size_bytes: int,
) -> AttachmentDocument:
    """Route to the appropriate parser based on file type and mode."""
    ext = Path(original_name).suffix.lower()

    # ── Mode override ──
    if mode == "text":
        from .parsers.text_parser import parse_text
        return parse_text(file_path, original_name, mime_type)
    if mode == "ocr":
        from .parsers.paddle_parser import parse_image_ocr
        return parse_image_ocr(file_path, original_name, mime_type)
    if mode == "structure":
        from .parsers.paddle_parser import parse_image_structure
        return parse_image_structure(file_path, original_name, mime_type)
    if mode == "office":
        from .parsers.office_client import parse_office
        return parse_office(file_path, original_name, mime_type)

    # ── Auto routing ──
    # 1. Text files
    if ext in TEXT_EXTENSIONS:
        from .parsers.text_parser import parse_text
        return parse_text(file_path, original_name, mime_type)

    # 2. Images -> OCR
    if ext in IMAGE_EXTENSIONS:
        from .parsers.paddle_parser import parse_image_ocr
        return parse_image_ocr(file_path, original_name, mime_type)

    # 3. PDF
    if ext in PDF_EXTENSIONS:
        from .parsers.pdf_parser import parse_pdf
        doc = parse_pdf(file_path, original_name, mime_type)

        # If all pages are scanned, try OCR path
        has_all_scanned = any(
            w.code == "all_scanned" for w in doc.warnings
        )
        if has_all_scanned:
            try:
                from .parsers.paddle_parser import parse_image_structure
                from .parsers.pdf_parser import parse_scanned_pdf_via_images

                def ocr_page(img_path: str, page_num: int):
                    result = parse_image_structure(img_path, f"page_{page_num}.png", "image/png")
                    blocks = result.blocks
                    warnings = result.warnings
                    md = f"## 第 {page_num} 页 (OCR)\n\n{result.markdown}"
                    return md, blocks, warnings

                return parse_scanned_pdf_via_images(
                    file_path, original_name, mime_type, ocr_page,
                )
            except Exception:
                # Return the pdf-text result with warnings
                pass
        return doc

    # 4. Office → 8090 internal helper
    if ext in OFFICE_EXTENSIONS:
        try:
            from .parsers.office_client import parse_office
            return parse_office(file_path, original_name, mime_type)
        except Exception:
            # Fall through to unsupported
            pass

    # 5. Unsupported
    return _error_document(
        original_name, mime_type, size_bytes,
        "unsupported", "UNSUPPORTED_FORMAT",
        f"不支持的文件格式: {ext}。支持的格式: 文本、图片、PDF、Office 文档",
    )


# ── Helpers ──

def _sniff_mime(content: bytes, filename: str) -> str:
    """Basic MIME sniffing from magic bytes."""
    if not content:
        return "application/octet-stream"
    if content.startswith(b"\x89PNG"):
        return "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if content.startswith(b"GIF8"):
        return "image/gif"
    if content.startswith(b"%PDF"):
        return "application/pdf"
    if content.startswith(b"PK\x03\x04"):
        # ZIP-based: could be docx, xlsx, pptx, or actual zip
        ext = Path(filename).suffix.lower()
        if ext in OFFICE_EXTENSIONS:
            from .settings import EXT_TO_MIME
            return EXT_TO_MIME.get(ext, "application/zip")
        return "application/zip"
    return "application/octet-stream"


def _error_document(
    name: str, mime: str, size: int,
    parser: str, code: str, message: str,
) -> AttachmentDocument:
    from .schemas import AttachmentUsage
    return AttachmentDocument(
        id=f"att_{uuid.uuid4().hex[:12]}",
        source_name=name,
        mime_type=mime,
        size_bytes=size,
        parser=parser,  # type: ignore[arg-type]
        status="error",
        error_code=code,
        error_message=message,
        usage=AttachmentUsage(elapsed_ms=0),
    )


def _sanitize_error(e: Exception) -> str:
    msg = str(e)
    if len(msg) > 300:
        msg = msg[:300] + "..."
    return msg


# ── Run ──

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=True)

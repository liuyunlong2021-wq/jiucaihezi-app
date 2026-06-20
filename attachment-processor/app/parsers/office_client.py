"""Internal client for the existing 8090 Office service.

Verified 8090 API (2026-06-20):
  GET  /api/health       → {status, checks: {libreoffice, pypdf, ...}}
  POST /api/office/read  → {status, format, paragraphs[], tables[],
                             paragraph_count, table_count}
  POST /api/office/convert → returns PDF download URL only (not used)

Strategy: use /api/office/read to extract text from Office documents.
8091 normalizes the paragraphs/tables into AttachmentDocument markdown.
"""

from __future__ import annotations

import time
import uuid
from pathlib import Path

import httpx

from ..schemas import (
    AttachmentBlock,
    AttachmentDocument,
    AttachmentUsage,
    AttachmentWarning,
)
from ..settings import OFFICE_GRAPHIFY_BASE_URL, OFFICE_TIMEOUT_S


def parse_office(file_path: str, original_name: str, mime_type: str) -> AttachmentDocument:
    """Read Office document text via 8090 /api/office/read."""
    t0 = time.monotonic()
    doc_id = f"att_{uuid.uuid4().hex[:12]}"
    path = Path(file_path)
    size_bytes = path.stat().st_size

    try:
        with open(file_path, "rb") as f:
            files = {"file": (original_name, f, mime_type)}
            with httpx.Client(timeout=OFFICE_TIMEOUT_S) as client:
                resp = client.post(
                    f"{OFFICE_GRAPHIFY_BASE_URL}/api/office/read",
                    files=files,
                )
                resp.raise_for_status()
                data = resp.json()
    except httpx.ConnectError:
        return _error_doc(doc_id, original_name, mime_type, size_bytes,
            "office-8090", "OFFICE_SERVICE_UNREACHABLE", "Office 服务 (8090) 不可达")
    except httpx.TimeoutException:
        return _error_doc(doc_id, original_name, mime_type, size_bytes,
            "office-8090", "OFFICE_SERVICE_TIMEOUT", f"Office 读取超时 ({OFFICE_TIMEOUT_S}s)")
    except Exception as e:
        return _error_doc(doc_id, original_name, mime_type, size_bytes,
            "office-8090", "OFFICE_READ_ERROR", f"Office 读取失败: {_sanitize_error(e)}")

    if data.get("status") == "error":
        return _error_doc(doc_id, original_name, mime_type, size_bytes,
            "office-8090", "OFFICE_READ_ERROR",
            f"Office 读取失败: {data.get('error', '未知错误')}")

    markdown_parts: list[str] = []
    paragraphs = data.get("paragraphs", [])
    tables = data.get("tables", [])

    if paragraphs:
        for p in paragraphs:
            text = str(p).strip()
            if text:
                markdown_parts.append(text)
                markdown_parts.append("")

    if tables:
        for ti, table in enumerate(tables):
            markdown_parts.append(f"### 表格 {ti + 1}")
            if isinstance(table, list):
                for row in table:
                    if isinstance(row, list):
                        markdown_parts.append("| " + " | ".join(str(c) for c in row) + " |")
                    else:
                        markdown_parts.append(str(row))
            markdown_parts.append("")

    markdown = "\n".join(markdown_parts).strip()
    if not markdown:
        return _error_doc(doc_id, original_name, mime_type, size_bytes,
            "office-8090", "EMPTY_RESULT",
            f"Office 读取返回空内容 (format={data.get('format', 'unknown')})")

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    return AttachmentDocument(
        id=doc_id, source_name=original_name, mime_type=mime_type,
        size_bytes=size_bytes, parser="office-8090", status="success",
        markdown=markdown,
        blocks=[AttachmentBlock(id=f"{doc_id}_b0", type="paragraph",
            text=markdown[:2000], markdown=markdown, page=1)],
        warnings=[],
        usage=AttachmentUsage(
            page_count=data.get("paragraph_count", len(paragraphs)),
            token_estimate=len(markdown) // 3, elapsed_ms=elapsed_ms),
    )


def check_office_health() -> bool:
    """Check if the 8090 Office service is reachable and healthy."""
    try:
        with httpx.Client(timeout=5) as client:
            resp = client.get(f"{OFFICE_GRAPHIFY_BASE_URL}/api/health")
            if resp.status_code != 200:
                return False
            return resp.json().get("status") == "ok"
    except Exception:
        return False


def _error_doc(doc_id, name, mime, size, parser, code, message):
    return AttachmentDocument(
        id=doc_id, source_name=name, mime_type=mime, size_bytes=size,
        parser=parser, status="error", error_code=code, error_message=message,
        usage=AttachmentUsage(elapsed_ms=0))


def _sanitize_error(e: Exception) -> str:
    msg = str(e)
    return msg[:300] + "..." if len(msg) > 300 else msg

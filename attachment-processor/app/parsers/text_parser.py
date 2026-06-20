"""Text file parser — simplest route.

Handles: .txt, .md, .csv, .json, .xml, .yaml, code files, etc.
Just reads the file as UTF-8 text and wraps it in AttachmentDocument.
"""

from __future__ import annotations

import time
import uuid
from pathlib import Path

from ..schemas import (
    AttachmentBlock,
    AttachmentDocument,
    AttachmentUsage,
    AttachmentWarning,
)
from ..settings import MAX_TEXT_CHARS


def parse_text(file_path: str, original_name: str, mime_type: str) -> AttachmentDocument:
    """Read a text file and produce an AttachmentDocument.

    Args:
        file_path: Path to the temporary uploaded file.
        original_name: Original filename from the client.
        mime_type: Detected MIME type.

    Returns:
        AttachmentDocument with the file content as Markdown.
    """
    t0 = time.monotonic()
    doc_id = f"att_{uuid.uuid4().hex[:12]}"
    path = Path(file_path)
    size_bytes = path.stat().st_size

    warnings: list[AttachmentWarning] = []
    blocks: list[AttachmentBlock] = []

    try:
        raw = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        # Try latin-1 as fallback
        try:
            raw = path.read_text(encoding="latin-1")
            warnings.append(AttachmentWarning(
                code="fallback_encoding",
                message="文件非 UTF-8 编码，已用 latin-1 降级读取",
            ))
        except Exception:
            return _error_doc(
                doc_id, original_name, mime_type, size_bytes,
                "text", "UNREADABLE", "无法读取文件内容，可能为二进制文件",
            )

    truncated = False
    if len(raw) > MAX_TEXT_CHARS:
        raw = raw[:MAX_TEXT_CHARS]
        truncated = True
        warnings.append(AttachmentWarning(
            code="content_truncated",
            message=f"文件过大，已截断至 {MAX_TEXT_CHARS} 字符",
        ))

    # Detect if it's already markdown-like
    ext = Path(original_name).suffix.lower()
    if ext in (".md", ".markdown"):
        markdown = raw
    else:
        # Wrap non-markdown text in a code block with language hint
        lang = _ext_to_lang(ext)
        markdown = f"```{lang}\n{raw}\n```"

    blocks.append(AttachmentBlock(
        id=f"{doc_id}_b0",
        type="paragraph",
        text=raw[:2000],
        markdown=markdown,
        page=1,
    ))

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    token_estimate = len(raw) // 3  # rough: ~3 chars per token

    return AttachmentDocument(
        id=doc_id,
        source_name=original_name,
        mime_type=mime_type,
        size_bytes=size_bytes,
        parser="text",
        status="success",
        markdown=markdown,
        blocks=blocks,
        warnings=warnings,
        usage=AttachmentUsage(
            page_count=1,
            token_estimate=token_estimate,
            elapsed_ms=elapsed_ms,
        ),
    )


def _ext_to_lang(ext: str) -> str:
    """Map file extension to highlight.js language identifier."""
    mapping: dict[str, str] = {
        ".py": "python",
        ".js": "javascript",
        ".ts": "typescript",
        ".jsx": "jsx",
        ".tsx": "tsx",
        ".json": "json",
        ".xml": "xml",
        ".html": "html",
        ".css": "css",
        ".yaml": "yaml",
        ".yml": "yaml",
        ".sh": "bash",
        ".bash": "bash",
        ".zsh": "bash",
        ".sql": "sql",
        ".r": "r",
        ".java": "java",
        ".go": "go",
        ".rs": "rust",
        ".c": "c",
        ".cpp": "cpp",
        ".h": "c",
        ".swift": "swift",
        ".kt": "kotlin",
        ".toml": "toml",
        ".ini": "ini",
        ".cfg": "ini",
    }
    return mapping.get(ext, "")


def _error_doc(
    doc_id: str, name: str, mime: str, size: int,
    parser: str, code: str, message: str,
) -> AttachmentDocument:
    return AttachmentDocument(
        id=doc_id,
        source_name=name,
        mime_type=mime,
        size_bytes=size,
        parser=parser,  # type: ignore[arg-type]
        status="error",
        error_code=code,
        error_message=message,
        usage=AttachmentUsage(elapsed_ms=0),
    )

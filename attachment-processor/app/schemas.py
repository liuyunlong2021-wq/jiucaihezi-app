"""AttachmentDocument — unified contract for all parser outputs.

Every parser (text, PDF, OCR, Office, Graphify) must return this shape.
The Web frontend and LLM context injection depend on this contract.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal
from pydantic import BaseModel, Field


# ── Block types ──

class AttachmentBlock(BaseModel):
    """A parsed content block with optional page/bbox provenance."""
    id: str = Field(..., description="Unique block ID within the document")
    type: Literal[
        "heading", "paragraph", "table", "formula",
        "figure", "caption", "list", "code", "metadata",
    ] = Field(..., description="Block structural type")
    text: str = Field(default="", description="Plain text content")
    markdown: str = Field(default="", description="Markdown content if richer than text")
    page: int | None = Field(default=None, description="1-indexed page number")
    bbox: tuple[float, float, float, float] | None = Field(
        default=None, description="[x1, y1, x2, y2] bounding box"
    )
    confidence: float | None = Field(
        default=None, ge=0.0, le=1.0, description="Parser confidence score"
    )


class AttachmentWarning(BaseModel):
    """Non-fatal warning about a specific part of the parsed document."""
    code: str = Field(..., description="Machine-readable warning code")
    message: str = Field(..., description="Human-readable warning message")
    page: int | None = Field(default=None, description="Related page if applicable")


class AttachmentUsage(BaseModel):
    """Parse metadata for observability."""
    page_count: int = Field(default=0)
    image_count: int = Field(default=0)
    token_estimate: int = Field(default=0)
    elapsed_ms: int = Field(default=0)


# ── Main document ──

ParserName = Literal[
    "text", "pdf-text", "pp-ocr-v6", "pp-ocr-v6-small", "pp-structure-v3",
    "office-8090", "graphify-8090", "unsupported",
]

ParseStatus = Literal["success", "partial", "error"]


class AttachmentDocument(BaseModel):
    """Unified parsed-document shape returned by all parser routes.

    This is the ONLY structure the Web frontend should receive from
    POST /api/attachments/parse.
    """
    id: str = Field(..., description="Unique attachment ID (att_<uuid>)")
    source_name: str = Field(..., description="Original filename")
    mime_type: str = Field(..., description="Detected MIME type")
    size_bytes: int = Field(..., description="Original file size in bytes")
    parser: ParserName = Field(..., description="Which parser produced this result")
    status: ParseStatus = Field(
        default="success",
        description="success: fully parsed | partial: parsed with warnings | error: could not parse",
    )
    markdown: str = Field(
        default="",
        description="LLM-optimized Markdown content. Empty on error status.",
    )
    blocks: list[AttachmentBlock] = Field(
        default_factory=list,
        description="Structured blocks with page/bbox provenance",
    )
    warnings: list[AttachmentWarning] = Field(
        default_factory=list,
        description="Non-fatal parser warnings",
    )
    usage: AttachmentUsage = Field(
        default_factory=AttachmentUsage,
        description="Parse metadata",
    )
    expires_at: str = Field(
        default_factory=lambda: (
            datetime.now(timezone.utc) + timedelta(days=7)
        ).isoformat(),
        description="ISO-8601 expiry timestamp",
    )
    error_code: str = Field(
        default="",
        description="Machine-readable error code when status=error",
    )
    error_message: str = Field(
        default="",
        description="Human-readable error message when status=error",
    )


# ── API request / response ──

class ParseResponse(BaseModel):
    """Wrapper for the parse endpoint response."""
    ok: bool = Field(default=True)
    document: AttachmentDocument | None = Field(default=None)
    error: str = Field(default="")


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = "0.1.0"
    parsers: list[str] = Field(default_factory=list)

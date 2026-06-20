"""PDF parser — extracts text layer, falls back to OCR placeholder.

Strategy:
1. Try pdfplumber for text extraction (fast, no OCR).
2. If page has no text, mark it as scanned (needs OCR path).
3. Return page-labeled Markdown with warnings for scanned pages.

In the first implementation, scanned pages are reported in warnings.
OCR for scanned PDFs is handled by paddle_parser.py via convert-to-images step.
"""

from __future__ import annotations

import io
import time
import uuid
from pathlib import Path

from ..schemas import (
    AttachmentBlock,
    AttachmentDocument,
    AttachmentUsage,
    AttachmentWarning,
)
from ..settings import MAX_PDF_PAGES


def parse_pdf(file_path: str, original_name: str, mime_type: str) -> AttachmentDocument:
    """Extract text from PDF, with warnings for scanned/image-only pages.

    Args:
        file_path: Path to the temporary uploaded PDF file.
        original_name: Original filename.
        mime_type: Should be application/pdf.

    Returns:
        AttachmentDocument with page-labeled Markdown.
    """
    t0 = time.monotonic()
    doc_id = f"att_{uuid.uuid4().hex[:12]}"
    path = Path(file_path)
    size_bytes = path.stat().st_size

    try:
        import pdfplumber
    except ImportError:
        return _error_doc(
            doc_id, original_name, mime_type, size_bytes,
            "pdf-text", "PDFPLUMBER_MISSING",
            "PDF 解析库未安装，请联系管理员安装 pdfplumber",
        )

    warnings: list[AttachmentWarning] = []
    blocks: list[AttachmentBlock] = []
    markdown_parts: list[str] = []
    scanned_pages: list[int] = []
    total_pages = 0

    try:
        with pdfplumber.open(path) as pdf:
            total_pages = len(pdf.pages)
            pages_to_process = min(total_pages, MAX_PDF_PAGES)

            if total_pages > MAX_PDF_PAGES:
                warnings.append(AttachmentWarning(
                    code="pages_truncated",
                    message=f"PDF 共 {total_pages} 页，仅处理前 {MAX_PDF_PAGES} 页",
                ))

            for i, page in enumerate(pdf.pages[:pages_to_process]):
                page_num = i + 1
                text = page.extract_text()

                if text and text.strip():
                    # Has text layer
                    markdown_parts.append(f"## 第 {page_num} 页\n\n{text.strip()}")
                    blocks.append(AttachmentBlock(
                        id=f"{doc_id}_p{page_num}",
                        type="paragraph",
                        text=text.strip()[:2000],
                        markdown=text.strip(),
                        page=page_num,
                    ))
                else:
                    # Scanned / image-only page
                    scanned_pages.append(page_num)
                    markdown_parts.append(
                        f"## 第 {page_num} 页\n\n"
                        f"[此页为扫描图片，需 OCR 识别]"
                    )
                    warnings.append(AttachmentWarning(
                        code="scanned_page",
                        message=f"第 {page_num} 页无文字层，需 OCR 识别",
                        page=page_num,
                    ))
    except Exception as e:
        # Maybe encrypted or corrupted
        return _error_doc(
            doc_id, original_name, mime_type, size_bytes,
            "pdf-text", "PDF_PARSE_ERROR",
            f"无法解析 PDF 文件: {_sanitize_error(e)}",
        )

    markdown = "\n\n".join(markdown_parts) if markdown_parts else ""
    status = "partial" if scanned_pages else "success"

    # If ALL pages are scanned, mark as partial with strong hint
    if scanned_pages and len(scanned_pages) == pages_to_process:
        warnings.insert(0, AttachmentWarning(
            code="all_scanned",
            message="此 PDF 全部为扫描图片，建议使用 OCR 解析",
        ))

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    token_estimate = len(markdown) // 3

    return AttachmentDocument(
        id=doc_id,
        source_name=original_name,
        mime_type=mime_type,
        size_bytes=size_bytes,
        parser="pdf-text",
        status=status,  # type: ignore[arg-type]
        markdown=markdown,
        blocks=blocks,
        warnings=warnings,
        usage=AttachmentUsage(
            page_count=total_pages,
            token_estimate=token_estimate,
            elapsed_ms=elapsed_ms,
        ),
    )


def parse_scanned_pdf_via_images(
    file_path: str, original_name: str, mime_type: str,
    ocr_func,
) -> AttachmentDocument:
    """Convert PDF pages to images, then run OCR on each page.

    This is a bridge function — it converts PDF pages to PNG images,
    then delegates to the PaddleOCR parser for each page.

    Args:
        file_path: Path to the PDF file.
        original_name: Original filename.
        mime_type: application/pdf.
        ocr_func: Callable (image_path, page_num) -> (markdown, blocks, warnings).
    """
    t0 = time.monotonic()
    doc_id = f"att_{uuid.uuid4().hex[:12]}"
    path = Path(file_path)
    size_bytes = path.stat().st_size

    try:
        import pdfplumber
    except ImportError:
        return _error_doc(
            doc_id, original_name, mime_type, size_bytes,
            "pp-structure-v3", "PDFPLUMBER_MISSING",
            "PDF 解析库未安装",
        )

    all_warnings: list[AttachmentWarning] = []
    all_blocks: list[AttachmentBlock] = []
    markdown_parts: list[str] = []
    total_images = 0

    try:
        from PIL import Image

        with pdfplumber.open(path) as pdf:
            total_pages = len(pdf.pages)
            pages_to_process = min(total_pages, MAX_PDF_PAGES)

            if total_pages > MAX_PDF_PAGES:
                all_warnings.append(AttachmentWarning(
                    code="pages_truncated",
                    message=f"PDF 共 {total_pages} 页，仅处理前 {MAX_PDF_PAGES} 页",
                ))

            for i, page in enumerate(pdf.pages[:pages_to_process]):
                page_num = i + 1
                # Render page to image
                img = page.to_image(resolution=200)
                img_bytes = io.BytesIO()
                img.save(img_bytes, format="PNG")
                img_bytes.seek(0)

                # Save temp image
                tmp_img = path.parent / f"_pdf_page_{page_num}.png"
                tmp_img.write_bytes(img_bytes.read())

                try:
                    md, blks, warns = ocr_func(str(tmp_img), page_num)
                    markdown_parts.append(md)
                    all_blocks.extend(blks)
                    all_warnings.extend(warns)
                    total_images += 1
                finally:
                    # Clean up temp image
                    if tmp_img.exists():
                        tmp_img.unlink()

    except Exception as e:
        return _error_doc(
            doc_id, original_name, mime_type, size_bytes,
            "pp-structure-v3", "PDF_OCR_ERROR",
            f"PDF OCR 处理失败: {_sanitize_error(e)}",
        )

    markdown = "\n\n".join(markdown_parts)
    elapsed_ms = int((time.monotonic() - t0) * 1000)
    token_estimate = len(markdown) // 3

    return AttachmentDocument(
        id=doc_id,
        source_name=original_name,
        mime_type=mime_type,
        size_bytes=size_bytes,
        parser="pp-structure-v3",
        status="partial" if all_warnings else "success",
        markdown=markdown,
        blocks=all_blocks,
        warnings=all_warnings,
        usage=AttachmentUsage(
            page_count=total_pages if 'total_pages' in dir() else 0,
            image_count=total_images,
            token_estimate=token_estimate,
            elapsed_ms=elapsed_ms,
        ),
    )


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


def _sanitize_error(e: Exception) -> str:
    """Keep error messages safe for client return."""
    msg = str(e)
    if len(msg) > 300:
        msg = msg[:300] + "..."
    return msg

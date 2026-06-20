from __future__ import annotations

import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from ..schemas import AttachmentBlock, AttachmentDocument, AttachmentUsage, AttachmentWarning

_ocr_lock = threading.Lock()
_parse_lock = threading.Lock()
_ocr = None

MAX_OCR_SIDE = int(os.getenv("OCR_MAX_SIDE", "2000"))
DET_MODEL = os.getenv("PADDLE_OCR_DET_MODEL", "PP-OCRv6_small_det")
REC_MODEL = os.getenv("PADDLE_OCR_REC_MODEL", "PP-OCRv6_small_rec")


def _get_ocr():
    global _ocr
    if _ocr is not None:
        return _ocr

    with _ocr_lock:
        if _ocr is not None:
            return _ocr

        from paddleocr import PaddleOCR

        try:
            print(f"[JC OCR] loading {DET_MODEL} + {REC_MODEL}", flush=True)
            _ocr = PaddleOCR(
                lang="ch",
                text_detection_model_name=DET_MODEL,
                text_recognition_model_name=REC_MODEL,
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
            )
        except Exception as e:
            # Fallback to the mature mobile pair if the deployed PaddleOCR build
            # cannot resolve PP-OCRv6 small model names yet.
            print(f"[JC OCR] small model failed: {e}; fallback to PP-OCRv5_mobile", flush=True)
            _ocr = PaddleOCR(
                lang="ch",
                text_detection_model_name="PP-OCRv5_mobile_det",
                text_recognition_model_name="PP-OCRv5_mobile_rec",
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
            )
        return _ocr


def _prepare_image(file_path: str) -> str:
    """Resize huge user photos before OCR. Returns path to OCR input."""
    from PIL import Image, ImageOps

    src = Path(file_path)
    out = src.with_suffix(src.suffix + ".ocr.png")

    with Image.open(src) as img:
        img = ImageOps.exif_transpose(img)
        img.thumbnail((MAX_OCR_SIDE, MAX_OCR_SIDE))
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        img.save(out, format="PNG", optimize=True)

    return str(out)


def _plain(v: Any):
    if v is None:
        return None
    if hasattr(v, "tolist"):
        return v.tolist()
    if isinstance(v, tuple):
        return [_plain(x) for x in v]
    if isinstance(v, list):
        return [_plain(x) for x in v]
    return v


def _as_list(v: Any) -> list:
    v = _plain(v)
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def _res(item: Any) -> dict:
    if isinstance(item, dict):
        r = item.get("res")
        return r if isinstance(r, dict) else item
    j = getattr(item, "json", None)
    if isinstance(j, dict):
        r = j.get("res")
        return r if isinstance(r, dict) else j
    r = getattr(item, "res", None)
    return r if isinstance(r, dict) else {}


def _score(v: Any):
    try:
        x = float(v)
        return max(0.0, min(1.0, x))
    except Exception:
        return None


def _bbox(v: Any):
    v = _plain(v)
    try:
        if isinstance(v, list) and len(v) >= 4 and all(isinstance(x, (int, float)) for x in v[:4]):
            return (float(v[0]), float(v[1]), float(v[2]), float(v[3]))
        pts = [p for p in v if isinstance(p, list) and len(p) >= 2]
        xs = [float(p[0]) for p in pts]
        ys = [float(p[1]) for p in pts]
        return (min(xs), min(ys), max(xs), max(ys))
    except Exception:
        return None


def _error_doc(doc_id, name, mime, size, parser, code, message):
    return AttachmentDocument(
        id=doc_id,
        source_name=name,
        mime_type=mime,
        size_bytes=size,
        parser=parser,
        status="error",
        error_code=code,
        error_message=str(message)[:300],
        usage=AttachmentUsage(elapsed_ms=0),
    )


def parse_image_ocr(file_path: str, original_name: str, mime_type: str) -> AttachmentDocument:
    t0 = time.monotonic()
    doc_id = f"att_{uuid.uuid4().hex[:12]}"
    size_bytes = Path(file_path).stat().st_size
    ocr_input = ""

    try:
        # Single queue: avoid concurrent OCR jobs pushing NewAPI over its CPU guard.
        with _parse_lock:
            ocr_input = _prepare_image(file_path)
            raw = _get_ocr().predict(ocr_input)

        entries = []
        for page_i, item in enumerate(list(raw) if raw is not None else []):
            res = _res(item)
            texts = _as_list(res.get("rec_texts"))
            scores = _as_list(res.get("rec_scores"))
            polys = _as_list(res.get("rec_polys"))
            boxes = _as_list(res.get("rec_boxes"))

            for i, t in enumerate(texts):
                text = str(t).strip()
                if not text:
                    continue
                pos = polys[i] if i < len(polys) else (boxes[i] if i < len(boxes) else None)
                conf = scores[i] if i < len(scores) else None
                entries.append((text, _score(conf), _bbox(pos), page_i + 1))

        blocks = []
        lines = []
        for i, (text, conf, bbox, page) in enumerate(entries):
            lines.append(text)
            blocks.append(AttachmentBlock(
                id=f"{doc_id}_b{i}",
                type="paragraph",
                text=text,
                markdown=text,
                page=page,
                bbox=bbox,
                confidence=conf,
            ))

        markdown = "\n\n".join(lines)
        warnings = []
        if not markdown:
            warnings.append(AttachmentWarning(code="no_text_detected", message="图片中未检测到文字"))

        elapsed_ms = int((time.monotonic() - t0) * 1000)
        return AttachmentDocument(
            id=doc_id,
            source_name=original_name,
            mime_type=mime_type,
            size_bytes=size_bytes,
            parser="pp-ocr-v6-small",
            status="success" if markdown else "partial",
            markdown=markdown,
            blocks=blocks,
            warnings=warnings,
            usage=AttachmentUsage(image_count=1, token_estimate=len(markdown) // 3, elapsed_ms=elapsed_ms),
        )
    except Exception as e:
        return _error_doc(doc_id, original_name, mime_type, size_bytes, "pp-ocr-v6-small", "OCR_RUNTIME_ERROR", f"OCR 运行时错误: {e}")
    finally:
        if ocr_input:
            try:
                Path(ocr_input).unlink(missing_ok=True)
            except Exception:
                pass


def parse_image_structure(file_path: str, original_name: str, mime_type: str) -> AttachmentDocument:
    return parse_image_ocr(file_path, original_name, mime_type)

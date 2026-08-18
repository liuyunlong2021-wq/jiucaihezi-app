"""Build RunningHub standard OpenAPI payloads from official capabilities."""

from __future__ import annotations

import base64
import binascii
from typing import Any

import httpx

from ..models.capabilities import get_official_capability
from .rh_client import RHError, maybe_upload


GEMINI_OMNI_FIXED_PARAMS: dict[str, dict[str, str]] = {
    "gemini-omni-flash/text-to-video": {"duration": "10", "resolution": "1080p"},
    "gemini-omni-flash/image-to-video": {"duration": "10", "resolution": "1080p"},
    "gemini-omni-flash/video-edit": {"resolution": "1080p"},
}


def _value_present(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        s = value.strip().lower()
        return s != "" and s != "empty"
    if isinstance(value, list):
        return len(value) > 0
    return True


def _coerce_scalar(value: Any, param_type: str) -> Any:
    if param_type == "BOOLEAN":
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in ("true", "1", "yes", "y", "on")
    if param_type == "INT":
        try:
            return int(value)
        except (TypeError, ValueError):
            return value
    if param_type == "FLOAT":
        try:
            return float(value)
        except (TypeError, ValueError):
            return value
    if param_type == "LIST":
        return str(value)
    return value


def _validate_option(key: str, value: Any, options: list[Any] | None) -> None:
    if not options:
        return
    allowed = {str(option) for option in options}
    if str(value) not in allowed:
        raise RHError(
            f"Invalid RunningHub parameter {key}={value}; allowed: {', '.join(str(option) for option in options)}",
            code=400,
        )


def _validate_media_size(key: str, value: Any, max_size_mb: Any) -> None:
    if max_size_mb is None:
        return
    limit = int(float(max_size_mb) * 1024 * 1024)
    for item in value if isinstance(value, list) else [value]:
        if not isinstance(item, str) or not item.startswith('data:') or ',' not in item:
            continue
        try:
            raw = base64.b64decode(item.split(',', 1)[1], validate=True)
        except (ValueError, binascii.Error) as exc:
            raise RHError(f"Invalid media value for {key}", code=400) from exc
        if len(raw) > limit:
            raise RHError(f"Invalid RunningHub parameter {key}: maximum size {max_size_mb}MB", code=413)


def _input_aliases(key: str, param_type: str) -> list[str]:
    aliases = [key]
    if key == "aspectRatio":
        aliases.extend(["ratio", "aspect_ratio"])
    elif key == "ratio":
        aliases.extend(["aspectRatio", "aspect_ratio"])
    elif key == "prompt":
        aliases.extend(["textPrompt"])
    elif key == "text":
        aliases.extend(["prompt"])
    elif param_type == "IMAGE":
        aliases.extend(["images", "image"])
    elif param_type == "VIDEO":
        aliases.extend(["videos", "video"])
    elif param_type == "AUDIO":
        aliases.extend(["audios", "audio"])
    return aliases


def _first_present(inputs: dict[str, Any], aliases: list[str]) -> Any:
    for alias in aliases:
        value = inputs.get(alias)
        if _value_present(value):
            return value
    return None


def _media_value_for_key(inputs: dict[str, Any], key: str, param_type: str) -> Any:
    """Resolve media inputs for official param keys without inventing payload keys.

    Returns None when no media value can be resolved — caller (build_standard_payload)
    will then either apply a default or raise for required params.
    """
    key_lower = key.lower()
    if param_type == "IMAGE":
        images = inputs.get("images")
        image_list: list[Any] = []
        if isinstance(images, list):
            image_list = [item for item in images if _value_present(item)]
        elif _value_present(images):
            image_list = [images]
        single_image = inputs.get("image") if _value_present(inputs.get("image")) else None
        hunyuan_view_index = {
            "imageurl": 0,
            "leftimageurl": 1,
            "rightimageurl": 2,
            "backimageurl": 3,
            "topimageurl": 4,
            "bottomimageurl": 5,
            "leftfrontimageurl": 6,
            "rightfrontimageurl": 7,
        }.get(key_lower)
        if hunyuan_view_index is not None:
            return image_list[hunyuan_view_index] if len(image_list) > hunyuan_view_index else inputs.get(key)
        if key_lower in ("lastframeurl", "lastimageurl"):
            return image_list[1] if len(image_list) > 1 else inputs.get(key)
        if key_lower in ("firstframeurl", "firstimageurl", "imageurl"):
            return image_list[0] if image_list else single_image or inputs.get(key)
        if bool(inputs.get(key)) or key_lower.endswith("urls"):
            return _first_present(inputs, _input_aliases(key, param_type))
        return single_image or (image_list[0] if image_list else inputs.get(key))

    if param_type == "VIDEO":
        return _first_present(inputs, _input_aliases(key, param_type))

    if param_type == "AUDIO":
        return _first_present(inputs, _input_aliases(key, param_type))

    return None


async def _resolve_media_value(
    client: httpx.AsyncClient,
    api_key: str,
    value: Any,
    *,
    multiple: bool,
    output_type: str,
    site: str,
) -> Any:
    values = value if isinstance(value, list) else [value]
    force_upload = output_type == "video"
    resolved = [
        await maybe_upload(client, api_key, item, mode="standard", force=force_upload, site=site)
        for item in values
        if _value_present(item)
    ]
    if multiple:
        return resolved
    return resolved[0] if resolved else None


async def build_standard_payload(
    client: httpx.AsyncClient,
    api_key: str,
    endpoint: str,
    inputs: dict[str, Any],
    site: str = "cn",
) -> dict[str, Any]:
    """Build a payload whose keys are exactly official capability params."""
    import logging
    logger = logging.getLogger(__name__)

    capability = get_official_capability(endpoint)
    output_type = str(capability.get("output_type", ""))
    payload: dict[str, Any] = {}

    for param in capability.get("params", []):
        key = str(param.get("key", ""))
        param_type = str(param.get("type", "STRING")).upper()
        required = bool(param.get("required"))
        if not key:
            continue

        if param_type in ("IMAGE", "VIDEO", "AUDIO"):
            raw_value = _media_value_for_key(inputs, key, param_type)
        else:
            raw_value = _first_present(inputs, _input_aliases(key, param_type))

        logger.debug("Param %s (type=%s required=%s): raw=%s", key, param_type, required,
                     str(raw_value)[:120] if raw_value else None)

        supplied = _value_present(raw_value)
        if not supplied:
            default = param.get("default")
            if _value_present(default) and key not in ("prompt", "text"):
                raw_value = default
                logger.debug("Param %s: using default=%s", key, str(default)[:80])

        fixed_value = GEMINI_OMNI_FIXED_PARAMS.get(endpoint, {}).get(key)
        if fixed_value is not None:
            if supplied and str(raw_value) != fixed_value:
                raise RHError(
                    f"Invalid RunningHub parameter {key}={raw_value}; fixed value: {fixed_value}",
                    code=400,
                )
            raw_value = fixed_value

        if not _value_present(raw_value):
            if required:
                raise RHError(
                    f"Missing required parameter '{key}' for endpoint {endpoint}. "
                    f"Input keys: {sorted(k for k in inputs if inputs[k] not in (None, '', [], {}))}",
                    code=400,
                )
            logger.debug("Param %s: skipping optional (no value)", key)
            continue

        if param_type in ("IMAGE", "VIDEO", "AUDIO"):
            _validate_media_size(key, raw_value, param.get("maxSizeMB"))
            if isinstance(raw_value, list):
                allowed_counts = param.get("allowedCounts")
                if not allowed_counts and endpoint in {
                    "gemini-omni-flash/image-to-video",
                    "gemini-omni-flash/video-edit",
                } and key == "imageUrls":
                    allowed_counts = [1, 3]
                if allowed_counts and len(raw_value) not in allowed_counts:
                    raise RHError(
                        f"Invalid RunningHub parameter {key}: count must be {' or '.join(str(v) for v in allowed_counts)}",
                        code=400,
                    )
                max_count = param.get("maxCount")
                if max_count is not None and len(raw_value) > int(max_count):
                    raise RHError(f"Invalid RunningHub parameter {key}: maximum {max_count}", code=400)
            value = await _resolve_media_value(
                client,
                api_key,
                raw_value,
                multiple=bool(param.get("multiple")),
                output_type=output_type,
                site=site,
            )
            if not _value_present(value):
                if required:
                    raise RHError(
                        f"Failed to resolve required media param '{key}' for endpoint {endpoint}. "
                        f"Raw value type: {type(raw_value).__name__}",
                        code=400,
                    )
                logger.debug("Param %s: media resolution returned empty", key)
                continue
            payload[key] = value
            continue

        value = _coerce_scalar(raw_value, param_type)
        max_length = param.get("maxLength")
        if max_length is not None and isinstance(value, str) and len(value) > int(max_length):
            raise RHError(f"Invalid RunningHub parameter {key}: maximum length {max_length}", code=400)
        if param_type in ("INT", "FLOAT"):
            minimum = param.get("min")
            maximum = param.get("max")
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                raise RHError(f"Invalid RunningHub parameter {key}={raw_value}: expected number", code=400)
            if minimum is not None and value < float(minimum):
                raise RHError(f"Invalid RunningHub parameter {key}={value}: minimum {minimum}", code=400)
            if maximum is not None and value > float(maximum):
                raise RHError(f"Invalid RunningHub parameter {key}={value}: maximum {maximum}", code=400)
        _validate_option(key, value, param.get("options"))
        payload[key] = value

    logger.info("build_standard_payload: endpoint=%s payload_keys=%s",
                endpoint, sorted(payload.keys()))

    # Seedance 2.0 全系需要 realPersonMode 处理真人内容
    if "sparkvideo" in endpoint:
        payload["realPersonMode"] = True

    return payload

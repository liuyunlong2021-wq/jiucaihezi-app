"""Build RunningHub standard OpenAPI payloads from official capabilities."""

from __future__ import annotations

from typing import Any

import httpx

from ..models.capabilities import get_official_capability
from .rh_client import maybe_upload


def _value_present(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip() != ""
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
    """Resolve media inputs for official param keys without inventing payload keys."""
    key_lower = key.lower()
    if param_type == "IMAGE":
        images = inputs.get("images")
        image_list = images if isinstance(images, list) else ([images] if _value_present(images) else [])
        single_image = inputs.get("image")
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
) -> Any:
    values = value if isinstance(value, list) else [value]
    force_upload = output_type == "video"
    resolved = [
        await maybe_upload(client, api_key, item, mode="standard", force=force_upload)
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
) -> dict[str, Any]:
    """Build a payload whose keys are exactly official capability params."""
    capability = get_official_capability(endpoint)
    output_type = str(capability.get("output_type", ""))
    payload: dict[str, Any] = {}

    for param in capability.get("params", []):
        key = str(param.get("key", ""))
        param_type = str(param.get("type", "STRING")).upper()
        if not key:
            continue

        if param_type in ("IMAGE", "VIDEO", "AUDIO"):
            raw_value = _media_value_for_key(inputs, key, param_type)
        else:
            raw_value = _first_present(inputs, _input_aliases(key, param_type))
        if not _value_present(raw_value):
            default = param.get("default")
            if _value_present(default) and key not in ("prompt", "text"):
                raw_value = default

        if not _value_present(raw_value):
            continue

        if param_type in ("IMAGE", "VIDEO", "AUDIO"):
            value = await _resolve_media_value(
                client,
                api_key,
                raw_value,
                multiple=bool(param.get("multiple")),
                output_type=output_type,
            )
            if _value_present(value):
                payload[key] = value
            continue

        payload[key] = _coerce_scalar(raw_value, param_type)

    return payload

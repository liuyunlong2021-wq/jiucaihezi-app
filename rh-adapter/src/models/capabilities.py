"""Official RunningHub endpoint capabilities bundled from OpenClaw_RH_Skills."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any


CAPABILITIES_PATH = Path(__file__).with_name("capabilities.json")


@lru_cache(maxsize=1)
def load_official_capabilities() -> dict[str, dict[str, Any]]:
    """Load official capabilities by endpoint path."""
    data = json.loads(CAPABILITIES_PATH.read_text(encoding="utf-8"))
    endpoints = data if isinstance(data, list) else data.get("endpoints", [])
    return {
        item["endpoint"]: item
        for item in endpoints
        if isinstance(item, dict) and item.get("endpoint")
    }


def get_official_capability(endpoint: str) -> dict[str, Any]:
    """Return official endpoint capability, raising when endpoint is absent."""
    capabilities = load_official_capabilities()
    if endpoint not in capabilities:
        raise ValueError(f"Endpoint not found in official RunningHub capabilities: {endpoint}")
    return capabilities[endpoint]

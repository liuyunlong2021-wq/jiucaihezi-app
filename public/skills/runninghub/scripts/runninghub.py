#!/usr/bin/env python3
"""
RunningHub universal API client for OpenClaw.

Supports all 170+ RunningHub endpoints: image, video, audio, 3D, text understanding.
Uses only Python stdlib and curl.

Modes:
  --check                          Check local legacy credential status
  --list [--type T] [--task T]     List available endpoints
  --info ENDPOINT                  Show endpoint details
  --endpoint EP --prompt "..." ... Execute a generation task
  --task TASK --prompt "..."       Auto-select best endpoint for task
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

BASE_URL = "https://www.runninghub.cn/openapi/v2"
ACCOUNT_STATUS_URL = "https://www.runninghub.cn/uc/openapi/accountStatus"
POLL_ENDPOINT = "/query"
UPLOAD_ENDPOINT = "/media/upload/binary"

MAX_POLL_SECONDS = 1200
POLL_INTERVAL = 5
UPLOAD_TIMEOUT_SECONDS = int(os.getenv("RUNNINGHUB_UPLOAD_TIMEOUT", "300"))

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_ROOT = SCRIPT_DIR.parent
DEFAULT_OPENCLAW_HOME = SKILL_ROOT.parent.parent
OPENCLAW_HOME = Path(os.getenv("OPENCLAW_HOME", str(DEFAULT_OPENCLAW_HOME))).expanduser().resolve()
DATA_DIR = SCRIPT_DIR.parent / "data"
CAPABILITIES_PATH = DATA_DIR / "capabilities.json"
WORKFLOWS_PATH = DATA_DIR / "my-workflows.json"


# ---------------------------------------------------------------------------
# Capabilities catalog
# ---------------------------------------------------------------------------

_capabilities_cache = None
_workflow_registry_cache = None


def openclaw_hint_path(relative_path: str) -> str:
    env_value = os.getenv("OPENCLAW_HOME")
    if env_value:
        return str((OPENCLAW_HOME / relative_path).expanduser())
    return f"~/.openclaw/{relative_path}"


def load_jsonish_file(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # OpenClaw config files are often JSON5-ish with trailing commas.
        sanitized = re.sub(r",(\s*[}\]])", r"\1", text)
        return json.loads(sanitized)


def load_capabilities() -> dict:
    global _capabilities_cache
    if _capabilities_cache is not None:
        return _capabilities_cache
    if not CAPABILITIES_PATH.exists():
        print(f"Error: capabilities.json not found at {CAPABILITIES_PATH}", file=sys.stderr)
        sys.exit(1)
    _capabilities_cache = load_jsonish_file(CAPABILITIES_PATH)
    return _capabilities_cache


def find_endpoint(endpoint: str) -> dict | None:
    caps = load_capabilities()
    for ep in caps["endpoints"]:
        if ep["endpoint"] == endpoint:
            return ep
    return None


def find_best_for_task(task: str) -> dict | None:
    caps = load_capabilities()
    matches = [e for e in caps["endpoints"] if e["task"] == task]
    if not matches:
        return None
    return min(matches, key=lambda x: x["popularity"])


def _normalize_field_spec(alias: str, value) -> dict | None:
    if isinstance(value, dict):
        node_id = value.get("nodeId") or value.get("node") or value.get("id")
        field_name = value.get("fieldName") or value.get("field") or value.get("field_key")
        if node_id is None or field_name is None:
            return None
        spec = dict(value)
        spec["nodeId"] = str(node_id)
        spec["fieldName"] = str(field_name)
        spec.setdefault("type", "")
        if "kind" not in spec:
            spec["kind"] = "file" if str(spec.get("type", "")).upper() in {"IMAGE", "VIDEO", "AUDIO"} else "value"
        return spec

    if value is None:
        return None

    alias_lower = alias.lower()
    if alias_lower in {"prompt", "text"}:
        field_name = "text"
        kind = "value"
    elif alias_lower.startswith(("image", "video", "audio")) or alias_lower in {"image", "video", "audio"}:
        field_name = "image" if alias_lower.startswith("image") else alias_lower.rstrip("1234567890")
        kind = "file"
    else:
        field_name = "value"
        kind = "value"

    return {
        "nodeId": str(value),
        "fieldName": field_name,
        "kind": kind,
        "type": "",
    }


def _normalize_fields(raw_fields: dict) -> dict:
    normalized = {}
    if not isinstance(raw_fields, dict):
        return normalized

    for alias, value in raw_fields.items():
        if isinstance(value, list):
            base = alias[:-1] if alias.endswith("s") and len(alias) > 1 else alias
            for idx, item in enumerate(value, start=1):
                spec = _normalize_field_spec(f"{base}{idx}", item)
                if spec:
                    normalized[f"{base}{idx}"] = spec
        else:
            spec = _normalize_field_spec(alias, value)
            if spec:
                normalized[str(alias)] = spec
    return normalized


def _normalize_workflow(alias: str, raw_workflow: dict) -> dict | None:
    workflow = dict(raw_workflow)
    workflow_alias = str(workflow.get("alias") or alias or workflow.get("name") or workflow.get("id") or "").strip()
    webapp_id = workflow.get("webappId") or workflow.get("id")
    if not workflow_alias or webapp_id is None:
        return None

    inputs = _normalize_fields(workflow.get("inputs") or workflow.get("nodes") or {})
    outputs = _normalize_fields(workflow.get("outputs") or {})
    if not outputs and isinstance(workflow.get("nodes"), dict) and "output" in workflow["nodes"]:
        outputs = _normalize_fields({"output": workflow["nodes"]["output"]})

    return {
        "alias": workflow_alias,
        "webappId": str(webapp_id),
        "name": workflow.get("name") or workflow_alias,
        "description": workflow.get("description") or "",
        "type": workflow.get("type") or "",
        "profile": workflow.get("profile") or workflow.get("authProfile"),
        "usage": workflow.get("usage") or "",
        "tags": workflow.get("tags") or [],
        "inputs": inputs,
        "outputs": outputs,
    }


def normalize_workflow_registry(raw_registry: dict) -> dict:
    registry = {
        "version": 1,
        "defaultProfile": None,
        "profiles": {},
        "aliases": {},
        "workflows": {},
    }

    if not isinstance(raw_registry, dict):
        return registry

    registry["version"] = raw_registry.get("version", 1)
    registry["defaultProfile"] = raw_registry.get("defaultProfile")

    raw_aliases = raw_registry.get("aliases", {})
    if isinstance(raw_aliases, dict):
        registry["aliases"] = {
            str(alias): str(target)
            for alias, target in raw_aliases.items()
            if alias and target
        }

    raw_workflows = raw_registry.get("workflows", {})
    if isinstance(raw_workflows, list):
        items = []
        for workflow in raw_workflows:
            if isinstance(workflow, dict):
                items.append((workflow.get("alias") or workflow.get("name") or workflow.get("id"), workflow))
    elif isinstance(raw_workflows, dict):
        items = list(raw_workflows.items())
    else:
        items = []

    for alias, workflow_data in items:
        if not isinstance(workflow_data, dict):
            continue
        normalized = _normalize_workflow(str(alias), workflow_data)
        if normalized:
            registry["workflows"][normalized["alias"]] = normalized

    return registry


def load_workflow_registry() -> dict:
    global _workflow_registry_cache
    if _workflow_registry_cache is not None:
        return _workflow_registry_cache
    if not WORKFLOWS_PATH.exists():
        _workflow_registry_cache = normalize_workflow_registry({})
        return _workflow_registry_cache
    _workflow_registry_cache = normalize_workflow_registry(load_jsonish_file(WORKFLOWS_PATH))
    return _workflow_registry_cache


def get_default_workflow_profile() -> str | None:
    registry = load_workflow_registry()
    profile = registry.get("defaultProfile")
    return str(profile) if profile else None


def resolve_workflow_alias(alias_or_id: str) -> str:
    registry = load_workflow_registry()
    current = str(alias_or_id)
    seen = set()
    while current in registry["aliases"] and current not in seen:
        seen.add(current)
        current = registry["aliases"][current]
    return current


def find_workflow(alias_or_id: str) -> dict | None:
    registry = load_workflow_registry()
    resolved = resolve_workflow_alias(alias_or_id)
    workflow = registry["workflows"].get(resolved)
    if workflow:
        return workflow
    for candidate in registry["workflows"].values():
        if candidate["webappId"] == str(alias_or_id):
            return candidate
    return None


def list_workflows(type_filter: str | None = None, profile_filter: str | None = None) -> list[dict]:
    registry = load_workflow_registry()
    workflows = list(registry["workflows"].values())
    if type_filter:
        workflows = [wf for wf in workflows if wf.get("type") == type_filter]
    if profile_filter:
        workflows = [wf for wf in workflows if (wf.get("profile") or registry.get("defaultProfile")) == profile_filter]
    return sorted(workflows, key=lambda wf: wf["alias"])


# ---------------------------------------------------------------------------
# Gateway-only execution guard
# ---------------------------------------------------------------------------

def resolve_runninghub_credential(*_args, **_kwargs) -> str | None:
    return None


def get_key_source(*_args, **_kwargs) -> str:
    return "gateway-only"


def require_api_key(*_args, **_kwargs) -> str:
    result = {
        "error": "NO_API_KEY",
        "message": "Desktop RunningHub access is managed by Jiucaihezi Gateway account membership. 桌面端请使用韭菜盒子账号会员体系。",
        "steps": [
            "1. Log in to the Jiucaihezi desktop account center.",
            "2. Open or renew 会员 in the account center.",
            "3. Use canvas or creation panel media features through Gateway and NewAPI automatic routing.",
        ],
    }
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(1)


# ---------------------------------------------------------------------------
# HTTP helpers (curl-based, stdlib only)
# ---------------------------------------------------------------------------

def curl_post_json(url: str, payload: dict, headers: dict, timeout: int = 60) -> subprocess.CompletedProcess:
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(payload, f)
        tmp_path = f.name
    try:
        cmd = ["curl", "-s", "-S", "--fail-with-body", "-X", "POST", url,
               "--max-time", str(timeout), "-d", f"@{tmp_path}"]
        for k, v in headers.items():
            cmd += ["-H", f"{k}: {v}"]
        return subprocess.run(cmd, capture_output=True, text=True)
    finally:
        os.unlink(tmp_path)


def api_post(api_key: str, url: str, payload: dict, timeout: int = 60) -> dict:
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    result = curl_post_json(url, payload, headers, timeout)

    if result.returncode != 0:
        error_body = result.stdout or result.stderr
        try:
            err = json.loads(error_body)
            code = err.get("code", "")
            msg = err.get("msg", error_body)
        except (json.JSONDecodeError, TypeError):
            code = ""
            msg = error_body

        code_str = str(code).lower()
        msg_lower = msg.lower() if isinstance(msg, str) else ""

        if any(k in code_str or k in msg_lower for k in ["auth", "401", "403", "token", "key"]):
            error_result = {
                "error": "AUTH_FAILED",
                "message": f"Upstream authentication failed. Please sign in again through Jiucaihezi Gateway membership. Detail: {msg}",
            }
        elif any(k in code_str or k in msg_lower for k in ["balance", "insufficient", "余额", "credit"]):
            error_result = {
                "error": "INSUFFICIENT_BALANCE",
                "message": f"Insufficient balance: {msg}",
                "recharge_url": "https://www.runninghub.cn/vip-rights/4",
            }
        else:
            error_result = {
                "error": "API_ERROR",
                "message": f"API request failed: {msg}",
                "http_stderr": result.stderr[:500] if result.stderr else "",
            }
        print(json.dumps(error_result, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)

    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        print(json.dumps({
            "error": "API_ERROR",
            "message": f"Invalid JSON response: {result.stdout[:500]}",
        }, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


# ---------------------------------------------------------------------------
# --check: account health check
# ---------------------------------------------------------------------------

def cmd_check():
    key = resolve_runninghub_credential()
    if not key:
        print(json.dumps({
            "status": "no_key",
            "message": "Desktop media access is managed by Jiucaihezi Gateway account membership. 桌面端请使用韭菜盒子账号会员体系。",
            "steps": [
                "1. Log in to the Jiucaihezi desktop account center.",
                "2. Open or renew 会员 in the account center.",
                "3. Use canvas or creation panel media features through Gateway and NewAPI automatic routing.",
            ],
        }, ensure_ascii=False))
        return

    key_prefix = key[:4] + "****"
    key_source = get_key_source()

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {key}",
    }
    result = curl_post_json(ACCOUNT_STATUS_URL, {"apikey": key}, headers, timeout=15)

    if result.returncode != 0:
        print(json.dumps({
            "status": "invalid_key",
            "key_prefix": key_prefix,
            "key_source": key_source,
            "message": "Local legacy credential is invalid, expired, or unavailable. Please use Jiucaihezi Gateway membership.",
            "detail": (result.stdout or result.stderr)[:300],
        }, ensure_ascii=False))
        return

    try:
        resp = json.loads(result.stdout)
    except json.JSONDecodeError:
        print(json.dumps({
            "status": "error",
            "key_prefix": key_prefix,
            "message": f"Unexpected response: {result.stdout[:300]}",
        }, ensure_ascii=False))
        return

    if resp.get("code") != 0:
        print(json.dumps({
            "status": "invalid_key",
            "key_prefix": key_prefix,
            "key_source": key_source,
            "message": resp.get("msg", "Local legacy credential verification failed. Please use Jiucaihezi Gateway membership."),
        }, ensure_ascii=False))
        return

    data = resp.get("data", {})
    balance = data.get("remainMoney")
    balance_str = str(balance) if balance is not None else "0"
    currency = data.get("currency", "CNY")

    try:
        balance_num = float(balance_str)
    except (ValueError, TypeError):
        balance_num = 0.0

    if balance_num <= 0:
        print(json.dumps({
            "status": "no_balance",
            "key_prefix": key_prefix,
            "key_source": key_source,
            "balance": balance_str,
            "currency": currency,
            "coins": data.get("remainCoins", "0"),
            "running_tasks": data.get("currentTaskCounts", "0"),
            "api_type": data.get("apiType", ""),
            "message": "Wallet balance is zero. Recharge required.",
            "recharge_url": "https://www.runninghub.cn/vip-rights/4",
        }, ensure_ascii=False))
        return

    print(json.dumps({
        "status": "ready",
        "key_prefix": key_prefix,
        "key_source": key_source,
        "balance": balance_str,
        "currency": currency,
        "coins": data.get("remainCoins", "0"),
        "running_tasks": data.get("currentTaskCounts", "0"),
        "api_type": data.get("apiType", ""),
    }, ensure_ascii=False))


# ---------------------------------------------------------------------------
# --list / --info: capability discovery
# ---------------------------------------------------------------------------

def cmd_list(type_filter: str | None, task_filter: str | None):
    caps = load_capabilities()
    endpoints = caps["endpoints"]

    if type_filter:
        endpoints = [e for e in endpoints if e["output_type"] == type_filter]
    if task_filter:
        endpoints = [e for e in endpoints if e["task"] == task_filter]

    rows = []
    for e in endpoints:
        name = e["name_cn"] or e["name_en"] or e["endpoint"]
        tags = ",".join(e["tags"]) if e["tags"] else ""
        pop = e["popularity"] if e["popularity"] < 99 else "-"
        rows.append(f"  [{e['output_type']:6s}] {e['task']:25s} rank={str(pop):3s} {e['endpoint']:60s} {name}")

    print(f"Total: {len(rows)} endpoints")
    if type_filter:
        print(f"Filter: type={type_filter}")
    if task_filter:
        print(f"Filter: task={task_filter}")
    print()
    for r in rows:
        print(r)


def cmd_info(endpoint: str):
    ep = find_endpoint(endpoint)
    if not ep:
        print(f"Error: endpoint '{endpoint}' not found", file=sys.stderr)
        print("Use --list to see available endpoints.", file=sys.stderr)
        sys.exit(1)
    print(json.dumps(ep, indent=2, ensure_ascii=False))


# ---------------------------------------------------------------------------
# Media handling
# ---------------------------------------------------------------------------

def upload_file(api_key: str, file_path: str) -> str:
    url = f"{BASE_URL}{UPLOAD_ENDPOINT}"
    cmd = ["curl", "-s", "-S", "--fail-with-body", "--http1.1", "--retry", "2", "--retry-all-errors", "--retry-delay", "2", "-X", "POST", url,
           "-H", f"Authorization: Bearer {api_key}",
           "-F", f"file=@{file_path}", "--max-time", str(UPLOAD_TIMEOUT_SECONDS)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Upload failed: {result.stderr}", file=sys.stderr)
        sys.exit(1)
    try:
        resp = json.loads(result.stdout)
    except json.JSONDecodeError:
        print(f"Upload returned invalid JSON: {result.stdout[:500]}", file=sys.stderr)
        sys.exit(1)
    if resp.get("code") == 0:
        return resp["data"]["download_url"]
    print(f"Upload error: {resp}", file=sys.stderr)
    sys.exit(1)


def image_to_data_uri(file_path: str) -> str:
    mime_type = mimetypes.guess_type(file_path)[0] or "image/png"
    with open(file_path, "rb") as f:
        encoded = base64.b64encode(f.read()).decode()
    return f"data:{mime_type};base64,{encoded}"


def resolve_media(api_key: str, media_path: str, force_upload: bool = False) -> str:
    if media_path.startswith(("http://", "https://")):
        return media_path
    path = Path(media_path)
    if not path.exists():
        print(f"Error: file not found: {media_path}", file=sys.stderr)
        sys.exit(1)
    size = path.stat().st_size
    if force_upload or size > 5 * 1024 * 1024:
        return upload_file(api_key, media_path)
    return image_to_data_uri(media_path)


# ---------------------------------------------------------------------------
# Task execution: submit → poll → download
# ---------------------------------------------------------------------------

def poll_once(api_key: str, url: str, task_id: str) -> dict | None:
    """Single poll attempt with retry on transient network errors."""
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    for attempt in range(3):
        result = curl_post_json(url, {"taskId": task_id}, headers, timeout=30)
        if result.returncode == 0:
            try:
                return json.loads(result.stdout)
            except json.JSONDecodeError:
                return None
        if attempt < 2:
            time.sleep(2)
    return None


def poll_task(api_key: str, task_id: str) -> dict:
    url = f"{BASE_URL}{POLL_ENDPOINT}"
    print(f"Task ID: {task_id}")
    print("Waiting for result", end="", flush=True)

    elapsed = 0
    consecutive_failures = 0
    while elapsed < MAX_POLL_SECONDS:
        time.sleep(POLL_INTERVAL)
        elapsed += POLL_INTERVAL
        resp = poll_once(api_key, url, task_id)
        if resp is None:
            consecutive_failures += 1
            print("x", end="", flush=True)
            if consecutive_failures >= 5:
                print(f"\nToo many consecutive poll failures", file=sys.stderr)
                sys.exit(1)
            continue
        consecutive_failures = 0
        status = resp.get("status", "UNKNOWN")

        if status == "SUCCESS":
            print(f" done ({elapsed}s)")
            return resp
        if status == "FAILED":
            error_msg = resp.get("errorMessage", "Unknown error")
            error_code = resp.get("errorCode", "")
            msg_lower = f"{error_msg} {error_code}".lower()
            if any(k in msg_lower for k in ["balance", "insufficient", "余额", "credit"]):
                print(json.dumps({
                    "error": "INSUFFICIENT_BALANCE",
                    "message": f"Task failed: {error_msg}",
                    "recharge_url": "https://www.runninghub.cn/vip-rights/4",
                }, ensure_ascii=False), file=sys.stderr)
            else:
                print(json.dumps({
                    "error": "TASK_FAILED",
                    "message": f"Task failed: [{error_code}] {error_msg}",
                }, ensure_ascii=False), file=sys.stderr)
            sys.exit(1)

        print(".", end="", flush=True)

    print(f"\nTimeout after {MAX_POLL_SECONDS}s", file=sys.stderr)
    sys.exit(1)


def download_file(url: str, output_path: str) -> str:
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    cmd = ["curl", "-s", "-S", "-L", "-o", output_path, "--max-time", "300", url]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Download failed: {result.stderr}", file=sys.stderr)
        sys.exit(1)
    return str(Path(output_path).resolve())


import struct

def fix_mov_to_mp4(file_path: str) -> bool:
    """Rewrite QuickTime MOV ftyp box to standard MP4 for platform compatibility.
    Only touches the ftyp header; no re-encoding, no external dependencies.
    Returns True if the file was patched."""
    try:
        with open(file_path, "rb") as f:
            header = f.read(64)
    except OSError:
        return False

    if len(header) < 16:
        return False

    box_size = struct.unpack(">I", header[0:4])[0]
    if header[4:8] != b"ftyp" or box_size < 16 or box_size > len(header):
        return False

    if header[8:12] != b"qt  ":
        return False

    minor_version = header[12:16]
    brands = [b"isom", b"iso2", b"avc1", b"mp41"]
    brands_space = box_size - 16
    max_brands = brands_space // 4
    used_brands = brands[:max_brands]

    new_ftyp = struct.pack(">I", box_size) + b"ftyp" + b"isom" + minor_version
    for b in used_brands:
        new_ftyp += b
    new_ftyp += b"\x00" * (box_size - len(new_ftyp))

    with open(file_path, "r+b") as f:
        f.write(new_ftyp)

    print(f"Fixed MOV→MP4 container: {Path(file_path).name}", file=sys.stderr)
    return True


def build_payload(endpoint_def: dict, args, api_key: str) -> dict:
    """Build API payload from endpoint definition and CLI args."""
    payload = {}

    # Collect --param key=value pairs
    extra_params = {}
    if args.param:
        for p in args.param:
            if "=" not in p:
                print(f"Error: invalid --param format '{p}', expected key=value", file=sys.stderr)
                sys.exit(1)
            k, v = p.split("=", 1)
            extra_params[k] = v

    # --prompt is a convenient alias for the "prompt" or "text" param
    prompt_key = None
    for param in endpoint_def["params"]:
        if param["key"] in ("prompt", "text"):
            prompt_key = param["key"]
            break

    if args.prompt and prompt_key:
        payload[prompt_key] = args.prompt
    elif args.prompt:
        payload["prompt"] = args.prompt

    # Map CLI media inputs to the appropriate payload keys
    media_keys = []
    for param in endpoint_def["params"]:
        if param["type"] in ("IMAGE", "VIDEO", "AUDIO"):
            media_keys.append(param)

    # --image can map to imageUrl, imageUrls, firstImageUrl, etc.
    if args.image:
        image_params = [p for p in media_keys if p["type"] == "IMAGE"]
        if len(args.image) == 1 and len(image_params) >= 1:
            pk = image_params[0]["key"]
            needs_upload = pk in ("videoUrl",) or endpoint_def["output_type"] == "video"
            resolved = resolve_media(api_key, args.image[0], force_upload=needs_upload)
            if image_params[0].get("multiple"):
                payload[pk] = [resolved]
            else:
                payload[pk] = resolved
        elif len(args.image) > 1:
            multi_param = next((p for p in image_params if p.get("multiple")), None)
            if multi_param:
                payload[multi_param["key"]] = [
                    resolve_media(api_key, img, force_upload=True) for img in args.image
                ]
            else:
                for i, (img, param) in enumerate(zip(args.image, image_params)):
                    payload[param["key"]] = resolve_media(api_key, img, force_upload=True)

    if args.video:
        video_params = [p for p in media_keys if p["type"] == "VIDEO"]
        if video_params:
            payload[video_params[0]["key"]] = resolve_media(api_key, args.video, force_upload=True)

    if args.audio:
        audio_params = [p for p in media_keys if p["type"] == "AUDIO"]
        if audio_params:
            payload[audio_params[0]["key"]] = resolve_media(api_key, args.audio, force_upload=True)

    # Apply extra --param key=value (overrides defaults)
    for k, v in extra_params.items():
        param_def = next((p for p in endpoint_def["params"] if p["key"] == k), None)
        if param_def and param_def["type"] == "BOOLEAN":
            payload[k] = v.lower() in ("true", "1", "yes")
        elif param_def and param_def["type"] in ("INT", "FLOAT"):
            try:
                payload[k] = int(v) if param_def["type"] == "INT" else float(v)
            except ValueError:
                payload[k] = v
        else:
            payload[k] = v

    # Fill defaults for required params not yet set
    for param in endpoint_def["params"]:
        if param["key"] not in payload and param.get("required") and "default" in param:
            payload[param["key"]] = param["default"]

    return payload


def cmd_execute(args):
    """Execute a generation task."""
    api_key = require_api_key()

    # Resolve endpoint
    if args.endpoint:
        endpoint_def = find_endpoint(args.endpoint)
        if not endpoint_def:
            print(f"Error: endpoint '{args.endpoint}' not found", file=sys.stderr)
            print("Use --list to see available endpoints.", file=sys.stderr)
            sys.exit(1)
    elif args.task:
        endpoint_def = find_best_for_task(args.task)
        if not endpoint_def:
            print(f"Error: no endpoint found for task '{args.task}'", file=sys.stderr)
            print("Use --list to see available tasks.", file=sys.stderr)
            sys.exit(1)
        print(f"Auto-selected: {endpoint_def['endpoint']} ({endpoint_def.get('name_cn', '')})", file=sys.stderr)
    else:
        print("Error: --endpoint or --task is required", file=sys.stderr)
        sys.exit(1)

    payload = build_payload(endpoint_def, args, api_key)
    submit_url = f"{BASE_URL}/{endpoint_def['endpoint']}"

    print(f"Submitting {endpoint_def['task']} to {endpoint_def['endpoint']}...", file=sys.stderr)
    resp = api_post(api_key, submit_url, payload)
    task_id = resp.get("taskId")
    if not task_id:
        print(f"Error: no taskId in response: {json.dumps(resp, ensure_ascii=False)}", file=sys.stderr)
        sys.exit(1)

    final = resp if (resp.get("status") == "SUCCESS" and resp.get("results")) else poll_task(api_key, task_id)
    results = final.get("results")
    if not results:
        print("Error: no results in final response", file=sys.stderr)
        sys.exit(1)

    result_item = results[0]
    result_url = result_item.get("url") or result_item.get("outputUrl")
    output_type_ext = result_item.get("outputType", "")

    # Extract cost from usage data
    usage = final.get("usage") or {}
    consume_money = usage.get("consumeMoney") or usage.get("thirdPartyConsumeMoney")
    task_cost_time = usage.get("taskCostTime")

    # Text results (for string output_type endpoints)
    if not result_url:
        text_result = result_item.get("text") or result_item.get("content") or result_item.get("output")
        if text_result:
            print(text_result)
            if consume_money is not None:
                print(f"COST:¥{consume_money}")
            if task_cost_time and str(task_cost_time) != "0":
                print(f"DURATION:{task_cost_time}s")
            return
        print(json.dumps({"error": "TASK_FAILED", "message": "No URL or text in results"}))
        sys.exit(1)

    output_path = args.output
    if not output_path:
        ext = output_type_ext or _guess_ext(endpoint_def["output_type"])
        output_path = f"/tmp/openclaw/rh-output/result.{ext}"

    if output_type_ext:
        output_path = str(Path(output_path).with_suffix(f".{output_type_ext}"))

    print(f"Downloading result to local file...", file=sys.stderr)
    full_path = download_file(result_url, output_path)
    fix_mov_to_mp4(full_path)
    print(f"OUTPUT_FILE:{full_path}")

    if consume_money is not None:
        print(f"COST:¥{consume_money}")
    if task_cost_time and str(task_cost_time) != "0":
        print(f"DURATION:{task_cost_time}s")


def _guess_ext(output_type: str) -> str:
    return {"image": "png", "video": "mp4", "audio": "mp3", "3d": "glb"}.get(output_type, "bin")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="RunningHub universal API client for OpenClaw",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
Modes:
  --check                           Check local legacy credential status
  --list [--type T] [--task T]      List available endpoints
  --info ENDPOINT                   Show endpoint parameter details
  --endpoint EP [options]           Execute with specific endpoint
  --task TASK [options]             Execute with auto-selected best endpoint

Examples:
  python3 runninghub.py --check
  python3 runninghub.py --list --type image
  python3 runninghub.py --info rhart-image-n-pro/text-to-image
  python3 runninghub.py --endpoint rhart-image-n-pro/text-to-image --prompt "a cute dog" --output /tmp/dog.png
  python3 runninghub.py --task text-to-image --prompt "a cute dog" --output /tmp/dog.png
""",
    )

    # Mode flags
    parser.add_argument("--check", action="store_true", help="Check local legacy credential status")
    parser.add_argument("--list", action="store_true", help="List available endpoints")
    parser.add_argument("--info", metavar="ENDPOINT", help="Show details for an endpoint")

    # Execution params
    parser.add_argument("--endpoint", "-e", help="API endpoint to call")
    parser.add_argument("--task", "-t", help="Task type (auto-selects best endpoint)")
    parser.add_argument("--prompt", "-p", help="Text prompt")
    parser.add_argument("--image", "-i", action="append", help="Input image path or URL (repeatable)")
    parser.add_argument("--video", help="Input video path or URL")
    parser.add_argument("--audio", help="Input audio path or URL")
    parser.add_argument("--param", action="append", help="Extra parameter as key=value (repeatable)")
    parser.add_argument("--output", "-o", help="Output file path")
    # Filters for --list
    parser.add_argument("--type", dest="type_filter", help="Filter by output type (image/video/audio/3d/string)")

    args = parser.parse_args()

    if args.check:
        cmd_check()
    elif args.list:
        cmd_list(args.type_filter, args.task)
    elif args.info:
        cmd_info(args.info)
    elif args.endpoint or args.task:
        cmd_execute(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()

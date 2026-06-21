"""
RunningHub HTTP client — low-level API communication.

All actual HTTP calls to RunningHub go through here.
Stateless: receives api_key and parameters, returns raw responses.
"""

from __future__ import annotations

import asyncio
import base64
import logging
from typing import Optional

import httpx

from ..config import (
    RH_API_V2,
    RH_STANDARD_UPLOAD,
    RH_AI_APP_UPLOAD,
    RH_AI_APP_RUN,
    RH_AI_APP_STATUS,
    RH_AI_APP_OUTPUTS,
    MAX_POLL_SECONDS,
    POLL_INTERVAL_IMAGE,
    POLL_INTERVAL_VIDEO,
)

logger = logging.getLogger(__name__)


class RHError(Exception):
    """RunningHub API error."""
    def __init__(self, message: str, code: int = 500, rh_code: str = ""):
        super().__init__(message)
        self.code = code
        self.rh_code = rh_code


class RHAuthError(RHError):
    """API key invalid."""
    def __init__(self, message: str = "RunningHub API key invalid"):
        super().__init__(message, code=401, rh_code="auth_error")


class RHInsufficientFunds(RHError):
    """RunningHub account out of balance."""
    def __init__(self, message: str = "RunningHub account balance insufficient"):
        super().__init__(message, code=402, rh_code="insufficient_funds")


class RHTaskFailed(RHError):
    """Task execution failed."""
    def __init__(self, message: str = "Task execution failed", rh_code: str = ""):
        super().__init__(message, code=500, rh_code=rh_code)


class RHPollTimeout(RHError):
    """Task polling timed out."""
    def __init__(self, message: str = "Task polling timed out", task_id: str = ""):
        super().__init__(message, code=504, rh_code="poll_timeout")


def _auth_headers(api_key: str) -> dict:
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }


def _check_rh_error(data: dict, context: str = "") -> None:
    """Check RunningHub response for errors and raise appropriate exceptions."""
    if not isinstance(data, dict):
        raise RHError(f"Unexpected RH response type {type(data).__name__}: {str(data)[:300]}", code=500)

    code = data.get("code", 0)
    msg = data.get("msg", data.get("message", ""))

    # Also check errorCode / errorMessage (RH v2 format)
    error_code = str(data.get("errorCode", "") or "").strip()
    if error_code and error_code != "0":
        error_msg = data.get("errorMessage", "") or msg or f"RunningHub error {error_code}"
        full_msg = f"{context}: {error_msg}" if context else str(error_msg)
        raise RHError(full_msg, rh_code=error_code)

    if code == 0 or code == 200:
        return

    full_msg = f"{context}: {msg}" if context else msg

    if code == 401 or "auth" in str(msg).lower():
        raise RHAuthError(full_msg)
    if code == 402 or "balance" in str(msg).lower() or "insufficient" in str(msg).lower():
        raise RHInsufficientFunds(full_msg)

    raise RHError(full_msg, rh_code=str(code))


async def _post(
    client: httpx.AsyncClient,
    url: str,
    payload: dict,
    api_key: str,
    timeout: int = 60,
) -> dict:
    """POST JSON to RunningHub API."""
    try:
        resp = await client.post(
            url,
            json=payload,
            headers=_auth_headers(api_key),
            timeout=timeout,
        )
        data = resp.json()
        _check_rh_error(data, f"POST {url}")
        return data
    except RHError:
        raise
    except httpx.TimeoutException:
        raise RHError(f"Request timeout: {url}", code=504)
    except Exception as e:
        raise RHError(f"Request failed: {e}", code=500)


async def _get(
    client: httpx.AsyncClient,
    url: str,
    payload: dict,
    api_key: str,
    timeout: int = 30,
) -> dict:
    """GET/POST (with body) to RunningHub API (RH uses POST for queries)."""
    try:
        resp = await client.post(
            url,
            json=payload,
            headers=_auth_headers(api_key),
            timeout=timeout,
        )
        data = resp.json()
        _check_rh_error(data, f"GET {url}")
        return data
    except RHError:
        raise
    except httpx.TimeoutException:
        raise RHError(f"Request timeout: {url}", code=504)
    except Exception as e:
        raise RHError(f"Request failed: {e}", code=500)


async def upload_file(
    client: httpx.AsyncClient,
    api_key: str,
    file_content: bytes,
    filename: str = "image.png",
    mime_type: str = "image/png",
) -> str:
    """Upload to RunningHub standard API. Returns a downloadable file URL."""
    files = {"file": (filename, file_content, mime_type)}

    try:
        resp = await client.post(
            RH_STANDARD_UPLOAD,
            files=files,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=120,
        )
        data = resp.json()
        _check_rh_error(data, "File upload")

        file_data = data.get("data", {})
        file_url = (
            file_data.get("url") or
            file_data.get("downloadUrl") or
            file_data.get("download_url") or
            ""
        )
        if not file_url:
            raise RHError("Upload succeeded but no URL returned")
        return file_url
    except RHError:
        raise
    except Exception as e:
        raise RHError(f"Upload failed: {e}", code=500)


async def upload_ai_app_file(
    client: httpx.AsyncClient,
    api_key: str,
    file_content: bytes,
    filename: str = "input.png",
    mime_type: str = "image/png",
) -> str:
    """Upload to RunningHub AI App API. Returns the RH fileName token."""
    files = {"file": (filename, file_content, mime_type)}
    data_payload = {"apiKey": api_key, "fileType": "input"}

    try:
        resp = await client.post(
            RH_AI_APP_UPLOAD,
            files=files,
            data=data_payload,
            timeout=120,
        )
        data = resp.json()
        _check_rh_error(data, "AI App file upload")

        file_name = str(data.get("data", {}).get("fileName") or "").strip()
        if not file_name:
            raise RHError("AI App upload succeeded but no fileName returned")
        return file_name
    except RHError:
        raise
    except Exception as e:
        raise RHError(f"AI App upload failed: {e}", code=500)


async def submit_task(
    client: httpx.AsyncClient,
    api_key: str,
    endpoint: str,
    payload: dict,
) -> dict:
    """Submit a generation task to RunningHub standard API.

    Returns: {task_id, ...}
    """
    url = f"{RH_API_V2}/{endpoint}"
    payload["apikey"] = api_key  # RH v2 uses lowercase key
    data = await _post(client, url, payload, api_key, timeout=60)
    task_data = data.get("data", data)
    return task_data


async def poll_task(
    client: httpx.AsyncClient,
    api_key: str,
    task_id: str,
    output_type: str = "image",
    on_progress=None,
) -> dict:
    """Poll RunningHub task until completion.

    Returns the final task result with URL and cost info.
    """
    poll_url = f"{RH_API_V2}/query"
    poll_interval = POLL_INTERVAL_VIDEO if output_type == "video" else POLL_INTERVAL_IMAGE
    max_polls = MAX_POLL_SECONDS // poll_interval

    for i in range(max_polls):
        await asyncio.sleep(poll_interval)
        data = await _get(
            client, poll_url,
            {"taskId": task_id, "apikey": api_key},
            api_key,
            timeout=30,
        )

        task_data = data.get("data", data)
        status = task_data.get("status", "")
        elapsed = (i + 1) * poll_interval

        if on_progress:
            on_progress(elapsed, status)

        logger.debug("Poll %d/%d: status=%s elapsed=%ds", i + 1, max_polls, status, elapsed)

        if status in ("completed", "complete", "success", "succeeded", "done"):
            return task_data

        if status in ("failed", "failure", "fail", "error", "cancelled"):
            error_msg = (
                task_data.get("failReason") or
                task_data.get("fail_reason") or
                task_data.get("error") or
                data.get("msg") or
                "Task failed"
            )
            raise RHTaskFailed(str(error_msg), rh_code=status)

    raise RHPollTimeout(f"Task {task_id} timed out after {MAX_POLL_SECONDS}s", task_id=task_id)


async def submit_ai_app(
    client: httpx.AsyncClient,
    api_key: str,
    webapp_id: str,
    node_list: list[dict],
) -> str:
    """Submit an AI Application (ComfyUI workflow) task. Returns task_id."""
    webapp_value = int(webapp_id) if str(webapp_id).isdigit() else webapp_id
    payload = {
        "webappId": webapp_value,
        "nodeInfoList": node_list,
        "apiKey": api_key,
    }
    data = await _post(client, RH_AI_APP_RUN, payload, api_key, timeout=60)
    task_data = data.get("data", data)
    task_id = task_data.get("taskId") or task_data.get("task_id", "")
    if not task_id:
        raise RHError("AI App submission did not return taskId")
    return str(task_id)


async def poll_ai_app(
    client: httpx.AsyncClient,
    api_key: str,
    task_id: str,
    on_progress=None,
) -> dict:
    """Poll an AI Application task until completion."""
    poll_url = RH_AI_APP_STATUS
    max_polls = MAX_POLL_SECONDS // 10

    for i in range(max_polls):
        await asyncio.sleep(10)
        data = await _get(
            client, poll_url,
            {"taskId": task_id, "apiKey": api_key},
            api_key,
            timeout=30,
        )
        task_data = data.get("data", data)
        status = task_data.get("status", "")
        elapsed = (i + 1) * 10
        if on_progress:
            on_progress(elapsed, status)

        if status in ("completed", "complete", "success", "done"):
            return task_data
        if status in ("failed", "failure", "fail", "error"):
            raise RHTaskFailed(
                task_data.get("failReason") or task_data.get("error") or "AI App task failed",
                rh_code=status,
            )

    raise RHPollTimeout(f"AI App task {task_id} timed out")


UPLOAD_THRESHOLD = 5_242_880   # 5MB
MAX_UPLOAD_SIZE = 20_971_520   # 20MB
ALLOWED_UPLOAD_MIMES = ("image/", "video/", "audio/")


async def maybe_upload(
    client: httpx.AsyncClient,
    api_key: str,
    data_url: str,
    *,
    mode: str = "standard",
    force: bool = False,
) -> str:
    """Resolve media for RH.

    Standard API accepts small data URIs and uploaded URLs. AI App media nodes
    expect the fileName token returned by /task/openapi/upload.
    """
    if not data_url:
        return data_url
    if data_url.startswith(("http://", "https://")):
        return data_url
    if not data_url.startswith("data:"):
        return data_url

    if "," not in data_url:
        raise RHError("Malformed data URL: missing comma", code=400)
    header, encoded = data_url.split(",", 1)
    try:
        mime = header.split(":")[1].split(";")[0]
    except IndexError:
        raise RHError("Malformed data URL: cannot parse MIME type", code=400)
    if not any(mime.startswith(prefix) for prefix in ALLOWED_UPLOAD_MIMES):
        raise RHError(f"Unsupported file type: {mime}", code=400)

    raw = base64.b64decode(encoded)
    if len(raw) > MAX_UPLOAD_SIZE:
        raise RHError("File exceeds 20MB limit", code=413)
    ext = mime.split("/")[1].split(";")[0]
    if mode == "ai_app":
        return await upload_ai_app_file(client, api_key, raw, f"input.{ext}", mime)
    if force or len(raw) > UPLOAD_THRESHOLD:
        return await upload_file(client, api_key, raw, f"upload.{ext}", mime)
    return data_url


async def query_task(
    client: httpx.AsyncClient,
    api_key: str,
    task_id: str,
) -> dict:
    """Single-shot query of a RH task status. No polling, no waiting."""
    poll_url = f"{RH_API_V2}/query"
    data = await _get(
        client, poll_url,
        {"taskId": task_id, "apikey": api_key},
        api_key,
        timeout=30,
    )
    return data.get("data", data)


async def query_ai_app_task(
    client: httpx.AsyncClient,
    api_key: str,
    task_id: str,
) -> dict:
    """Single-shot query of an AI App task status."""
    data = await _get(
        client, RH_AI_APP_STATUS,
        {"taskId": task_id, "apiKey": api_key},
        api_key,
        timeout=30,
    )
    task_data = data.get("data", data)
    url = extract_result_url(task_data)
    if not url:
        try:
            out_data = await _get(
                client, RH_AI_APP_OUTPUTS,
                {"taskId": task_id, "apiKey": api_key},
                api_key,
                timeout=30,
            )
            out = out_data.get("data", out_data)
            url = extract_result_url(out) if isinstance(out, dict) else ""
            if url:
                task_data["url"] = url
        except Exception:
            pass
    return task_data


def extract_result_url(task_data: dict) -> str:
    """Extract result URL from polled task data."""
    if not isinstance(task_data, dict):
        return ""
    # Direct url field
    url = task_data.get("url") or task_data.get("outputUrl") or task_data.get("downloadUrl")
    if url:
        return url

    # Nested in results/data array
    results = task_data.get("results") or task_data.get("data") or []
    if results:
        first = results[0]
        if isinstance(first, dict):
            url = first.get("url") or first.get("outputUrl") or ""
            if url:
                return url
        elif isinstance(first, str):
            return first

    # Text results
    text = task_data.get("text") or task_data.get("content") or task_data.get("output")
    if isinstance(text, str) and text:
        return text

    return ""


def extract_result_text(task_data: dict) -> str:
    """Extract text result from polled task data."""
    if not isinstance(task_data, dict):
        return ""
    text = task_data.get("text") or task_data.get("content") or task_data.get("output")
    if isinstance(text, str) and text:
        return text

    results = task_data.get("results") or task_data.get("data") or []
    if results:
        first = results[0]
        if isinstance(first, dict):
            text = first.get("text") or first.get("content") or ""
            if isinstance(text, str) and text:
                return text
        elif isinstance(first, str):
            return first

    return ""


def extract_cost(task_data: dict) -> float:
    """Extract cost from task data."""
    if not isinstance(task_data, dict):
        return 0.0
    usage = task_data.get("usage", {})
    cost = usage.get("consumeMoney") or usage.get("thirdPartyConsumeMoney")
    if cost is not None:
        return float(cost)
    # Also check direct consumeMoney on task_data
    direct = task_data.get("consumeMoney")
    if direct is not None:
        return float(direct)
    return 0.0


def extract_task_time(task_data: dict) -> float:
    """Extract task execution time from task data."""
    usage = task_data.get("usage", {})
    t = usage.get("taskCostTime")
    if t is not None:
        return float(t)
    return 0.0


async def check_health(client: httpx.AsyncClient, api_key: str) -> dict:
    """Check API key validity and account balance."""
    url = "https://www.runninghub.cn/uc/openapi/accountStatus"
    try:
        data = await _post(client, url, {"apikey": api_key}, api_key, timeout=15)
        account_data = data.get("data", data)
        return {
            "status": "ok",
            "balance": account_data.get("balance", 0),
            "account": account_data.get("account", ""),
        }
    except RHAuthError:
        return {"status": "auth_error", "balance": 0, "account": ""}
    except Exception as e:
        return {"status": "error", "message": str(e)}

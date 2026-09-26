"""校验 NewAPI / 创作面板认的那套对外合同。

跑之前先起服务：`.venv\\Scripts\\python.exe app.py`

覆盖三块：
  1. 视频任务合同：POST /v1/videos → GET /v1/videos/{id} → GET /v1/videos/{id}/content（含 Range）
  2. 入参宽容度：单数 image、非数值 resolution（创作面板会带着别的模型的残留字段过来）
  3. 鉴权：占位符密钥必须被拒

用法：
    python tools/verify_newapi_contract.py            # 全跑（会占一次显卡出一小段视频）
    python tools/verify_newapi_contract.py --no-gpu   # 跳过真实出片，只验表单与鉴权
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from adp.config import load_config  # noqa: E402

BASE = "http://127.0.0.1:9000"
PLACEHOLDER_KEYS = ("change-me-please", "changeme", "your-key-here")

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"  [{'通过' if ok else '失败'}] {label}{'  ' + detail if detail else ''}")
    if not ok:
        failures.append(label)


def header(headers: dict, name: str) -> str:
    """响应头名大小写不固定（uvicorn 发小写），统一按大小写无关取。"""
    wanted = name.lower()
    for key, value in headers.items():
        if key.lower() == wanted:
            return str(value)
    return ""


def call(path: str, body: dict | None = None, method: str = "GET",
         key: str = "", headers: dict | None = None, timeout: int = 180):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(f"{BASE}{path}", data=data, method=method)
    if key:
        request.add_header("Authorization", f"Bearer {key}")
    if data:
        request.add_header("Content-Type", "application/json")
    for name, value in (headers or {}).items():
        request.add_header(name, value)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            content_type = response.headers.get("content-type", "")
            return response.status, (json.loads(raw) if "json" in content_type else raw), dict(response.headers)
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            return exc.code, json.loads(raw), dict(exc.headers)
        except ValueError:
            return exc.code, raw, dict(exc.headers)


def verify_auth(key: str) -> None:
    print("1) 鉴权")
    status, _, _ = call("/v1/models", key=key)
    check("真实密钥可用", status == 200, f"HTTP {status}")
    status, _, _ = call("/v1/models")
    check("不带密钥被拒", status == 401, f"HTTP {status}")
    for placeholder in PLACEHOLDER_KEYS:
        status, _, _ = call("/v1/models", key=placeholder)
        check(f"占位符 {placeholder!r} 被拒", status == 401, f"HTTP {status}")


def verify_field_tolerance(key: str) -> None:
    print("\n2) 入参宽容度（故意给连不上的图片地址）")
    bogus = "http://127.0.0.1:1/nope.png"

    def video_body(**extra) -> dict:
        return {"model": "minimax-h3", "prompt": "x", **extra}

    status, body, _ = call("/v1/videos", video_body(image=bogus), "POST", key)
    check("单数 image 被识别", status == 400 and "参考图" in json.dumps(body, ensure_ascii=False), f"HTTP {status}")

    status, body, _ = call("/v1/videos", video_body(images=[bogus]), "POST", key)
    check("复数 images 仍可用", status == 400 and "参考图" in json.dumps(body, ensure_ascii=False), f"HTTP {status}")

    # 这几个都因为参考图下载失败停在 400；只要不是 422 就说明字段没把请求打断
    status, _, _ = call("/v1/videos", video_body(image=bogus, resolution="720p"), "POST", key)
    check("视频带 resolution='720p' 不再 422", status == 400, f"HTTP {status}")

    status, _, _ = call(
        "/v1/images/generations",
        {"model": "qwen-image-2.1", "prompt": "x", "resolution": "2k"},
        "POST",
        key,
        timeout=300,
    )
    check("图片带 resolution='2k' 不再 422", status == 200, f"HTTP {status}")


def verify_video_contract(key: str) -> None:
    print("\n3) 视频任务合同")
    status, _, _ = call("/v1/videos/task_20260101_deadbeefdead", key=key)
    check("未知任务 id -> 404", status == 404, f"HTTP {status}")

    # 最小规格：768x448 / 5 帧 / 4 步，几秒就出片
    payload = {
        "model": "minimax-h3",
        "prompt": "一只白猫眨了下眼睛",
        "width": 768,
        "height": 448,
        "length": 5,
        "steps": 4,
    }
    status, data, _ = call("/v1/videos", payload, "POST", key)
    # 必须 200：NewAPI 只把 200 当中继成功，收到 202 会把它自己的响应体当错误丢回面板
    check("POST /v1/videos -> 200", status == 200, f"HTTP {status}")
    task_id = str((data or {}).get("id") or "")
    check("返回任务 id", task_id.startswith("task_"), task_id)
    if not task_id:
        return

    seen: set[str] = set()
    final: dict | None = None
    deadline = time.time() + 300
    while time.time() < deadline:
        status, view, _ = call(f"/v1/videos/{task_id}", key=key)
        if status != 200:
            check("轮询返回 200", False, f"HTTP {status}")
            return
        state = str(view.get("status") or "")
        seen.add(state)
        if state in ("completed", "failed"):
            final = view
            break
        time.sleep(2)

    completed = bool(final) and final.get("status") == "completed"
    check("轮询收敛到 completed", completed, f"见过 {sorted(seen)}")
    url = str(((final or {}).get("metadata") or {}).get("url") or "")
    check("completed 带 metadata.url", url.startswith("http"), url)

    status, blob, headers = call(f"/v1/videos/{task_id}/content", key=key)
    check("成片下载 -> 200", status == 200, f"HTTP {status}")
    check("Content-Type 是视频", "video/" in header(headers, "Content-Type"), header(headers, "Content-Type"))
    check("拿到字节", isinstance(blob, bytes) and len(blob) > 1000,
          f"{len(blob) if isinstance(blob, bytes) else 0} 字节")

    status, _, headers = call(f"/v1/videos/{task_id}/content", key=key, headers={"Range": "bytes=0-1023"})
    check("Range 请求 -> 206", status == 206, f"HTTP {status}")
    check("Content-Range 正确", header(headers, "Content-Range").startswith("bytes 0-1023/"),
          header(headers, "Content-Range"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-gpu", action="store_true", help="跳过真实出片（不出视频/图片）")
    args = parser.parse_args()

    cfg = load_config()
    keys = cfg.auth.effective_keys
    if not keys:
        print("!! config.yaml 没有配 api_key，先补上再跑")
        return 2
    if cfg.auth.using_placeholder:
        print("!! api_keys 还是占位符 —— 先换成真实随机密钥再跑")
        return 2

    print(f"服务: {BASE}   对外地址: {cfg.server.public_base_url}\n")
    verify_auth(keys[0])
    if args.no_gpu:
        print("\n（--no-gpu：跳过视频合同与图片宽容度里的真实生成）")
    else:
        verify_field_tolerance(keys[0])
        verify_video_contract(keys[0])

    print("\n" + ("全部通过 ✅" if not failures else f"失败 {len(failures)} 项 ❌ -> {failures}"))
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())

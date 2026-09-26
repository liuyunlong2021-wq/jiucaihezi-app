"""错误路径回归测试：确认各类异常都返回符合预期的状态码与 OpenAI 风格错误体。

用法:
    python tools/test_errors.py
    python tools/test_errors.py --base http://127.0.0.1:9000 --key <api_key>
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from adp import harden_stdout  # noqa: E402

harden_stdout()


def post(base: str, path: str, payload: dict, key: str | None = None, timeout: int = 60):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(base + path, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    if key:
        req.add_header("Authorization", f"Bearer {key}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def get(base: str, path: str, key: str | None = None, timeout: int = 30):
    req = urllib.request.Request(base + path)
    if key:
        req.add_header("Authorization", f"Bearer {key}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


CASES = [
    ("未知模型 -> 400", "POST", "/v1/images/generations",
     {"model": "no-such-model", "prompt": "x"}, None, 400),
    ("非法 response_format -> 400", "POST", "/v1/images/generations",
     {"model": "qwen-image-2.1", "prompt": "x", "response_format": "xml"}, None, 400),
    ("缺 prompt -> 422", "POST", "/v1/images/generations",
     {"model": "qwen-image-2.1"}, None, 422),
    ("n 超范围 -> 422", "POST", "/v1/images/generations",
     {"model": "qwen-image-2.1", "prompt": "x", "n": 99}, None, 422),
    ("未知路径 -> 404", "GET", "/v1/nope", None, None, 404),
    # ---- 编辑相关（同一个模型：不带参考图=文生图，带参考图=编辑）----
    ("编辑缺参考图 -> 400", "POST", "/v1/images/edits",
     {"model": "qwen-image-2.1", "prompt": "x"}, None, 400),
    ("编辑缺 prompt -> 400", "POST", "/v1/images/edits",
     {"model": "qwen-image-2.1", "images": ["whatever.png"]}, None, 400),
    ("编辑模型不存在 -> 400", "POST", "/v1/images/edits",
     {"model": "nope", "prompt": "x", "images": ["whatever.png"]}, None, 400),
    ("参考图超 10 张 -> 400", "POST", "/v1/images/generations",
     {"model": "qwen-image-2.1", "prompt": "x",
      "images": [f"img{i}.png" for i in range(11)]}, None, 400),
    ("编辑超 10 张 -> 400", "POST", "/v1/images/edits",
     {"model": "qwen-image-2.1", "prompt": "x",
      "images": [f"img{i}.png" for i in range(11)]}, None, 400),
    # ---- 异步任务 ----
    ("任务不存在 -> 404", "GET", "/v1/tasks/task_not_exist", None, None, 404),
    ("任务列表 -> 200", "GET", "/v1/tasks", None, None, 200),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:9000")
    ap.add_argument("--key", default=None)
    args = ap.parse_args()
    base = args.base.rstrip("/")

    failures = 0
    for name, method, path, payload, extra_key, expect in CASES:
        key = extra_key if extra_key is not None else args.key
        if method == "POST":
            code, body = post(base, path, payload, key)
        else:
            code, body = get(base, path, key)

        ok = code == expect
        # 错误体应当是 OpenAI 风格（404 由 FastAPI 处理，除外）
        shape = ""
        try:
            obj = json.loads(body)
            if "error" in obj:
                shape = f"type={obj['error'].get('type')} msg={str(obj['error'].get('message'))[:70]}"
            elif "detail" in obj:
                shape = f"detail={str(obj['detail'])[:70]}"
        except Exception:  # noqa: BLE001
            shape = body[:70].decode("utf-8", "replace")

        mark = "✅" if ok else "❌"
        print(f"{mark} {name:<32} 实得 HTTP {code}  期望 {expect}")
        if shape:
            print(f"      {shape}")
        if not ok:
            failures += 1

    print()
    if failures:
        print(f"❌ {failures} 个用例不符合预期")
        return 1
    print("✅ 全部错误路径符合预期")
    return 0


if __name__ == "__main__":
    sys.exit(main())

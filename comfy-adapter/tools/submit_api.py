"""直接向 ComfyUI 提交一份 API 格式 prompt，用于验证模板能跑通。

比走适配层更快 —— 改一处就提交一次，不用管模型注册、参数绑定那些。

用法:
    python tools/submit_api.py workflows/minimax-h3-video.json --set 6.length=22 --wait
    python tools/submit_api.py x.json --set 6.width=768 --set 6.height=448 --set 9.noise_seed=1 --wait
    python tools/submit_api.py x.json --dry            # 只做参数校验，不真跑
    python tools/submit_api.py x.json --wait --timeout 900
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

from adp import harden_stdout  # noqa: E402

harden_stdout()


def post(url: str, payload: dict, timeout: int = 60):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), method="POST"
    )
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:  # noqa: BLE001
            return e.code, {"raw": e.read()[:1500].decode("utf-8", "replace")}


def get(url: str, timeout: int = 60):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read())


def parse_set(expr: str) -> tuple[str, str, object]:
    """'6.length=22' -> ('6', 'length', 22)"""
    lhs, _, rhs = expr.partition("=")
    nid, _, inp = lhs.partition(".")
    if not nid or not inp:
        raise ValueError(f"--set 格式应为 <节点id>.<输入名>=<JSON值>，收到 {expr!r}")
    try:
        value = json.loads(rhs)
    except json.JSONDecodeError:
        value = rhs  # 当普通字符串
    return nid, inp, value


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--base", default="http://127.0.0.1:8188")
    ap.add_argument("--set", dest="sets", action="append", default=[],
                    help="覆盖模板里的值，如 --set 6.length=22")
    ap.add_argument("--client-id", default="comfy-adapter-validate")
    ap.add_argument("--dry", action="store_true", help="只用 /object_info 做静态校验，不提交")
    ap.add_argument("--wait", action="store_true", help="提交后等待完成")
    ap.add_argument("--timeout", type=int, default=1800)
    ap.add_argument("--poll", type=float, default=2.0)
    args = ap.parse_args()

    with open(args.file, "r", encoding="utf-8-sig") as f:
        prompt = json.load(f)
    print(f"已载入 {args.file}（{len(prompt)} 个节点）")

    for expr in args.sets:
        nid, inp, value = parse_set(expr)
        if nid not in prompt:
            print(f"!! 模板里没有节点 {nid}")
            return 2
        prompt[nid].setdefault("inputs", {})[inp] = value
        print(f"   set #{nid}.{inp} = {json.dumps(value, ensure_ascii=False)}")

    if args.dry:
        # 只校验：拿 object_info 比对每个节点的 inputs 名是否存在
        info = get(f"{args.base}/object_info")
        bad = 0
        for nid, node in prompt.items():
            cls = node.get("class_type")
            spec = info.get(cls)
            if not spec:
                print(f"   [失败] #{nid} 节点类未注册: {cls}")
                bad += 1
                continue
            known = set(spec.get("input", {}).get("required", {})) | set(
                spec.get("input", {}).get("optional", {})
            )
            for k in (node.get("inputs") or {}):
                base = k.split(".", 1)[0]
                if base not in known:
                    print(f"   [警告] #{nid} {cls} 有未知输入 {k}")
        print("静态校验完成" if not bad else f"静态校验发现 {bad} 个问题")
        return 1 if bad else 0

    code, obj = post(f"{args.base}/prompt", {"prompt": prompt, "client_id": args.client_id})
    if code != 200:
        print(f"!! 提交失败 HTTP {code}")
        print(json.dumps(obj, ensure_ascii=False, indent=2)[:4000])
        return 1

    pid = obj.get("prompt_id")
    print(f"已提交 prompt_id={pid}")

    if not args.wait:
        return 0

    print("等待中…")
    t0 = time.monotonic()
    while time.monotonic() - t0 < args.timeout:
        hist = get(f"{args.base}/history/{pid}")
        entry = hist.get(pid)
        if entry:
            status = (entry.get("status") or {}).get("status_str")
            if (entry.get("status") or {}).get("completed") or status == "error":
                elapsed = time.monotonic() - t0
                print(f"\n状态: {status}   墙钟 {elapsed:.1f}s")
                for m in (entry.get("status") or {}).get("messages") or []:
                    if isinstance(m, (list, tuple)) and len(m) == 2 and m[0] == "execution_error":
                        info = m[1] or {}
                        print(f"  错误: {info.get('exception_type')}: {info.get('exception_message')}")
                        print(f"        节点 #{info.get('node_id')} {info.get('node_type')}")
                outs = entry.get("outputs") or {}
                for nid, o in outs.items():
                    print(f"  输出 #{nid}: {json.dumps(o, ensure_ascii=False)[:300]}")
                return 0 if status == "success" else 1
        time.sleep(args.poll)

    print("!! 等待超时")
    return 1


if __name__ == "__main__":
    sys.exit(main())

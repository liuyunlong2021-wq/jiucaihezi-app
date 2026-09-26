"""从 ComfyUI 的 /history 里挖出「实际提交过的 API 格式 prompt」。

用途：不用手工导出 API 工作流 —— 只要某个工作流在 ComfyUI 里跑成功过，
这里就能把它当时的 API prompt 原样取出来，直接当模板用。

`/history` 每条的 `prompt` 字段是个 5 元组 list（不是 dict）：
  [0] 数字  [1] prompt_id
  [2] **实际提交的 API 格式 prompt**（含全部 inputs 与连线）
  [3] extra_data，其中 ["extra_pnginfo"]["workflow"] 是 UI 格式画布工作流
  [4] 要执行的节点 id 列表

用法:
    python tools/fetch_history.py --list
    python tools/fetch_history.py --extract <prompt_id> --out workflows/xxx.json
    python tools/fetch_history.py --extract <prompt_id> --ui-out xxx_ui.json
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from collections import Counter
from pathlib import Path

# 这些节点类出现，说明是视频工作流
VIDEO_HINTS = {
    "MiniMaxH3AudioConditioningT8",
    "MiniMaxH3DualClockSamplerT8",
    "MiniMaxH3AVDecodeT8",
    "VHS_VideoCombine",
    "SaveVideo",
    "WanVideoSampler",
}


def fetch(base: str) -> dict:
    with urllib.request.urlopen(f"{base.rstrip('/')}/history", timeout=60) as r:
        return json.load(r)


def unwrap(entry: dict) -> tuple[dict, dict, str]:
    """返回 (api_prompt, ui_workflow, status_str)。"""
    p = entry.get("prompt")
    api, ui = {}, {}
    if isinstance(p, list) and len(p) >= 3:
        api = p[2] if isinstance(p[2], dict) else {}
        extra = p[3] if len(p) > 3 and isinstance(p[3], dict) else {}
        ui = (extra.get("extra_pnginfo") or {}).get("workflow") or {}
    elif isinstance(p, dict):
        api = p
        ui = (entry.get("extra_data") or {}).get("extra_pnginfo", {}).get("workflow") or {}
    status = (entry.get("status") or {}).get("status_str") or "?"
    return api, ui, status


def summarize(pid: str, entry: dict) -> str:
    api, ui, status = unwrap(entry)
    classes = Counter(n.get("class_type", "?") for n in api.values())
    video = sorted(c for c in classes if c in VIDEO_HINTS or "Video" in c or "MiniMax" in c)
    outs = sorted({k for n in (entry.get("outputs") or {}).values() for k in (n or {})})
    return (
        f"{pid}\n"
        f"    状态={status}  节点={len(api)}  UI节点={len(ui.get('nodes') or [])}\n"
        f"    视频相关类: {video or '（无）'}\n"
        f"    输出字段: {outs or '（无）'}\n"
        f"    全部类: {', '.join(sorted(classes))[:400]}"
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8188")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--only-video", action="store_true", help="只列视频类工作流")
    ap.add_argument("--extract", metavar="PROMPT_ID")
    ap.add_argument("--out", help="把 API 格式 prompt 写到这个路径")
    ap.add_argument("--ui-out", help="把 UI 格式工作流写到这个路径")
    args = ap.parse_args()

    try:
        hist = fetch(args.base)
    except Exception as e:  # noqa: BLE001
        print(f"!! 取 /history 失败: {e}")
        return 2

    if not hist:
        print("!! /history 是空的（ComfyUI 重启过，历史就没了）")
        return 1

    if args.list or not args.extract:
        print(f"# /history 共 {len(hist)} 条\n")
        for pid, entry in hist.items():
            api, _, _ = unwrap(entry)
            classes = set(n.get("class_type", "") for n in api.values())
            if args.only_video and not (classes & VIDEO_HINTS):
                continue
            print(summarize(pid, entry))
            print()

    if args.extract:
        entry = hist.get(args.extract)
        if entry is None:
            print(f"!! 找不到 prompt_id: {args.extract}")
            return 1
        api, ui, status = unwrap(entry)
        if not api:
            print("!! 这条记录里没有 API prompt")
            return 1

        if args.out:
            Path(args.out).parent.mkdir(parents=True, exist_ok=True)
            with open(args.out, "w", encoding="utf-8") as f:
                json.dump(api, f, ensure_ascii=False, indent=2)
            print(f"已写出 API prompt（{len(api)} 个节点，状态 {status}）-> {args.out}")

        if args.ui_out and ui:
            Path(args.ui_out).parent.mkdir(parents=True, exist_ok=True)
            with open(args.ui_out, "w", encoding="utf-8") as f:
                json.dump(ui, f, ensure_ascii=False, indent=2)
            print(f"已写出 UI 工作流（{len(ui.get('nodes') or [])} 个节点）-> {args.ui_out}")

    return 0


if __name__ == "__main__":
    sys.exit(main())

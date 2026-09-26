"""检查 API 格式 prompt（工作流模板）的结构。

和 `inspect_wf.py` 互补：那个看 UI 格式画布工作流，这个看真正提交给 ComfyUI 的
API 格式 prompt。

用法:
    python tools/inspect_api.py workflows/qwen-image-2.1.json
    python tools/inspect_api.py <file> --grep 提示词        # 只列含关键词的输入
    python tools/inspect_api.py <file> --class KSampler     # 只看某类节点
    python tools/inspect_api.py <file> --brief              # 只列节点与类名
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from adp import harden_stdout  # noqa: E402

harden_stdout()


def is_link(v) -> bool:
    """[ "12", 0 ] 形式 = 连到节点 12 的第 0 个输出。"""
    return isinstance(v, list) and len(v) == 2 and isinstance(v[0], str) and isinstance(v[1], int)


def short(v, limit: int = 70) -> str:
    s = json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v
    s = s.replace("\n", "\\n")
    return s if len(s) <= limit else s[:limit] + "…"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--brief", action="store_true", help="只列节点 id 与类名")
    ap.add_argument("--class", dest="cls", default=None, help="只看这个节点类")
    ap.add_argument("--grep", default=None, help="只列值里含这个关键词的输入")
    ap.add_argument("--no-widgets", action="store_true", help="不打印控件值")
    args = ap.parse_args()

    with open(args.file, "r", encoding="utf-8-sig") as f:
        prompt = json.load(f)

    classes = Counter(n.get("class_type", "?") for n in prompt.values())
    print("=" * 100)
    print(f"FILE: {args.file}")
    print(f"节点数: {len(prompt)}  |  节点类数: {len(classes)}")
    print(f"节点类: {', '.join(f'{k}×{v}' if v > 1 else k for k, v in sorted(classes.items()))}")
    print("=" * 100)

    for nid, node in prompt.items():
        cls = node.get("class_type", "?")
        if args.cls and cls != args.cls:
            continue
        meta = node.get("_meta") or {}
        title = meta.get("title") or ""
        print(f"\n#{nid:<6} {cls}" + (f"   «{title}»" if title else ""))

        if args.brief:
            continue

        inputs = node.get("inputs") or {}
        links = {k: v for k, v in inputs.items() if is_link(v)}
        widgets = {k: v for k, v in inputs.items() if not is_link(v)}

        if links:
            print("     连线:")
            for k, v in links.items():
                origin = prompt.get(v[0], {})
                print(f"       {k:<28} ← #{v[0]}[{v[1]}] {origin.get('class_type', '?')}")
        if widgets and not args.no_widgets:
            print("     控件:")
            for k, v in widgets.items():
                if args.grep and args.grep.lower() not in str(v).lower():
                    continue
                print(f"       {k:<28} = {short(v)}")

    return 0


if __name__ == "__main__":
    sys.exit(main())

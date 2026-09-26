"""打印指定节点类的输入规格（从 ComfyUI /object_info 拉取）。

用法:
    python tools/dump_node_info.py UNETLoader CLIPLoader KSampler ...
    python tools/dump_node_info.py --grep qwen          # 模糊搜索类名
"""
from __future__ import annotations

import sys
import json
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from adp import harden_stdout  # noqa: E402

harden_stdout()

COMFY_URL = "http://127.0.0.1:8188"


def fetch_object_info() -> dict:
    with urllib.request.urlopen(f"{COMFY_URL}/object_info", timeout=60) as r:
        return json.load(r)


def is_link_type(spec) -> bool:
    """判断某个输入是否是「连线型」而非「控件型」。"""
    t = spec[0]
    if isinstance(t, list):
        return False          # COMBO
    return t not in ("INT", "FLOAT", "STRING", "BOOLEAN", "COMBO")


def show(info: dict, cls: str) -> None:
    node = info.get(cls)
    if node is None:
        print(f"!! 未找到节点类: {cls}")
        return
    print("=" * 90)
    print(f"{cls}   (display: {node.get('display_name')!r})")
    inp = node.get("input", {})
    for group in ("required", "optional"):
        spec_group = inp.get(group) or {}
        if not spec_group:
            continue
        print(f"  [{group}]")
        for name, spec in spec_group.items():
            t = spec[0]
            opts = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}
            extra = {k: v for k, v in opts.items()
                     if k in ("default", "min", "max", "step", "control_after_generate", "multiline")}
            if isinstance(t, list):
                shown = t if len(t) <= 8 else f"[{len(t)} options] e.g. {t[:5]}"
                print(f"    {name:<32} COMBO   {extra}")
                print(f"        options: {shown}")
            else:
                kind = "LINK(连线)" if is_link_type(spec) else "widget"
                print(f"    {name:<32} {t:<7} {kind}  {extra}")
    outs = node.get("output") or []
    print(f"  [outputs] {outs}")
    print()


def main() -> None:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)
    info = fetch_object_info()
    print(f"# /object_info 共 {len(info)} 个节点类\n")
    if args[0] == "--grep":
        pat = args[1].lower()
        hits = sorted(k for k in info if pat in k.lower())
        for h in hits:
            print(" ", h)
        return
    if args[0] == "--raw":
        # 打印原始 input 规格，用于看 AUTOGROW 的 prefix / min / max
        for cls in args[1:]:
            node = info.get(cls)
            if node is None:
                print(f"!! 未找到: {cls}")
                continue
            print("=" * 90)
            print(f"{cls}")
            print(json.dumps(node.get("input"), ensure_ascii=False, indent=2))
            print(f"output: {node.get('output')}")
        return
    for cls in args:
        show(info, cls)


if __name__ == "__main__":
    main()

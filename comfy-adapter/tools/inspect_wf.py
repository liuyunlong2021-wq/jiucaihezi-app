"""工作流检查工具：把 ComfyUI 的 UI 格式工作流压成易读摘要。

用法:
    python tools/inspect_wf.py <workflow.json> [<workflow.json> ...]
    python tools/inspect_wf.py --dir <目录>
"""
from __future__ import annotations

import sys
import json
import glob
import os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from adp import harden_stdout  # noqa: E402

harden_stdout()


def trunc(value, limit=48):
    s = str(value).replace("\n", "\\n")
    return s if len(s) <= limit else s[:limit] + "…"


def inspect(path: str) -> None:
    with open(path, "r", encoding="utf-8-sig") as f:
        wf = json.load(f)

    print("=" * 100)
    print(f"FILE: {path}")
    if "nodes" not in wf:
        print("  !! 这不是 UI 格式工作流（无 nodes 字段）—— 可能是 API 格式")
        if isinstance(wf, dict):
            for nid, n in list(wf.items())[:60]:
                print(f"  {nid:>5} {n.get('class_type')}")
        return

    nodes = wf["nodes"]
    print(f"nodes={len(nodes)}  links={len(wf.get('links') or [])}  last_node_id={wf.get('last_node_id')}")

    # 只保留有实际作用的节点（排除 Note / MarkdownNote）
    kinds = {}
    for n in nodes:
        kinds[n["type"]] = kinds.get(n["type"], 0) + 1
    print("  node types:", ", ".join(f"{k}×{v}" if v > 1 else k for k, v in sorted(kinds.items())))

    print("\n  --- NODES (按 order) ---")
    for n in sorted(nodes, key=lambda x: (x.get("order") if x.get("order") is not None else 9999)):
        if n["type"] in ("Note", "MarkdownNote"):
            continue
        mode = n.get("mode", 0)
        tag = {0: "", 2: " [MUTED]", 4: " [BYPASS]"}.get(mode, f" [mode={mode}]")
        print(f"  #{n['id']:<4} {n['type']:<44}{tag}")
        wv = n.get("widgets_values")
        if wv:
            for i, v in enumerate(wv):
                if isinstance(v, str) and len(v) > 48:
                    print(f"          w[{i}] {trunc(v)}")
                else:
                    print(f"          w[{i}] {trunc(v)}")

    print("\n  --- LINKED INPUTS ---")
    for n in sorted(nodes, key=lambda x: x["id"]):
        if n["type"] in ("Note", "MarkdownNote"):
            continue
        linked = [(i, inp) for i, inp in enumerate(n.get("inputs") or []) if inp.get("link") is not None]
        if linked:
            parts = [f"{inp['name']}" for _, inp in linked]
            print(f"  #{n['id']:<4} {n['type']:<44} <- {', '.join(parts)}")

    # --- 顶层连线（只打印涉及「非 Note」节点的） ---
    by_id = {n["id"]: n for n in nodes}
    links = wf.get("links") or []
    if links:
        print(f"\n  --- LINKS ({len(links)}) ---")
        for lk in links:
            if isinstance(lk, dict):
                lid, o, os_, t, ts, typ = (lk.get("id"), lk.get("origin_id"), lk.get("origin_slot"),
                                           lk.get("target_id"), lk.get("target_slot"), lk.get("type"))
            elif isinstance(lk, list) and len(lk) >= 6:
                lid, o, os_, t, ts, typ = lk[:6]
            else:
                continue
            on = by_id.get(o, {})
            tn = by_id.get(t, {})
            if on.get("type") in ("Note", "MarkdownNote") or tn.get("type") in ("Note", "MarkdownNote"):
                continue
            o_name = (on.get("outputs") or [{}])[os_].get("name") if on.get("outputs") else "?"
            t_name = (tn.get("inputs") or [{}])[ts].get("name") if tn.get("inputs") else "?"
            print(f"    link{lid}: #{o}[{os_}].{o_name} ({on.get('type')})  ->  #{t}[{ts}].{t_name} ({tn.get('type')})  :{typ}")

    # --- 子图展开 ---
    subs = (wf.get("definitions") or {}).get("subgraphs") or []
    if subs:
        print(f"\n  --- SUBGRAPHS ({len(subs)}) ---")
        for sg in subs:
            print(f"  [subgraph id={sg.get('id')}] name={sg.get('name')!r}")
            for n in sorted(sg.get("nodes") or [], key=lambda x: x.get("order", 9999)):
                if n["type"] in ("Note", "MarkdownNote"):
                    continue
                print(f"      #{n['id']:<4} {n['type']:<44}")
                for i, v in enumerate(n.get("widgets_values") or []):
                    print(f"              w[{i}] {trunc(v)}")
            # 子图输入/输出映射
            for key in ("inputs", "outputs"):
                mapped = sg.get(key) or []
                if mapped:
                    print(f"      {key}:")
                    for m in mapped:
                        print(f"          {json.dumps(m, ensure_ascii=False)[:180]}")

            # 子图内部连线（新版格式: [id, fromNode, fromSlot, toNode, toSlot, type]）
            inner_links = sg.get("links") or []
            if inner_links:
                print(f"      inner links ({len(inner_links)}):")
                for lk in inner_links:
                    if isinstance(lk, list) and len(lk) >= 6:
                        print(f"          #{lk[1]}[{lk[2]}] -> #{lk[3]}[{lk[4]}]  {lk[5]}")

    print()


def main() -> None:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)

    paths: list[str] = []
    if args[0] == "--dir":
        paths = sorted(glob.glob(os.path.join(args[1], "*.json")))
    else:
        paths = args

    for p in paths:
        if Path(p).exists():
            try:
                inspect(p)
            except Exception as e:  # noqa: BLE001
                print(f"!! 解析失败 {p}: {e}\n")


if __name__ == "__main__":
    main()

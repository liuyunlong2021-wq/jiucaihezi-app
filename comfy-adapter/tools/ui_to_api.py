"""把 ComfyUI 的 **UI 格式**工作流转成 **API 格式** prompt（可直接 POST /prompt）。

为什么要这个工具：
    UI 格式（画布）和 API 格式（提交体）结构完全不同。
    57 个节点手工抄必错，而且 UI 里的接线顺序、widget 顺序都不好猜。

核心规则（已在本仓库的工作流上逐一验证）：
    1. widgets_values 里的值，按 ``inputs[]`` 数组中带 ``"widget"`` 字段的项**顺序**对应。
       新版前端也可能给成 dict（键=widget 名），那就直接按键取。
    2. 连线来自顶层 ``links`` 数组：``[link_id, 源节点, 源槽位, 目标节点, 目标槽位, 类型]``。
       连线**覆盖**同名 widget 值 —— 这正是运行时的真实行为。
    3. ``mode`` 为 2（mute）或 4（bypass）的节点要丢掉。

用法::

    python tools/ui_to_api.py 画布.json --out prompt.json
    python tools/ui_to_api.py 画布.json --out prompt.json --drop-class LoadImage
    python tools/ui_to_api.py 画布.json --out prompt.json --output 21
    python tools/ui_to_api.py 画布.json --out prompt.json --set 4.unet_name=foo.safetensors
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from collections import deque
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from adp import harden_stdout  # noqa: E402

harden_stdout()

# 纯注释 / 中转节点，API 格式里不存在
SKIP_TYPES = {
    "Note",
    "MarkdownNote",
    "Reroute",
    "PrimitiveNode",
    "Bookmark",
    "Subgraph",
    "Group",
}

# 输出节点类（决定剪枝的根）
OUTPUT_CLASSES = {
    "VHS_VideoCombine",
    "SaveImage",
    "SaveVideo",
    "SaveAudio",
    "SaveAnimatedWEBP",
    "PreviewImage",
    "PreviewAudio",
    "SaveImageWithAlpha",
    "SaveLatent",
}

# ComfyUI 的 node mode：0=ALWAYS, 2=NEVER(mute), 4=BYPASS
MUTE_MODES = {2, 4}

# 纯前端 widget，API 格式里不存在，必须跳过。
# 例：LoadImage 的 "upload" 区（IMAGEUPLOAD）—— 它在 widgets_values 里占位，
# 但提交给后端会报 unknown input。
IGNORE_WIDGET_TYPES = {"IMAGEUPLOAD"}

COMFY = "http://127.0.0.1:8188"


def fetch_object_info() -> dict:
    with urllib.request.urlopen(f"{COMFY}/object_info", timeout=180) as r:
        return json.loads(r.read().decode("utf-8"))


def load_ui(path: str | Path) -> dict:
    # 前端导出的 JSON 常带 BOM
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def build_linkmap(ui: dict) -> dict[int, tuple[int, int]]:
    """link_id -> (源节点 id, 源输出槽位)。"""
    m: dict[int, tuple[int, int]] = {}
    for l in ui.get("links") or []:
        if not isinstance(l, list) or len(l) < 5:
            # 个别前端会写成 dict
            if isinstance(l, dict) and "id" in l:
                m[int(l["id"])] = (int(l["origin_id"]), int(l.get("origin_slot", 0)))
            continue
        m[int(l[0])] = (int(l[1]), int(l[2]))
    return m


def extract_widgets(node: dict) -> dict:
    """把 widgets_values 映射成 {输入名: 值}。"""
    inputs: dict = {}
    wv = node.get("widgets_values")
    wins = [
        i
        for i in (node.get("inputs") or [])
        if isinstance(i, dict) and isinstance(i.get("widget"), dict)
    ]
    if not wins or wv is None:
        return inputs

    if isinstance(wv, dict):
        for i in wins:
            name = i["widget"].get("name") or i.get("name")
            if name in wv:
                inputs[name] = wv[name]
    elif isinstance(wv, list):
        for idx, i in enumerate(wins):
            if idx >= len(wv):
                break
            # 注意：这里不能提前 continue 打乱索引，wv 是按 wins 顺序排的
            if i.get("type") in IGNORE_WIDGET_TYPES:
                continue
            name = i["widget"].get("name") or i.get("name")
            inputs[name] = wv[idx]
    return inputs


def convert(ui: dict) -> tuple[dict, list[str]]:
    """UI -> API。返回 (prompt, 被跳过的节点描述)。"""
    linkmap = build_linkmap(ui)
    nodes: dict[str, dict] = {}
    skipped: list[str] = []

    for n in ui.get("nodes") or []:
        t = n.get("type")
        nid = n.get("id")
        if not t or t in SKIP_TYPES:
            continue
        if int(n.get("mode", 0)) in MUTE_MODES:
            skipped.append(f"{nid} {t} (mode={n.get('mode')})")
            continue

        inputs = extract_widgets(n)

        # 连线覆盖 widget 值
        for i in n.get("inputs") or []:
            if not isinstance(i, dict):
                continue
            lid = i.get("link")
            if lid is None:
                continue
            if lid not in linkmap:
                skipped.append(f"{nid} {t}: link {lid} 找不到源，已忽略")
                continue
            onid, oslot = linkmap[lid]
            inputs[i["name"]] = [str(onid), int(oslot)]

        nodes[str(nid)] = {"class_type": t, "inputs": inputs}

    return nodes, skipped


def find_outputs(nodes: dict) -> list[str]:
    """找真正接了线的输出节点。

    排除「悬空输出」：UI 里常有多个 VHS_VideoCombine，只有一个接了 images/audio。
    没接线的那个提交上去必然报 required input missing。
    """
    outs: list[str] = []
    for nid, n in nodes.items():
        if n["class_type"] not in OUTPUT_CLASSES:
            continue
        if any(isinstance(v, list) and len(v) == 2 for v in n["inputs"].values()):
            outs.append(nid)
    return outs


def prune(nodes: dict, outputs: list[str]) -> dict:
    """从输出节点反向 BFS，只保留可达节点。"""
    keep: set[str] = set()
    q: deque[str] = deque(outputs)
    while q:
        nid = q.popleft()
        if nid in keep or nid not in nodes:
            continue
        keep.add(nid)
        for v in nodes[nid]["inputs"].values():
            if isinstance(v, list) and len(v) == 2 and isinstance(v[0], str):
                q.append(v[0])
    return {k: v for k, v in nodes.items() if k in keep}


def drop_classes(nodes: dict, classes: set[str]) -> list[str]:
    gone = [k for k, v in nodes.items() if v["class_type"] in classes]
    for k in gone:
        nodes.pop(k, None)
    return gone


def drop_dangling(nodes: dict) -> list[str]:
    """删掉指向已不存在节点的输入键（例如 drop 掉 LoadImage 后的 ref_images.*）。"""
    removed: list[str] = []
    for nid, n in nodes.items():
        bad = [
            k
            for k, v in n["inputs"].items()
            if isinstance(v, list)
            and len(v) == 2
            and isinstance(v[0], str)
            and v[0] not in nodes
        ]
        for k in bad:
            removed.append(f"{nid} {n['class_type']}.{k}")
            del n["inputs"][k]
    return removed


def get_options(spec: dict, key: str) -> list | None:
    """取某个输入的可选值列表（combo）；不是 combo 则返回 None。

    /object_info 里 combo 有两种写法，都要认：
        旧: "task_type": [["auto", "T2VA", ...], {...}]     <- 选项在 [0]
        新: "task_type": ["COMBO", {"options": [...]}]      <- 选项在 [1].options
    """
    for sect in ("required", "optional"):
        d = (spec.get("input") or {}).get(sect) or {}
        if key not in d:
            continue
        t = d[key]
        if not isinstance(t, list) or not t:
            return None
        if len(t) >= 2 and isinstance(t[1], dict) and "options" in t[1]:
            return list(t[1]["options"])
        if isinstance(t[0], list):
            return list(t[0])
        return None
    return None


def fix_combos(nodes: dict, info: dict) -> list[str]:
    """校验所有 combo 取值，并把前端 label 纠回 API 认识的值。

    前端会把 "Ref2VA" 显示成 "Ref2VA — 参考生音视频"，而 widgets_values 里存的
    是显示名。直接提交会报 value_not_in_list。这里按"选项前缀"反推真值。
    """
    notes: list[str] = []
    for nid, n in nodes.items():
        spec = info.get(n["class_type"])
        if not spec:
            continue
        for key, val in list(n["inputs"].items()):
            if not isinstance(val, str):
                continue
            opts = get_options(spec, key)
            if opts is None or val in opts:
                continue
            cand = next((o for o in opts if o and val.startswith(o)), None)
            if cand is None:
                cand = next(
                    (o for o in opts if o and (o in val or val in o)), None
                )
            if cand is not None:
                n["inputs"][key] = cand
                notes.append(f"修正 {nid}.{key}: {val!r} -> {cand!r}")
            else:
                notes.append(
                    f"⚠️ {nid}.{key}: {val!r} 不在 {opts} 里，无法推断，"
                    "提交时会报 value_not_in_list"
                )
    return notes


def main() -> int:
    ap = argparse.ArgumentParser(description="UI 格式工作流 -> API 格式 prompt")
    ap.add_argument("ui_json", help="画布工作流（UI 格式）")
    ap.add_argument("--out", required=True, help="输出 API 格式 JSON")
    ap.add_argument(
        "--output",
        action="append",
        default=[],
        help="指定输出节点 id（可多次）。不给则自动识别接了线的输出节点。",
    )
    ap.add_argument(
        "--drop-class",
        action="append",
        default=[],
        help="删掉指定 class_type（可多次）。如 --drop-class LoadImage",
    )
    ap.add_argument("--no-prune", action="store_true", help="不剪枝，保留全部节点")
    ap.add_argument(
        "--no-validate",
        action="store_true",
        help="不拉 /object_info 校验 combo 取值（默认会校验并自动修正 label/value 不一致）",
    )
    ap.add_argument(
        "--set",
        action="append",
        default=[],
        help="覆盖节点输入，形如 4.unet_name=xxx.safetensors（可多次）。值会尝试按 JSON 解析。",
    )
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    ui = load_ui(args.ui_json)
    print(f"读入画布：{Path(args.ui_json).name}")
    print(f"  节点 {len(ui.get('nodes') or [])} 个，连线 {len(ui.get('links') or [])} 条\n")

    nodes, skipped = convert(ui)
    print(f"转换后：{len(nodes)} 个 API 节点")
    if skipped:
        print(f"  跳过 / 异常 {len(skipped)} 条：")
        for s in skipped:
            print(f"    - {s}")

    if not args.no_prune:
        outputs = args.output or find_outputs(nodes)
        if not outputs:
            print("❌ 找不到接了线的输出节点，请用 --output 指定")
            return 1
        print(f"\n输出节点：{outputs}")
        before = len(nodes)
        nodes = prune(nodes, outputs)
        print(f"剪枝：{before} -> {len(nodes)} 个节点")

    if args.drop_class:
        gone = drop_classes(nodes, set(args.drop_class))
        print(f"\n删除 {args.drop_class}：{len(gone)} 个节点 {gone}")
        dangling = drop_dangling(nodes)
        if dangling:
            print(f"  顺带清掉 {len(dangling)} 个悬空输入：")
            for d in dangling:
                print(f"    - {d}")

    for spec in args.set:
        nid, _, rest = spec.partition(".")
        key, _, val = rest.partition("=")
        if nid not in nodes:
            print(f"⚠️ --set {spec}: 节点 {nid} 不存在，已忽略")
            continue
        try:
            value = json.loads(val)
        except json.JSONDecodeError:
            value = val
        nodes[nid]["inputs"][key] = value
        print(f"--set {nid}.{key} = {value!r}")

    if not args.no_validate:
        try:
            print("\n拉取 /object_info 校验 combo 取值 ...")
            info = fetch_object_info()
            notes = fix_combos(nodes, info)
            if notes:
                print(f"  修正 / 告警 {len(notes)} 条：")
                for x in notes:
                    print(f"    {x}")
            else:
                print("  所有 combo 取值都合法")
        except Exception as e:  # noqa: BLE001
            print(f"  ⚠️ 跳过校验（{type(e).__name__}: {e}）")

    # 按数字 id 排序输出，方便人读
    def key(k: str):
        return (0, int(k)) if k.isdigit() else (1, k)

    ordered = {k: nodes[k] for k in sorted(nodes, key=key)}

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(ordered, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"\n✅ 写出 {out}（{len(ordered)} 个节点）")

    if not args.quiet:
        print("\n节点清单：")
        for k, v in ordered.items():
            linked = sum(1 for x in v["inputs"].values() if isinstance(x, list))
            print(f"  {k:>4}  {v['class_type']:<46} 输入 {len(v['inputs']):>2}（连线 {linked}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

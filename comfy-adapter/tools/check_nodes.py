"""检查工作流需要的节点类在本机 ComfyUI 里是否都存在。

用法:
    python tools/check_nodes.py                # 检查内置清单
    python tools/check_nodes.py 类名1 类名2 ...  # 检查指定类名
    python tools/check_nodes.py --wf 工作流.json # 从 UI 工作流提取并检查
"""
from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from adp import harden_stdout  # noqa: E402

harden_stdout()

COMFY = "http://127.0.0.1:8188"

# 用户「双采参考生视频 V3」工作流用到的全部节点类
WORKFLOW_NODES = [
    "UNETLoader",
    "CLIPLoader",
    "VAELoader",
    "LoadImage",
    "RandomNoise",
    "BasicGuider",
    "SamplerCustomAdvanced",
    "LoraLoaderModelOnly",
    "LoraLoaderBypassModelOnly",
    "MiniMaxH3AudioConditioningT8",
    "MiniMaxH3DualClockSamplerT8",
    "MiniMaxH3AVDecodeT8",
    "MiniMaxH3TwoPassLatentReconcileT8Advanced",
    "MiniMaxH3TwoPassDetailMixerT8Advanced",
    "MiniMaxH3LearnedTwoPassParityPlanT8Advanced",
    "MiniMaxH3LearnedLatentUpscaleT8Advanced",
    "MiniMaxH3MemoryEfficientSageAttentionPatch",
    "ModelAttentionBackend",
    "SolAttnMiniMax",
    "ComfyMathExpression",
    "ResolutionSelector",
    "PrimitiveFloat",
    "Float",
    "easy anythingIndexSwitch",
    "ConcatTextOfUtils",
    "CR Prompt Text",
    "VHS_VideoCombine",
]


def fetch_object_info() -> dict:
    with urllib.request.urlopen(f"{COMFY}/object_info", timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def main() -> int:
    args = sys.argv[1:]
    names: list[str] = []

    if args and args[0] == "--wf":
        wf = json.loads(Path(args[1]).read_text(encoding="utf-8-sig"))
        seen: dict[str, int] = {}
        for n in wf.get("nodes", []):
            t = n.get("type")
            if t:
                seen[t] = seen.get(t, 0) + 1
        names = sorted(seen)
        print(f"从 {Path(args[1]).name} 提取到 {len(names)} 种节点类型\n")
    elif args and args[0] == "--api":
        wf = json.loads(Path(args[1]).read_text(encoding="utf-8-sig"))
        seen = {v.get("class_type") for v in wf.values() if isinstance(v, dict)}
        names = sorted(x for x in seen if x)
        print(f"从 {Path(args[1]).name} 提取到 {len(names)} 种节点类型\n")
    else:
        names = args or WORKFLOW_NODES

    print("拉取 /object_info ...")
    info = fetch_object_info()
    print(f"本机共注册 {len(info)} 个节点类\n")

    ok, bad = [], []
    for n in names:
        (ok if n in info else bad).append(n)

    print(f"✅ 存在 {len(ok)} 个")
    for n in ok:
        mod = (info[n].get("python_module") or info[n].get("category") or "?")
        print(f"    {n:<48} <- {mod}")

    if bad:
        print(f"\n❌ 缺失 {len(bad)} 个")
        for n in bad:
            print(f"    {n}")
        return 1

    print("\n全部齐全 🎉")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

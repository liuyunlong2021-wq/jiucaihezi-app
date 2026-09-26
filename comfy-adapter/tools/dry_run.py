"""干跑（dry run）：不提交任务，只看参数会被如何归一化、模板会被渲染成什么。

调尺寸/参数时很有用 —— 比如想知道 4032x3024 会被钳成多少。

用法:
    python tools/dry_run.py --size 1920x1080 --prompt "x"
    python tools/dry_run.py --size 4032x3024 --prompt "x"
    python tools/dry_run.py --n 4 --steps 20 --seed 123 --prompt "x"
    python tools/dry_run.py --prompt "x" --ref-image 1 --ref-image 2   # 模拟 2 张参考图
    python tools/dry_run.py --prompt "x" --full                        # 打印完整 API prompt
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from adp.config import load_config  # noqa: E402
from adp.template import load_templates  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=None)
    ap.add_argument("--model", default="qwen-image-2.1")
    ap.add_argument("--prompt", default="test prompt")
    ap.add_argument("--size", default=None)
    ap.add_argument("--width", type=int, default=None)
    ap.add_argument("--height", type=int, default=None)
    ap.add_argument("--n", type=int, default=1)
    ap.add_argument("--steps", type=int, default=None)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--resolution", type=int, default=None)
    ap.add_argument("--ref-image", action="append", default=[],
                    help="模拟参考图（值随便给，只是占位）；给定即视为编辑请求")
    ap.add_argument("--first-frame", action="store_true", help="模拟首帧图输入")
    ap.add_argument("--last-frame", action="store_true", help="模拟尾帧图输入")
    ap.add_argument("--length", type=int, default=None, help="视频帧数")
    ap.add_argument("--duration", type=float, default=None, help="视频秒数（模板内部换算成帧）")
    ap.add_argument("--mode", type=int, default=None, help="模板自定义档位（如 ref2v 文戏=0 / 武戏=1）")
    ap.add_argument("--full", action="store_true", help="打印完整渲染后的 API prompt")
    args = ap.parse_args()

    cfg = load_config(args.config)
    tpl = load_templates(cfg.models).get(args.model)
    if tpl is None:
        print(f"!! 没有模型 {args.model}，可用: {sorted(load_templates(cfg.models))}")
        return 2

    raw = {"prompt": args.prompt, "n": args.n}
    for k in (
        "size",
        "width",
        "height",
        "steps",
        "seed",
        "resolution",
        "length",
        "duration",
        "mode",
    ):
        v = getattr(args, k, None)
        if v is not None:
            raw[k] = v

    values = tpl.normalize(raw, max_batch=cfg.limits.max_batch)

    if args.ref_image:
        values["reference_images"] = [
            f"adapter/uploads/fake{i1}.png" for i1 in range(1, len(args.ref_image) + 1)
        ]
    if args.first_frame:
        values["first_frame"] = ["adapter/uploads/fake_first.png"]
    if args.last_frame:
        values["last_frame"] = ["adapter/uploads/fake_last.png"]

    rendered = tpl.render(values)

    is_edit = bool(args.ref_image or args.first_frame or args.last_frame)
    print("=" * 74)
    print(f"模型: {tpl.id}   ({tpl.display_name})  产出类型: {tpl.output_kind}")
    print(f"默认异步: {tpl.default_async}")
    print(f"模式: {'带图输入' if is_edit else '纯文本'}")
    print("-" * 74)
    print("请求原样        :", json.dumps(raw, ensure_ascii=False))
    print("归一化后(注入模板):", json.dumps(values, ensure_ascii=False))
    print("-" * 74)
    print("约束:", json.dumps(tpl.constraints, ensure_ascii=False))
    print("默认值:", json.dumps(tpl.defaults, ensure_ascii=False))
    print("-" * 74)

    w, h = values.get("width"), values.get("height")
    if w and h:
        print(f"输出画布: {w} x {h}  = {w * h / 1e6:.2f} MP")
    if "resolution" in values:
        print(f"参考图缩放基准 resolution = {values['resolution']}"
              + ("  (无参考图时此值不生效)" if not is_edit else ""))
    if "duration" in values:
        print(f"时长 duration = {values['duration']} 秒（模板内部换算成帧数）")
    if "length" in values:
        print(f"视频帧数 length = {values['length']} 帧  ({values['length'] / 24:.2f} 秒 @24fps)")
    if "mode" in values:
        legend = (tpl.extra.get("mode_legend") or {}).get(str(values["mode"]))
        print(f"档位 mode = {values['mode']}" + (f"  ({legend})" if legend else ""))

    print(f"\n生成节点数: {len(rendered)} 个")
    if args.full:
        print(json.dumps(rendered, ensure_ascii=False, indent=2))
    else:
        # 只列动态生成出来的节点
        dyn = sorted(set(rendered) - set(tpl.prompt))
        if dyn:
            print("动态生成的节点:")
            for nid in dyn:
                print(f"   {nid}: {json.dumps(rendered[nid], ensure_ascii=False)}")
        else:
            print("动态生成的节点: 无")
        # 展示参考图接线（Qwen 是 images.image_N，MiniMax H3 是 ref_images.ref_image_N）
        for nid, node in rendered.items():
            keys = [
                k
                for k in (node.get("inputs") or {})
                if k.startswith("images.") or k.startswith("ref_images.")
            ]
            if keys:
                print(f"节点 {nid} ({node['class_type']}) 收到的参考图槽位: "
                      f"{sorted(keys, key=lambda s: int(s.rsplit('_', 1)[-1]))}")
    print("=" * 74)
    return 0


if __name__ == "__main__":
    sys.exit(main())

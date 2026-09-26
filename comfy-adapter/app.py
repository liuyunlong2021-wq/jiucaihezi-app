"""comfy-adapter 启动入口。

    python app.py                 # 启动服务（读 config.yaml）
    python app.py --check         # 只做自检：模板校验 + ComfyUI 连通性
    python app.py --list-models   # 打印已注册模型
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from adp import harden_stdout
from adp.api import create_app
from adp.comfy_client import ComfyClient, ComfyError
from adp.config import ROOT, load_config
from adp.template import load_templates


def _combo_options(spec: dict, key: str) -> list | None:
    """取节点某个输入的可选值（combo）。

    /object_info 里 combo 有两种写法，都要认：
        旧: "task_type": [["auto", "T2VA", ...], {...}]
        新: "task_type": ["COMBO", {"options": [...]}]
    只认一种会**静默漏检**。
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


def _is_model_file(val: str) -> bool:
    return val.endswith(
        (".safetensors", ".sft", ".ckpt", ".pt", ".pth", ".bin", ".gguf")
    )


def setup_logging(level: str) -> None:
    harden_stdout()
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)-7s | %(name)-14s | %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stdout,
    )


async def selfcheck(cfg) -> int:
    """模板静态校验 + ComfyUI 连通性 + 节点存在性校验。"""
    problems = 0

    print("=" * 78)
    print("1) 模板静态校验")
    try:
        templates = load_templates(cfg.models)
    except Exception as e:  # noqa: BLE001
        print(f"   [失败] 加载模板出错: {e}")
        return 1

    for tpl in templates.values():
        issues = tpl.validate()
        if issues:
            problems += len(issues)
            print(f"   [警告] {tpl.id}:")
            for i in issues:
                print(f"          - {i}")
        else:
            print(f"   [通过] {tpl.id}  ({tpl.display_name})  模板={tpl.source}")

    print("=" * 78)
    print(f"2) ComfyUI 连通性 ({cfg.comfy.base_url})")
    client = ComfyClient(
        cfg.comfy.base_url,
        client_id=cfg.comfy.client_id,
        poll_interval=cfg.comfy.poll_interval,
        submit_timeout=cfg.comfy.submit_timeout,
        job_timeout=cfg.comfy.job_timeout,
    )
    try:
        stats = await client.ping()
        devs = [d.get("name") for d in (stats.get("devices") or [])]
        print(f"   [通过] 在线，设备: {devs}")
        print(f"          版本: {(stats.get('system') or {}).get('comfyui_version')}")

        info = await client.object_info()
        print(f"          /object_info 节点类: {len(info)}")

        print("=" * 78)
        print("3) 模板里用到的节点类是否都在 ComfyUI 注册")
        for tpl in templates.values():
            classes = {n["class_type"] for n in tpl.prompt.values() if n.get("class_type")}
            # 动态块里声明的节点类也要一起校验
            classes |= {
                b["node_template"]["class_type"]
                for b in tpl.dynamic_blocks
                if (b.get("node_template") or {}).get("class_type")
            }
            missing = sorted(c for c in classes if c not in info)
            if missing:
                problems += len(missing)
                print(f"   [失败] {tpl.id} 缺节点: {missing}")
            else:
                print(f"   [通过] {tpl.id} 全部节点类已注册（{len(classes)} 个）")

        print("=" * 78)
        print("4) 模板引用的模型文件是否都存在")
        for tpl in templates.values():
            nodes = list(tpl.prompt.items())
            for blk in tpl.dynamic_blocks:
                ntpl = blk.get("node_template")
                if ntpl:
                    nodes.append((f"<{blk.get('param')}>", ntpl))
            bad: list[str] = []
            checked = 0
            for nid, node in nodes:
                spec = info.get(node.get("class_type"))
                if not spec:
                    continue
                for key, val in (node.get("inputs") or {}).items():
                    if not isinstance(val, str) or not _is_model_file(val):
                        continue
                    opts = _combo_options(spec, key)
                    if not opts:
                        continue
                    checked += 1
                    if val not in opts:
                        near = [o for o in opts if _is_model_file(o)]
                        bad.append(f"{nid}.{key}  写的: {val}")
                        bad.append(f"      可选: {near}")
            if bad:
                problems += 1
                print(f"   [失败] {tpl.id} 有模型文件不在 ComfyUI 列表里：")
                for b in bad:
                    print(f"          {b}")
            else:
                print(f"   [通过] {tpl.id} 检查 {checked} 个模型文件，全部存在")

    except ComfyError as e:
        print(f"   [失败] {e}")
        problems += 1
    finally:
        await client.aclose()

    print("=" * 78)
    print("自检结果:", "全部通过 ✅" if problems == 0 else f"发现 {problems} 个问题 ⚠️")
    return 0 if problems == 0 else 2


def main() -> None:
    ap = argparse.ArgumentParser(description="comfy-adapter")
    ap.add_argument("--config", default=None, help="配置文件路径，默认 ./config.yaml")
    ap.add_argument("--check", action="store_true", help="只做自检，不启动服务")
    ap.add_argument("--list-models", action="store_true", help="打印已注册模型")
    ap.add_argument("--host", default=None, help="覆盖监听地址")
    ap.add_argument("--port", type=int, default=None, help="覆盖监听端口")
    ap.add_argument("--reload", action="store_true", help="开发模式热重载")
    args = ap.parse_args()

    cfg = load_config(args.config)
    setup_logging(cfg.log_level)

    if args.list_models:
        for tpl in load_templates(cfg.models).values():
            print(f"{tpl.id:<24} {tpl.display_name:<24} {tpl.description}")
        return

    if args.check:
        sys.exit(asyncio.run(selfcheck(cfg)))

    host = args.host or cfg.server.host
    port = args.port or cfg.server.port
    logging.getLogger("adp").info("启动 comfy-adapter: http://%s:%s", host, port)
    logging.getLogger("adp").info("项目根目录: %s", ROOT)

    import uvicorn

    app = create_app(cfg)
    uvicorn.run(app, host=host, port=port, log_level=cfg.log_level.lower(), reload=args.reload)


if __name__ == "__main__":
    main()

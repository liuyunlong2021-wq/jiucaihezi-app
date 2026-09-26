"""从 deploy/*.example.toml 生成真实的隧道配置（含随机 token）。

生成物含密钥，已被 .gitignore 排除：
    deploy/frps.toml   —— 推到 VPS 的 /opt/frps/frps.toml
    deploy/frpc.toml   —— 本机 frpc 用

脚本不打印 token，只报长度，避免密钥进日志/聊天记录。

用法:
    python tools/init_tunnel_config.py                 # 已有配置时不覆盖
    python tools/init_tunnel_config.py --force          # 重新生成（换新 token，两端都要更新）
"""

from __future__ import annotations

import argparse
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEPLOY = ROOT / "deploy"

TOKEN_PLACEHOLDER = "<由 init_tunnel_config.py 生成>"
ADDR_PLACEHOLDER = "<由 init_tunnel_config.py 填入 VPS 公网 IP>"

# VPS 公网地址。写成常量而不是命令行参数，是为了让两端生成结果必然一致。
VPS_HOST = "47.82.86.196"


def generate(force: bool) -> int:
    token = secrets.token_hex(24)
    pairs = [
        ("frps.example.toml", "frps.toml", lambda t: t.replace(TOKEN_PLACEHOLDER, token)),
        (
            "frpc.example.toml",
            "frpc.toml",
            lambda t: t.replace(TOKEN_PLACEHOLDER, token).replace(ADDR_PLACEHOLDER, VPS_HOST),
        ),
    ]

    written: list[str] = []
    for example_name, real_name, apply in pairs:
        example = DEPLOY / example_name
        real = DEPLOY / real_name
        if real.exists() and not force:
            print(f"跳过 {real_name}（已存在，要重生成加 --force）")
            continue
        real.write_text(apply(example.read_text(encoding="utf-8")), encoding="utf-8")
        written.append(real_name)

    print(f"token 长度: {len(token)}（未打印）")
    for name in written:
        print(f"已生成: deploy/{name}")
    if not written:
        return 1

    # 生成后自检：不应再残留占位符
    for name in ("frps.toml", "frpc.toml"):
        text = (DEPLOY / name).read_text(encoding="utf-8")
        for placeholder in (TOKEN_PLACEHOLDER, ADDR_PLACEHOLDER):
            if placeholder in text:
                print(f"!! {name} 仍残留占位符 {placeholder}")
                return 1
    print("自检通过：两端 token 一致，且无残留占位符")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="已有配置也重新生成（换新 token）")
    args = parser.parse_args()
    return generate(args.force)


if __name__ == "__main__":
    raise SystemExit(main())

"""自检：参考图下载代理配置能被读到并生效（不需要启动适配器）。

用法: python tools/check_fetch_proxy.py
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from adp import images  # noqa: E402
from adp.config import load_config  # noqa: E402


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        cfg_path = Path(tmp) / "config.yaml"
        cfg_path.write_text('edit:\n  fetch_proxy: " http://127.0.0.1:7897 "\n', encoding="utf-8")
        assert load_config(cfg_path).edit.fetch_proxy == " http://127.0.0.1:7897 "  # 原样读入，清洗交给 set_fetch_proxy
        cfg_path.write_text("edit:\n  fetch_url_timeout: 30\n", encoding="utf-8")
        assert load_config(cfg_path).edit.fetch_proxy == ""

    images.set_fetch_proxy("  ")
    assert images._fetch_proxy is None, "空值必须回落到 httpx 环境变量"
    images.set_fetch_proxy(" http://127.0.0.1:7897 ")
    assert images._fetch_proxy == "http://127.0.0.1:7897"
    print("fetch_proxy ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

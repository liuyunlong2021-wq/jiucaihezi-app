"""读取 safetensors 的 header，统计 dtype 分布，用来判断量化精度。

safetensors 格式：前 8 字节（小端 uint64）= header JSON 长度，随后是 header JSON。
header 里每个 tensor 形如 {"dtype":"BF16","shape":[...],"data_offsets":[...]}。
"""

import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from adp import harden_stdout  # noqa: E402

harden_stdout()

ROOT = Path(r"D:\ComfyUI-aki-v3\ComfyUI\models")


def inspect(path: Path) -> None:
    with open(path, "rb") as f:
        n = struct.unpack("<Q", f.read(8))[0]
        hdr = json.loads(f.read(n))

    per: dict[str, int] = {}
    total = 0
    for k, v in hdr.items():
        if k == "__metadata__":
            continue
        size = v["data_offsets"][1] - v["data_offsets"][0]
        per[v["dtype"]] = per.get(v["dtype"], 0) + size
        total += size

    gb = path.stat().st_size / 1024**3
    print(f"\n=== {path.name}  ({gb:.2f} GB, {total / 1024**3:.2f} GB 权重) ===")
    for dt, b in sorted(per.items(), key=lambda x: -x[1]):
        print(f"    {dt:<10} {b / 1024**3:8.2f} GB   {b / total * 100:5.1f}%")

    # 量化模型通常带 scale / qweight 之类的名字
    q_names = [
        k
        for k in hdr
        if k != "__metadata__"
        and any(t in k.lower() for t in ("scale", "zero_point", "qweight", "quant"))
    ]
    print(f"    量化相关张量: {len(q_names)} 个", q_names[:3])

    meta = hdr.get("__metadata__") or {}
    if meta:
        print(f"    metadata: {dict(list(meta.items())[:8])}")


if __name__ == "__main__":
    args = sys.argv[1:]
    if args:
        targets = [ROOT / a for a in args]
    else:
        targets = sorted((ROOT / "diffusion_models").glob("*.safetensors"))
    for p in targets:
        if p.exists():
            inspect(p)
        else:
            print(f"!! 找不到 {p}")

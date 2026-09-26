"""查看视频文件的规格，并可抽出某一帧。

用途：验证生成的 mp4 是否符合预期（分辨率/帧率/时长/有无音轨），
以及把某一帧抽出来对比（比如图生视频有没有真的用上首帧）。

用 ComfyUI 那个 venv 跑，因为 ffmpeg 是 imageio-ffmpeg 带来的：
    & "D:\\Comfy-Desktop\\ComfyUI-Installs\\ComfyUI\\ComfyUI\\.venv\\Scripts\\python.exe" tools/video_info.py <mp4> [--frame 0] [--out x.png]
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from adp import harden_stdout  # noqa: E402

harden_stdout()


def ffmpeg_exe() -> str:
    try:
        import imageio_ffmpeg
    except ImportError:
        print("!! 没装 imageio-ffmpeg。用 ComfyUI 的 venv 跑这个脚本即可：")
        print('   & "D:\\Comfy-Desktop\\ComfyUI-Installs\\ComfyUI\\ComfyUI\\.venv\\Scripts\\python.exe" tools/video_info.py ...')
        sys.exit(2)
    return imageio_ffmpeg.get_ffmpeg_exe()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--frame", type=int, default=None, help="抽出第 N 帧（0 基）")
    ap.add_argument("--out", default=None, help="抽帧输出路径")
    args = ap.parse_args()

    path = Path(args.file)
    if not path.is_file():
        print(f"!! 文件不存在: {path}")
        return 1

    exe = ffmpeg_exe()
    print(f"文件: {path.name}   {path.stat().st_size / 1024:.1f} KB")

    out = subprocess.run([exe, "-i", str(path)], capture_output=True, text=True).stderr
    for line in out.splitlines():
        s = line.strip()
        if "Duration" in s or "Stream #" in s:
            print("  " + s)

    if args.frame is not None:
        dst = Path(args.out) if args.out else path.with_name(f"{path.stem}_frame{args.frame}.png")
        r = subprocess.run(
            [exe, "-y", "-i", str(path), "-vf", f"select=eq(n\\,{args.frame})", "-vframes", "1", str(dst)],
            capture_output=True,
            text=True,
        )
        if r.returncode == 0 and dst.is_file():
            print(f"\n已抽出第 {args.frame} 帧 -> {dst}")
        else:
            print(f"\n!! 抽帧失败: {r.stderr[-400:]}")
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

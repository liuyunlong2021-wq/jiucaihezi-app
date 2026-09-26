"""端到端冒烟测试：/health -> /v1/models -> /v1/images/generations -> 存图。

用法:
    python tools/smoke_test.py
    python tools/smoke_test.py --model qwen-image-2.1 --prompt "一只戴墨镜的柴犬" --size 1024x1024
    python tools/smoke_test.py --url-mode        # 测 response_format=url
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from adp import harden_stdout  # noqa: E402

harden_stdout()

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"


def call(url: str, payload: dict | None = None, key: str | None = None, timeout: int = 1800):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET")
    req.add_header("Content-Type", "application/json")
    if key:
        req.add_header("Authorization", f"Bearer {key}")
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            code = r.status
    except urllib.error.HTTPError as e:
        body = e.read()
        code = e.code
    return code, body, time.monotonic() - t0


def encode_multipart(fields: dict[str, str], files: list[tuple[str, str, bytes]]):
    """手工拼 multipart/form-data（不依赖第三方库）。"""
    boundary = "----comfyadapter" + uuid.uuid4().hex
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        )
    for field, filename, data in files:
        chunks.append(
            (
                f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; '
                f'filename="{filename}"\r\n'
                f"Content-Type: application/octet-stream\r\n\r\n"
            ).encode()
        )
        chunks.append(data)
        chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def data_url(path: Path) -> str:
    """把本地图片包成 data URL。"""
    return "data:application/octet-stream;base64," + base64.b64encode(path.read_bytes()).decode()


_CT_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/wav": ".wav",
}


def _ext_for(item: dict) -> str:
    """按 content_type / URL 后缀 / kind 推断落盘扩展名。"""
    ct = str(item.get("content_type") or "").lower()
    if ct in _CT_EXT:
        return _CT_EXT[ct]
    url = str(item.get("url") or "")
    suf = Path(url.split("?", 1)[0]).suffix.lower()
    if suf:
        return suf
    return {"video": ".mp4", "audio": ".m4a"}.get(str(item.get("kind") or ""), ".png")


def call_multipart(url: str, fields: dict[str, str], paths: list[Path],
                   key: str | None = None, timeout: int = 1800):
    files = [("image", p.name, p.read_bytes()) for p in paths]
    body, ctype = encode_multipart(fields, files)
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", ctype)
    if key:
        req.add_header("Authorization", f"Bearer {key}")
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), time.monotonic() - t0
    except urllib.error.HTTPError as e:
        return e.code, e.read(), time.monotonic() - t0


def show(title: str, code: int, body: bytes, elapsed: float) -> dict | None:
    print(f"\n--- {title} ---")
    print(f"HTTP {code}  用时 {elapsed:.2f}s")
    try:
        obj = json.loads(body)
    except Exception:  # noqa: BLE001
        print(body[:800].decode("utf-8", "replace"))
        return None
    if code != 200:
        print(json.dumps(obj, ensure_ascii=False, indent=2)[:2000])
        return None
    brief = {k: v for k, v in obj.items() if k != "data"}
    print(json.dumps(brief, ensure_ascii=False)[:1200])
    if isinstance(obj.get("data"), list):
        print(f"data: {len(obj['data'])} 个条目 -> {[list(d.keys()) for d in obj['data']]}")
    return obj


def poll_task(base: str, task_id: str, key: str | None, timeout: int, interval: float = 2.0):
    """轮询 GET /v1/tasks/{id} 直到终态。"""
    deadline = time.monotonic() + timeout
    last = None
    t0 = time.monotonic()
    while time.monotonic() < deadline:
        code, body, _ = call(f"{base}/v1/tasks/{task_id}", key=key, timeout=60)
        if code != 200:
            print(f"   轮询失败 HTTP {code}: {body[:200].decode('utf-8', 'replace')}")
            return code, body
        obj = json.loads(body)
        st = obj.get("status")
        if st != last:
            print(f"   [{time.monotonic() - t0:6.1f}s] status={st}  "
                  f"elapsed={obj.get('elapsed_seconds')}")
            last = st
        if st in ("succeeded", "failed", "cancelled"):
            return 200, body
        time.sleep(interval)
    print("   !! 轮询超时")
    return 504, b"{}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:9000")
    ap.add_argument("--key", default=None, help="API Key（config.yaml 里配的）")
    ap.add_argument("--model", default="qwen-image-2.1")
    ap.add_argument("--prompt", default="a red panda barista pulling espresso in a bamboo cafe, cinematic lighting, 85mm photo")
    ap.add_argument("--size", default="1024x1024")
    ap.add_argument("--n", type=int, default=1)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--steps", type=int, default=None)
    ap.add_argument("--length", type=int, default=None, help="视频帧数（24fps，H3 会自动对齐 17n+5）")
    ap.add_argument("--duration", type=float, default=None, help="视频秒数（模板内部换算成帧数）")
    ap.add_argument("--mode", type=int, default=None, help="模板自定义档位，如 ref2v 的 0=文戏 / 1=武戏")
    ap.add_argument("--ref-image", action="append", default=[],
                    help="参考图本地路径（自动转 data URL 放进 images）；可重复给多张")
    ap.add_argument("--ref-glob", default=None,
                    help="参考图通配符（自动展开并排序），如 'D:\\out\\ComfyUI_0000*_.png'")
    ap.add_argument("--video", action="store_true", help="走 POST /v1/videos/generations")
    ap.add_argument("--first-frame", default=None, help="首帧图本地路径（图生视频）")
    ap.add_argument("--negative-prompt", default=None)
    ap.add_argument("--url-mode", action="store_true", help="用 response_format=url")
    ap.add_argument("--edits", action="store_true",
                    help="走 POST /v1/images/edits（multipart 参考图）")
    ap.add_argument("--image", action="append", default=[],
                    help="参考图本地路径，可重复给多张；配 --edits 用")
    ap.add_argument("--reference-url", action="append", default=[],
                    help="参考图 URL / data URL；走 JSON 版 images 数组")
    ap.add_argument("--async-mode", dest="use_async", action="store_true",
                    help="用异步任务接口：提交拿 task id，再轮询 /v1/tasks/{id}")
    ap.add_argument("--poll-interval", type=float, default=2.0, help="异步轮询间隔（秒）")
    args = ap.parse_args()

    base = args.base.rstrip("/")

    if args.ref_glob:
        import glob as _glob

        found = sorted(_glob.glob(args.ref_glob))
        if not found:
            print(f"!! --ref-glob 没匹配到文件: {args.ref_glob}")
            return 2
        args.ref_image.extend(found)
        print(f"通配符 -> {len(found)} 张: {[Path(p).name for p in found]}")

    code, body, el = call(f"{base}/health", key=args.key, timeout=30)
    health = show("GET /health", code, body, el)
    if health is None:
        print("!! /health 不通过，中止")
        return 2
    if health.get("comfyui") != "ok":
        print("!! ComfyUI 不在线，中止")
        return 2

    code, body, el = call(f"{base}/v1/models", key=args.key, timeout=30)
    models = show("GET /v1/models", code, body, el)
    if models is None or args.model not in [m["id"] for m in models["data"]]:
        print(f"!! 模型 {args.model} 不在列表里")
        return 2

    payload = {
        "model": args.model,
        "prompt": args.prompt,
        "n": args.n,
        "size": args.size,
        "response_format": "url" if args.url_mode else "b64_json",
    }
    if args.seed is not None:
        payload["seed"] = args.seed
    if args.steps is not None:
        payload["steps"] = args.steps
    if args.length is not None:
        payload["length"] = args.length
    if args.duration is not None:
        payload["duration"] = args.duration
    if args.mode is not None:
        payload["mode"] = args.mode
    if args.negative_prompt:
        payload["negative_prompt"] = args.negative_prompt
    if args.first_frame:
        payload["first_frame"] = data_url(Path(args.first_frame))

    if args.edits:
        refs = [Path(p) for p in args.image]
        missing = [str(p) for p in refs if not p.exists()]
        if missing:
            print(f"!! 找不到参考图: {missing}")
            return 2
        if not refs and not args.reference_url:
            print("!! --edits 至少要给一张参考图（--image 或 --reference-url）")
            return 2
        fields = {
            "model": args.model,
            "prompt": args.prompt,
            "n": str(args.n),
            "size": args.size,
            "response_format": payload["response_format"],
        }
        if args.seed is not None:
            fields["seed"] = str(args.seed)
        if args.steps is not None:
            fields["steps"] = str(args.steps)
        if args.length is not None:
            fields["length"] = str(args.length)
        if args.first_frame:
            fields["first_frame"] = data_url(Path(args.first_frame))
        if args.negative_prompt:
            fields["negative_prompt"] = args.negative_prompt
        if args.reference_url:
            fields["images"] = json.dumps(args.reference_url)
        if args.use_async:
            fields["async"] = "true"
        print("\nmultipart 字段:", json.dumps(fields, ensure_ascii=False))
        if refs:
            print("参考图文件:", [f"{p.name} ({p.stat().st_size:,} 字节)" for p in refs])
        if args.reference_url:
            print("参考图 URL :", args.reference_url)
        code, body, el = call_multipart(f"{base}/v1/images/edits", fields, refs, args.key)
        endpoint = "images/edits"
    else:
        # 本地参考图先转 data URL，和 --reference-url 一起塞进 images 数组
        local_refs: list[str] = []
        for p in args.ref_image:
            fp = Path(p)
            if not fp.exists():
                print(f"!! 找不到参考图: {fp}")
                return 2
            local_refs.append(data_url(fp))
        imgs = list(args.reference_url) + local_refs
        if imgs:
            payload["images"] = imgs
        if args.use_async:
            payload["async"] = True
        shown = dict(payload)
        if imgs:
            shown["images"] = f"<{len(imgs)} 个参考图>"
        print("\n请求体:", json.dumps(shown, ensure_ascii=False))
        if args.ref_image:
            print("参考图文件:",
                  [f"{p} ({Path(p).stat().st_size:,} 字节)" for p in args.ref_image])
        if args.video:
            code, body, el = call(f"{base}/v1/videos/generations", payload, args.key)
            endpoint = "videos/generations"
        else:
            code, body, el = call(f"{base}/v1/images/generations", payload, args.key)
            endpoint = "images/generations"

    # 异步模式：先拿到 task id，再轮询到终态
    # 提交固定回 200（NewAPI 只认 200）；旧版本曾回 202，这里两种都接受。
    if args.use_async and code in (200, 202):
        submit = json.loads(body)
        task_id = submit.get("id")
        print(f"\n--- POST /v1/{endpoint} (async) ---")
        print(f"HTTP {code}  用时 {el:.2f}s  →  task_id = {task_id}")
        print(f"   提交时状态: {submit.get('status')}")
        print(f"\n--- 轮询 GET /v1/tasks/{task_id} ---")
        code, body = poll_task(base, task_id, args.key, timeout=1800,
                               interval=args.poll_interval)
        el = 0.0

    result = show(f"POST /v1/{endpoint}", code, body, el)
    if result is None:
        print("!! 生成失败")
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    saved: list[Path] = []
    for i, item in enumerate(result.get("data") or []):
        ext = _ext_for(item)
        name = f"{args.model.replace('.', '_')}-{int(time.time())}-{i}{ext}"
        path = OUT_DIR / name
        if "b64_json" in item:
            path.write_bytes(base64.b64decode(item["b64_json"]))
        elif "url" in item:
            with urllib.request.urlopen(item["url"], timeout=300) as r:
                path.write_bytes(r.read())
        else:
            print(f"   第 {i} 个条目没有产出数据: {list(item.keys())}")
            continue
        saved.append(path)
        print(f"   已保存 {path}  ({path.stat().st_size:,} 字节)")

    if not saved:
        print("!! 没有拿到任何产出")
        return 1

    print(f"\n✅ 全流程通过，共 {len(saved)} 个，端到端 {el:.2f}s")
    print(f"   服务端自报耗时: {result.get('elapsed_seconds')}s  prompt_id={result.get('prompt_id')}")
    print(f"   实际参数: {result.get('params')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
JC Media — 韭菜盒子统一媒体生成执行层。

OpenAI 兼容协议 → NewAPI（鉴权计费多渠道路由）→ rh-adapter / T8 / 火山 / RH。
上游 film skill 产出完整 prompt + model → 本脚本提交 → 轮询 → 下载 → JSON 输出。

仅依赖 Python stdlib + curl。
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path


# ── 配置 ──────────────────────────────────────────────

DEFAULT_HOST = os.environ.get("JC_MEDIA_HOST", "http://127.0.0.1:8789")
MAX_POLL_SECONDS = int(os.environ.get("JC_POLL_SECONDS", "1200"))
POLL_INTERVAL = int(os.environ.get("JC_POLL_INTERVAL", "5"))


# ── Key 解析 ───────────────────────────────────────────

def resolve_key(cli_key: str | None = None) -> str:
    """按优先级解析 API Key：CLI --key → 环境变量 → 本地文件 → 代理模式占位"""
    if cli_key:
        return cli_key

    # 1. JC_API_KEY 环境变量
    env_key = os.environ.get("JC_API_KEY")
    if env_key:
        return env_key

    # 2. ~/.jiucaihezi/.jc_api_key（APP 登录后自动写入）
    key_file = Path.home() / ".jiucaihezi" / ".jc_api_key"
    try:
        if key_file.exists():
            file_key = key_file.read_text().strip()
            if file_key and not file_key.startswith("jc-"):
                return file_key
    except OSError:
        pass

    # 3. 代理模式占位 Key，由 rh-adapter 服务器端注入真实 Key
    return "jc-auto"


# ── HTTP helpers (curl, stdlib only) ────────────────────

def _curl(method: str, url: str, headers: dict, body: dict | None = None,
          timeout: int = 60, form_file: str | None = None) -> dict:
    cmd = ["curl", "-s", "-S", "--fail-with-body", "-X", method, url,
           "--max-time", str(timeout)]
    for k, v in headers.items():
        cmd += ["-H", f"{k}: {v}"]

    if form_file:
        cmd += ["-F", f"file=@{form_file}"]
    elif body:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(body, f)
            tmp = f.name
        try:
            cmd += ["-d", f"@{tmp}"]
            result = subprocess.run(cmd, capture_output=True, text=True)
        finally:
            os.unlink(tmp)
    else:
        result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        err = result.stdout or result.stderr
        try:
            return json.loads(err)
        except (json.JSONDecodeError, TypeError):
            return {"error": "HTTP_ERROR", "message": err[:500]}
    try:
        return json.loads(result.stdout)
    except (json.JSONDecodeError, TypeError):
        return {"raw": result.stdout[:500]}


def _download(url: str, output: str) -> bool:
    result = subprocess.run(
        ["curl", "-s", "-S", "-L", "-o", output, url, "--max-time", "300"],
        capture_output=True, text=True
    )
    return result.returncode == 0 and Path(output).exists()


UPLOAD_THRESHOLD = 5 * 1024 * 1024  # 5MB


def _data_uri(file_path: str) -> str | None:
    """文件转 data URI（无视大小）。"""
    path = Path(file_path)
    if not path.exists():
        return None
    mime = mimetypes.guess_type(str(path))[0] or "image/png"
    b64 = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{b64}"


def _upload_to_rh(host: str, api_key: str, file_path: str) -> str:
    """大文件上传到 rh-adapter proxy → RH CDN，返回公网 URL。
    
    rh-adapter proxy 映射 openapi/v2/ → RunningHub 官方 API，
    并注入服务器端 RUNNINGHUB_API_KEY，用户无需自备 RH Key。
    """
    path = Path(file_path)
    mime = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    cmd = ["curl", "-s", "-S", "--fail-with-body", "-X", "POST",
           f"{host}/openapi/v2/media/upload/binary",
           "-F", f"file=@{file_path};type={mime}",
           "--max-time", "120"]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        err = result.stdout or result.stderr
        raise RuntimeError(f"Upload failed: {err[:300]}")
    try:
        data = json.loads(result.stdout)
        file_data = data.get("data", {})
        # RH 上传 API 返回 download_url 或 url
        url = (file_data.get("download_url") or file_data.get("downloadUrl") or
               file_data.get("url") or data.get("download_url") or data.get("url") or "")
        if not url:
            raise RuntimeError(f"Upload succeeded but no URL: {result.stdout[:300]}")
        return url
    except (json.JSONDecodeError, KeyError) as e:
        raise RuntimeError(f"Upload response parse error: {e}: {result.stdout[:200]}")


def _resolve_input(input_path: str, host: str, api_key: str) -> str:
    """智能解析输入路径：URL 直传，小文件转 data URI，大文件上传到 CDN。"""
    if input_path.startswith(("http://", "https://", "data:")):
        return input_path  # 已经是 URL 或 data URI，直接透传
    path = Path(input_path)
    if not path.exists():
        return input_path  # 文件不存在，原样透传（让服务器报错）
    if path.stat().st_size <= UPLOAD_THRESHOLD:
        return _data_uri(input_path) or input_path
    # 大文件：上传到 RH CDN
    return _upload_to_rh(host, api_key, input_path)


# ── 提交 + 轮询 + 下载 ──────────────────────────────────

def _parse_params(params_list: list[str]) -> dict:
    """--params key=value → dict。支持 --params ratio=16:9 duration=5"""
    result: dict = {}
    for p in params_list:
        if "=" in p:
            k, v = p.split("=", 1)
            # 自动类型转换
            if v.isdigit():
                result[k] = int(v)
            elif v.lower() in ("true", "false"):
                result[k] = v.lower() == "true"
            else:
                result[k] = v
    return result


def submit_image(api_key: str, model: str, prompt: str, input_path: str | None,
                 host: str, extra_params: dict | None = None) -> dict:
    """POST /v1/images/generations"""
    payload: dict = {"model": model, "prompt": prompt}
    if input_path:
        payload["images"] = [_resolve_input(input_path, host, api_key)]
    if extra_params:
        payload.update(extra_params)

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    return _curl("POST", f"{host}/v1/images/generations", headers, payload)


def submit_video(api_key: str, model: str, prompt: str, input_path: str | None,
                 host: str, video_path: str | None = None,
                 extra_params: dict | None = None) -> dict:
    """POST /v1/videos。--input 传参考图 → images 数组；--input-video 传参考视频 URL → video 字段"""
    payload: dict = {"model": model, "prompt": prompt}
    if input_path:
        payload["images"] = [_resolve_input(input_path, host, api_key)]
    if video_path:
        # video 字段必须是公网 URL，本地文件需上传
        payload["video"] = _resolve_input(video_path, host, api_key)
    if extra_params:
        payload.update(extra_params)

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    return _curl("POST", f"{host}/v1/videos", headers, payload)


def submit_audio(api_key: str, model: str, prompt: str, host: str) -> dict:
    """POST /v1/audio/speech"""
    payload = {"model": model, "input": prompt}
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    return _curl("POST", f"{host}/v1/audio/speech", headers, payload)


def poll_task(api_key: str, task_id: str, host: str, type_: str = "") -> dict:
    """轮询任务状态。rh-adapter: GET /tasks/{task_id}；NewAPI: GET /v1/videos/{task_id}"""
    headers = {"Authorization": f"Bearer {api_key}"}
    if "8789" in host or "127.0.0.1" in host or "localhost" in host:
        return _curl("GET", f"{host}/tasks/{task_id}", headers)
    # NewAPI Sora-compatible 轮询端点
    if type_ == "video":
        return _curl("GET", f"{host}/v1/videos/{task_id}", headers)
    elif type_ == "image":
        return _curl("GET", f"{host}/v1/images/generations/{task_id}", headers)
    elif type_ == "audio":
        return _curl("GET", f"{host}/v1/audio/speech/{task_id}", headers)
    else:
        return _curl("GET", f"{host}/tasks/{task_id}", headers)


def _extract_url(task_data: dict) -> str:
    """从轮询响应中提取下载 URL。rh-adapter: 顶层 url；NewAPI: metadata.url"""
    url = task_data.get("url", "")
    if not url:
        meta = task_data.get("metadata", {})
        if isinstance(meta, dict):
            url = meta.get("url", "")
    if not url:
        data = task_data.get("data", [])
        if isinstance(data, list) and data:
            first = data[0]
            if isinstance(first, dict):
                url = first.get("url", "")
    return url


def _print_json(data: dict):
    print(json.dumps(data, ensure_ascii=False))


# ── CLI ─────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="JC Media — 韭菜盒子媒体生成执行层")
    sub = parser.add_subparsers(dest="mode", help="运行模式")

    # ── run: 提交 + 轮询 + 下载（默认） ──
    p_run = sub.add_parser("run", help="提交任务并等待完成")
    p_run.add_argument("--type", required=True, choices=["image", "video", "audio"])
    p_run.add_argument("--model", required=True, help="model_id")
    p_run.add_argument("--prompt", required=True, help="提示词")
    p_run.add_argument("--input", help="参考图路径或 URL")
    p_run.add_argument("--input-video", help="参考视频 URL（视频编辑模型用）")
    p_run.add_argument("--output", help="输出文件路径")
    p_run.add_argument("--api-key", help="NewAPI Key")
    p_run.add_argument("--host", default=DEFAULT_HOST)
    p_run.add_argument("--params", nargs="*", default=[])

    # ── submit-only: 仅提交，立即返回 task_id ──
    p_sub = sub.add_parser("submit", help="仅提交任务，不等待")
    p_sub.add_argument("--type", required=True, choices=["image", "video", "audio"])
    p_sub.add_argument("--model", required=True, help="model_id")
    p_sub.add_argument("--prompt", required=True, help="提示词")
    p_sub.add_argument("--input", help="参考图路径或 URL")
    p_sub.add_argument("--input-video", help="参考视频 URL（视频编辑模型用）")
    p_sub.add_argument("--params", nargs="*", default=[], help="模型参数 key=value")
    p_sub.add_argument("--api-key", help="NewAPI Key")
    p_sub.add_argument("--host", default=DEFAULT_HOST)

    # ── poll: 轮询已有任务并下载 ──
    p_poll = sub.add_parser("poll", help="轮询已有任务（逗号分隔多个 task_id）")
    p_poll.add_argument("--task-ids", required=True, help="逗号分隔的 task_id 列表")
    p_poll.add_argument("--type", default="video", choices=["image", "video", "audio"], help="任务类型（影响轮询端点）")
    p_poll.add_argument("--output-dir", default=".", help="输出目录（默认当前目录）")
    p_poll.add_argument("--api-key", help="NewAPI Key")
    p_poll.add_argument("--host", default=DEFAULT_HOST)

    # ── list: 列出可用模型 ──
    p_lst = sub.add_parser("list", help="列出可用模型")
    p_lst.add_argument("--type", choices=["image", "video", "audio"], help="筛选类型")
    p_lst.add_argument("--api-key", help="NewAPI Key")
    p_lst.add_argument("--host", default=DEFAULT_HOST)

    # ── info: 查看模型详情 ──
    p_inf = sub.add_parser("info", help="查看模型参数详情")
    p_inf.add_argument("model_id", help="model_id")
    p_inf.add_argument("--api-key", help="NewAPI Key")
    p_inf.add_argument("--host", default=DEFAULT_HOST)

    # ── check: 验证连接 ──
    p_chk = sub.add_parser("check", help="验证 API 连接")
    p_chk.add_argument("--api-key", help="NewAPI Key")
    p_chk.add_argument("--host", default=DEFAULT_HOST)

    args = parser.parse_args()

    if args.mode is None:
        parser.print_help()
        sys.exit(1)

    api_key = resolve_key(getattr(args, "api_key", None))
    host = getattr(args, "host", DEFAULT_HOST).rstrip("/")

    if args.mode == "list":
        headers = {"Authorization": f"Bearer {api_key}"}
        result = _curl("GET", f"{host}/v1/models", headers, timeout=10)
        models = result.get("data", [])
        filt = getattr(args, "type", None)
        out = []
        for m in models:
            if filt and m.get("output_type") != filt:
                continue
            out.append({
                "id": m.get("id"),
                "label": m.get("label", m.get("id")),
                "type": m.get("output_type"),
                "params": [p.get("name") for p in m.get("params", [])],
            })
        _print_json({"status": "ok", "count": len(out), "models": out})

    elif args.mode == "info":
        headers = {"Authorization": f"Bearer {api_key}"}
        result = _curl("GET", f"{host}/v1/models", headers, timeout=10)
        models = result.get("data", [])
        found = None
        for m in models:
            if m.get("id") == args.model_id:
                found = m
                break
        if not found:
            _print_json({"status": "error", "message": f"Model not found: {args.model_id}"})
            sys.exit(1)
        params_detail = []
        for p in found.get("params", []):
            params_detail.append({
                "name": p.get("name"),
                "label": p.get("label", ""),
                "type": p.get("type", ""),
                "options": p.get("options", []),
                "default": p.get("default"),
            })
        _print_json({
            "status": "ok",
            "model": {
                "id": found.get("id"),
                "label": found.get("label"),
                "type": found.get("output_type"),
                "params": params_detail,
            }
        })

    elif args.mode == "check":
        headers = {"Authorization": f"Bearer {api_key}"}
        # rh-adapter: /health；NewAPI: /v1/models
        is_local = "8789" in host or "127.0.0.1" in host or "localhost" in host
        if is_local:
            result = _curl("GET", f"{host}/health", headers, timeout=10)
            if result.get("status") == "ok":
                _print_json({"status": "ok", "message": f"rh-adapter ready, {result.get('models',0)} models", "host": host})
            else:
                _print_json({"status": "error", "message": str(result), "host": host})
                sys.exit(1)
        else:
            result = _curl("GET", f"{host}/v1/models", headers, timeout=10)
            models = result.get("data", [])
            count = len(models)
            _print_json({"status": "ok", "message": f"NewAPI ready, {count} models", "host": host})

    elif args.mode == "submit":
        submit_result = _do_submit(api_key, host, args)
        task_id = submit_result.get("task_id") or submit_result.get("id")
        if not task_id:
            _print_json({"status": "error", "error": "SUBMIT_FAILED", "detail": submit_result})
            sys.exit(1)
        _print_json({"status": "submitted", "task_id": task_id, "model": args.model})

    elif args.mode == "poll":
        task_ids = [tid.strip() for tid in args.task_ids.split(",") if tid.strip()]
        results = []
        for tid in task_ids:
            r = _poll_and_download(api_key, host, tid, args.output_dir, args.type)
            results.append(r)
        _print_json({"status": "ok", "results": results})

    elif args.mode == "run":
        submit_result = _do_submit(api_key, host, args)
        task_id = submit_result.get("task_id") or submit_result.get("id")
        if not task_id:
            _print_json({"status": "error", "error": "SUBMIT_FAILED", "detail": submit_result})
            sys.exit(1)
        result = _poll_and_download(api_key, host, task_id, args.output, args.type)
        _print_json(result)
        if result.get("status") != "ok":
            sys.exit(1)


def _do_submit(api_key: str, host: str, args) -> dict:
    extra = _parse_params(getattr(args, "params", []) or [])
    if args.type == "image":
        return submit_image(api_key, args.model, args.prompt,
                           getattr(args, "input", None), host, extra)
    elif args.type == "video":
        return submit_video(api_key, args.model, args.prompt,
                           getattr(args, "input", None), host,
                           video_path=getattr(args, "input_video", None),
                           extra_params=extra)
    else:
        return submit_audio(api_key, args.model, args.prompt, host)


def _poll_and_download(api_key: str, host: str, task_id: str,
                       output_dir: str | None, type_: str = "") -> dict:
    start = time.time()
    elapsed = 0
    last_result: dict = {}
    while elapsed < MAX_POLL_SECONDS:
        time.sleep(POLL_INTERVAL)
        elapsed += POLL_INTERVAL
        task_data = poll_task(api_key, task_id, host, type_)
        status = str(task_data.get("status", "")).lower()

        if status in ("completed", "success", "done", "succeeded"):
            last_result = task_data
            break
        if status in ("failed", "failure", "error", "cancelled"):
            return {
                "status": "error", "error": "TASK_FAILED",
                "message": task_data.get("error", {}).get("message", str(task_data)),
                "task_id": task_id,
            }
        last_result = task_data

    elapsed_total = int(time.time() - start)
    url = _extract_url(last_result)
    files: list[str] = []

    if url and output_dir:
        # run 模式：output_dir 是文件路径（如 /tmp/jc-test.png），直接用
        # poll 模式：output_dir 是目录，自动命名（根据类型推导扩展名）
        p = Path(output_dir)
        if p.suffix:
            output = str(p)
        else:
            _ext_map = {"image": ".png", "video": ".mp4", "audio": ".mp3"}
            ext = _ext_map.get(type_, ".bin")
            output = str(p / f"{task_id}{ext}")
        output_path = Path(output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        if _download(url, output):
            files.append(output)

    return {
        "status": "ok",
        "files": files,
        "task_id": task_id,
        "duration": elapsed_total,
    }


if __name__ == "__main__":
    main()

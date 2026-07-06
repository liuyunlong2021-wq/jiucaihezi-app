#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import signal
import subprocess
import sys
from pathlib import Path

WEBAPP_ID = "2036019863617015809"
APP_URL = f"https://www.runninghub.cn/ai-detail/{WEBAPP_ID}"
RUNNINGHUB_APP = Path.home() / ".openclaw/skills/runninghub/scripts/runninghub_app.py"

MOTION_MAP = {
    "male_talk_neutral": "男人在说话",
    "female_talk_neutral": "女人在说话",
    "male_talk_walk_slow": "男人一边缓慢走动一边说话",
    "female_talk_walk_slow": "女人一边缓慢走动一边说话",
    "male_talk_emotional_low": "男人在说话，情绪低压但克制",
    "female_talk_emotional_low": "女人在说话，情绪低压但克制",
}

CURRENT_MANIFEST_PATH: Path | None = None
CURRENT_REQUEST: dict = {}
CURRENT_STDOUT_PATH: Path | None = None
CURRENT_STDERR_PATH: Path | None = None


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"request file not found: {path}")
    except json.JSONDecodeError as exc:
        fail(f"invalid json in {path}: {exc}")


def build_input_section(request: dict) -> dict:
    motion_tag = request.get("motion_tag")
    motion_prompt = request.get("motion_prompt_cn") or MOTION_MAP.get(motion_tag)
    data = {
        "first_frame": request.get("first_frame_path", ""),
        "voice_audio": request.get("voice_audio_path", ""),
        "dialogue_text": request.get("dialogue_text", ""),
        "width": request.get("width", 0),
        "height": request.get("height", 0),
    }
    if motion_tag:
        data["motion_tag"] = motion_tag
    if motion_prompt:
        data["motion_prompt_cn"] = motion_prompt
    return data


def write_manifest(status: str, request: dict, manifest_path: Path, **extra) -> None:
    payload = {
        "shot_id": request.get("shot_id", "unknown_shot"),
        "render_route": "voice_bound_shot_video",
        "status": status,
        "input": build_input_section(request),
        "runtime": {
            "provider": "runninghub",
            "workflow_type": "voice_bound_video_app",
            "app_url": APP_URL,
        },
    }
    payload.update(extra)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def fail(message: str, shot_id: str | None = None, request: dict | None = None, manifest_path: Path | None = None, error_code: str = "EXECUTION_FAILED") -> None:
    req = request or CURRENT_REQUEST or {}
    path = manifest_path or CURRENT_MANIFEST_PATH
    payload = {
        "error": {
            "code": error_code,
            "message": message,
        }
    }
    if CURRENT_STDOUT_PATH or CURRENT_STDERR_PATH:
        payload["runtime"] = {
            "provider": "runninghub",
            "workflow_type": "voice_bound_video_app",
            "app_url": APP_URL,
        }
        if CURRENT_STDOUT_PATH:
            payload["runtime"]["stdout_log"] = str(CURRENT_STDOUT_PATH)
        if CURRENT_STDERR_PATH:
            payload["runtime"]["stderr_log"] = str(CURRENT_STDERR_PATH)
    if path:
        write_manifest("failed", req, path, **payload)
    print(
        json.dumps(
            {
                "shot_id": shot_id or req.get("shot_id", "unknown_shot"),
                "render_route": "voice_bound_shot_video",
                "status": "failed",
                "error": {"code": error_code, "message": message},
            },
            ensure_ascii=False,
            indent=2,
        ),
        file=sys.stderr,
    )
    sys.exit(1)


def handle_sigterm(signum, frame) -> None:
    del signum, frame
    fail("process terminated before completion", error_code="TERMINATED")


def validate_request(request: dict) -> None:
    required = ["shot_id", "first_frame_path", "voice_audio_path", "dialogue_text", "width", "height"]
    missing = [key for key in required if not request.get(key)]
    if missing:
        fail(f"missing required fields: {', '.join(missing)}", request=request)

    if not request.get("motion_tag") and not request.get("motion_prompt_cn"):
        fail("either motion_tag or motion_prompt_cn is required", request=request)

    first_frame = Path(request["first_frame_path"])
    voice_audio = Path(request["voice_audio_path"])
    if not first_frame.exists():
        fail(f"first frame file not found: {first_frame}", request=request)
    if not voice_audio.exists():
        fail(f"voice audio file not found: {voice_audio}", request=request)

    try:
        width = int(request["width"])
        height = int(request["height"])
    except (TypeError, ValueError):
        fail("width and height must be integers", request=request)
    if width <= 0 or height <= 0:
        fail("width and height must be positive integers", request=request)


def normalize_motion_prompt(request: dict) -> str:
    prompt = request.get("motion_prompt_cn")
    if prompt:
        return str(prompt).strip()
    motion_tag = request.get("motion_tag")
    if motion_tag in MOTION_MAP:
        return MOTION_MAP[motion_tag]
    fail(f"unsupported motion_tag: {motion_tag}", request=request)
    return ""


def parse_exec_output(stdout_text: str) -> tuple[str | None, str | None, str | None, str | None]:
    output_file = None
    cost = None
    duration = None
    task_id = None
    for line in stdout_text.splitlines():
        if line.startswith("OUTPUT_FILE:"):
            output_file = line.split(":", 1)[1].strip()
        elif line.startswith("COST:"):
            cost = line.split(":", 1)[1].strip()
        elif line.startswith("DURATION:"):
            duration = line.split(":", 1)[1].strip()
        elif line.startswith("Task ID:"):
            task_id = line.split(":", 1)[1].strip()
    return output_file, cost, duration, task_id


def main() -> None:
    signal.signal(signal.SIGTERM, handle_sigterm)
    signal.signal(signal.SIGINT, handle_sigterm)

    parser = argparse.ArgumentParser(description="Run voice-bound single-shot video generation")
    parser.add_argument("request", help="Path to request json")
    parser.add_argument("--profile", default="personal", help="RunningHub profile")
    args = parser.parse_args()

    request_path = Path(args.request).resolve()
    request = load_json(request_path)
    validate_request(request)

    global CURRENT_REQUEST, CURRENT_MANIFEST_PATH, CURRENT_STDOUT_PATH, CURRENT_STDERR_PATH
    CURRENT_REQUEST = request

    shot_id = request["shot_id"]
    shot_dir = request_path.parent.parent if request_path.parent.name == "input" else request_path.parent
    outputs_dir = shot_dir / "outputs"
    manifests_dir = shot_dir / "manifests"
    outputs_dir.mkdir(parents=True, exist_ok=True)
    manifests_dir.mkdir(parents=True, exist_ok=True)

    manifest_path = manifests_dir / "voice_bound_result.json"
    response_path = outputs_dir / "response.json"
    stdout_path = outputs_dir / "run.stdout.log"
    stderr_path = outputs_dir / "run.stderr.log"
    output_video = outputs_dir / f"{shot_id}_voice_bound.mp4"

    CURRENT_MANIFEST_PATH = manifest_path
    CURRENT_STDOUT_PATH = stdout_path
    CURRENT_STDERR_PATH = stderr_path

    motion_prompt = normalize_motion_prompt(request)
    request["motion_prompt_cn"] = motion_prompt

    cmd = [
        "python3",
        str(RUNNINGHUB_APP),
        "--run",
        WEBAPP_ID,
        "--profile",
        args.profile,
        "--node",
        f"20:prompt={motion_prompt}",
        "--node",
        f"41:prompt={request['dialogue_text']}",
        "--file",
        f"43:image={request['first_frame_path']}",
        "--file",
        f"40:audio={request['voice_audio_path']}",
        "--node",
        f"47:value={int(request['height'])}",
        "--node",
        f"48:value={int(request['width'])}",
        "-o",
        str(output_video),
    ]

    write_manifest(
        "running",
        request,
        manifest_path,
        output={
            "video": str(output_video),
            "response_json": str(response_path),
        },
        runtime={
            "provider": "runninghub",
            "workflow_type": "voice_bound_video_app",
            "app_url": APP_URL,
            "stdout_log": str(stdout_path),
            "stderr_log": str(stderr_path),
        },
    )

    with stdout_path.open("w", encoding="utf-8") as stdout_file, stderr_path.open("w", encoding="utf-8") as stderr_file:
        proc = subprocess.run(cmd, stdout=stdout_file, stderr=stderr_file, text=True)

    stdout_text = stdout_path.read_text(encoding="utf-8") if stdout_path.exists() else ""
    stderr_text = stderr_path.read_text(encoding="utf-8") if stderr_path.exists() else ""

    response_payload = {
        "command": cmd,
        "returncode": proc.returncode,
        "stdout": stdout_text,
        "stderr": stderr_text,
    }
    response_path.write_text(json.dumps(response_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    if proc.returncode != 0:
        fail("runninghub app execution failed", shot_id=shot_id, request=request, manifest_path=manifest_path)

    resolved_output, cost, duration, task_id = parse_exec_output(stdout_text)
    video_path = resolved_output or str(output_video)
    if not Path(video_path).exists():
        fail("video output missing after successful execution", shot_id=shot_id, request=request, manifest_path=manifest_path)

    runtime = {
        "provider": "runninghub",
        "workflow_type": "voice_bound_video_app",
        "app_url": APP_URL,
        "stdout_log": str(stdout_path),
        "stderr_log": str(stderr_path),
    }
    if task_id:
        runtime["task_id"] = task_id
    if cost or duration:
        runtime["metrics"] = {}
        if cost:
            runtime["metrics"]["cost"] = cost
        if duration:
            runtime["metrics"]["duration"] = duration

    result = {
        "shot_id": shot_id,
        "render_route": "voice_bound_shot_video",
        "status": "success",
        "input": build_input_section(request),
        "output": {
            "video": video_path,
            "response_json": str(response_path),
        },
        "runtime": runtime,
    }

    manifest_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

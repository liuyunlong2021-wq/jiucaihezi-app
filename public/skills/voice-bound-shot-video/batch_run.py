#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent
RUNNER = SKILL_DIR / "run.py"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def resolve_result_path(request_path: Path) -> Path:
    shot_dir = request_path.parent.parent if request_path.parent.name == "input" else request_path.parent
    return shot_dir / "manifests" / "voice_bound_result.json"


def load_result_status(result_path: Path) -> tuple[str | None, str | None]:
    if not result_path.exists():
        return None, None
    try:
        data = load_json(result_path)
    except Exception:
        return None, "invalid result json"
    return data.get("status"), str(result_path)


def sort_items(items: list[dict]) -> list[dict]:
    return sorted(
        items,
        key=lambda item: (-(item.get("priority", 0)), item.get("shot_id", "")),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Batch run voice-bound shot video jobs")
    parser.add_argument("queue", help="Path to queue json")
    parser.add_argument("--profile", default="personal", help="RunningHub profile")
    parser.add_argument("--rerun-failed", action="store_true", help="Rerun jobs whose existing result status is failed")
    parser.add_argument("--force", action="store_true", help="Rerun all enabled jobs even if they already succeeded")
    args = parser.parse_args()

    queue_path = Path(args.queue).resolve()
    queue = load_json(queue_path)

    items = sort_items(queue.get("items", []))
    enabled_items = [item for item in items if item.get("enabled", True)]

    summary_items = []
    succeeded = 0
    failed = 0
    skipped = 0

    for item in enabled_items:
        shot_id = item["shot_id"]
        request_path = Path(item["request_path"])
        if not request_path.is_absolute():
            request_path = (queue_path.parent / request_path).resolve()

        result_path = resolve_result_path(request_path)
        existing_status, existing_result_path = load_result_status(result_path)

        if existing_status == "success" and not args.force:
            summary_items.append({
                "shot_id": shot_id,
                "request_path": str(request_path),
                "status": "skipped",
                "result_path": existing_result_path,
                "message": "already succeeded",
            })
            skipped += 1
            continue

        if existing_status == "failed" and not (args.rerun_failed or args.force):
            summary_items.append({
                "shot_id": shot_id,
                "request_path": str(request_path),
                "status": "skipped",
                "result_path": existing_result_path,
                "message": "existing failed result kept; use --rerun-failed or --force",
            })
            skipped += 1
            continue

        cmd = ["python3", str(RUNNER), str(request_path), "--profile", args.profile]
        proc = subprocess.run(cmd, capture_output=True, text=True)

        final_status, final_result_path = load_result_status(result_path)
        if proc.returncode == 0 and final_status == "success":
            summary_items.append({
                "shot_id": shot_id,
                "request_path": str(request_path),
                "status": "success",
                "result_path": final_result_path,
                "message": "render completed",
            })
            succeeded += 1
        else:
            message = proc.stderr.strip() or "render failed"
            summary_items.append({
                "shot_id": shot_id,
                "request_path": str(request_path),
                "status": "failed",
                "result_path": final_result_path or str(result_path),
                "message": message,
            })
            failed += 1

    total = len(enabled_items)
    if failed == 0 and succeeded > 0:
        batch_status = "success"
    elif succeeded > 0 and failed > 0:
        batch_status = "partial"
    elif failed > 0:
        batch_status = "failed"
    else:
        batch_status = "success"

    renders_dir = queue_path.parent / "renders"
    renders_dir.mkdir(parents=True, exist_ok=True)
    summary_path = renders_dir / f"{queue.get('queue_id', 'voice_bound_batch')}_summary.json"

    summary = {
        "queue_id": queue.get("queue_id", "voice_bound_batch"),
        "project_id": queue.get("project_id"),
        "status": batch_status,
        "stats": {
            "total": total,
            "succeeded": succeeded,
            "failed": failed,
            "skipped": skipped,
        },
        "items": summary_items,
    }

    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()

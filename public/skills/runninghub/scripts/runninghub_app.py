#!/usr/bin/env python3
"""
RunningHub AI Application client for OpenClaw.

Run any RunningHub AI Application (custom ComfyUI workflow) by webappId.
Uses only Python stdlib and curl.

Modes:
  --check                          Account health check (key + balance)
  --info WEBAPP_ID                 Show app's modifiable nodes
  --run WEBAPP_ID [options]        Execute an AI application task
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import tempfile
from pathlib import Path

API_HOST = "https://www.runninghub.cn"
NODE_INFO_PATH = "/api/webapp/apiCallDemo"
UPLOAD_PATH = "/task/openapi/upload"
SUBMIT_PATH = "/task/openapi/ai-app/run"

SCRIPT_DIR = Path(__file__).resolve().parent

sys.path.insert(0, str(SCRIPT_DIR))
from runninghub import (  # noqa: E402
    cmd_check,
    find_workflow,
    fix_mov_to_mp4,
    get_default_workflow_profile,
    list_workflows,
    poll_task,
    require_api_key,
)


# ---------------------------------------------------------------------------
# HTTP helpers (curl-based, stdlib only)
# ---------------------------------------------------------------------------

def curl_get(url: str, timeout: int = 30) -> subprocess.CompletedProcess:
    cmd = ["curl", "-s", "-S", "--fail-with-body", "--max-time", str(timeout), url]
    return subprocess.run(cmd, capture_output=True, text=True)


def curl_post_json(url: str, payload: dict, timeout: int = 60) -> subprocess.CompletedProcess:
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(payload, f)
        tmp_path = f.name
    try:
        cmd = [
            "curl", "-s", "-S", "--fail-with-body", "-X", "POST", url,
            "--max-time", str(timeout),
            "-H", "Content-Type: application/json",
            "-H", f"Host: {API_HOST.split('//')[1]}",
            "-d", f"@{tmp_path}",
        ]
        return subprocess.run(cmd, capture_output=True, text=True)
    finally:
        os.unlink(tmp_path)


def curl_upload(url: str, api_key: str, file_path: str, timeout: int = 120) -> subprocess.CompletedProcess:
    cmd = [
        "curl", "-s", "-S", "--fail-with-body", "-X", "POST", url,
        "--max-time", str(timeout),
        "-H", f"Host: {API_HOST.split('//')[1]}",
        "-F", f"apiKey={api_key}",
        "-F", "fileType=input",
        "-F", f"file=@{file_path}",
    ]
    return subprocess.run(cmd, capture_output=True, text=True)


def _parse_response(result: subprocess.CompletedProcess, context: str) -> dict:
    body = result.stdout or result.stderr
    if result.returncode != 0:
        try:
            err = json.loads(body)
            msg = err.get("msg", body)
        except (json.JSONDecodeError, TypeError):
            msg = body
        print(json.dumps({
            "error": "API_ERROR",
            "message": f"{context} failed: {msg}",
        }, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        print(json.dumps({
            "error": "API_ERROR",
            "message": f"{context}: invalid JSON response: {result.stdout[:500]}",
        }, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


# ---------------------------------------------------------------------------
# AI Application API functions
# ---------------------------------------------------------------------------

def get_node_info(api_key: str, webapp_id: str) -> list[dict]:
    url = f"{API_HOST}{NODE_INFO_PATH}?apiKey={api_key}&webappId={webapp_id}"
    result = curl_get(url)
    resp = _parse_response(result, "Get node info")

    if resp.get("code") != 0:
        print(json.dumps({
            "error": "APP_INFO_FAILED",
            "message": resp.get("msg", "Failed to get AI app info"),
            "detail": resp,
        }, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)

    node_list = resp.get("data", {}).get("nodeInfoList", [])
    if not node_list:
        print(json.dumps({
            "error": "NO_NODES",
            "message": "No modifiable nodes found for this AI app. "
                       "Make sure the app has been run at least once on the web.",
        }, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)

    return node_list


def upload_file(api_key: str, file_path: str) -> str:
    path = Path(file_path)
    if not path.exists():
        print(f"Error: file not found: {file_path}", file=sys.stderr)
        sys.exit(1)

    url = f"{API_HOST}{UPLOAD_PATH}"
    print(f"Uploading {path.name}...", file=sys.stderr)
    result = curl_upload(url, api_key, file_path)
    resp = _parse_response(result, "Upload file")

    if resp.get("code") != 0 or resp.get("msg") != "success":
        print(json.dumps({
            "error": "UPLOAD_FAILED",
            "message": f"Upload failed: {resp.get('msg', resp)}",
        }, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)

    file_name = resp.get("data", {}).get("fileName")
    if not file_name:
        print(json.dumps({
            "error": "UPLOAD_FAILED",
            "message": "Upload succeeded but no fileName returned",
        }, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)

    print(f"Uploaded: {file_name}", file=sys.stderr)
    return file_name


def submit_task(api_key: str, webapp_id: str, node_info_list: list[dict],
                instance_type: str = "default") -> dict:
    url = f"{API_HOST}{SUBMIT_PATH}"
    payload = {
        "apiKey": api_key,
        "webappId": int(webapp_id),
        "nodeInfoList": node_info_list,
    }
    if instance_type and instance_type != "default":
        payload["instanceType"] = instance_type

    print(f"Submitting AI app task (webapp {webapp_id})...", file=sys.stderr)
    result = curl_post_json(url, payload)
    resp = _parse_response(result, "Submit task")

    if resp.get("code") != 0:
        print(json.dumps({
            "error": "SUBMIT_FAILED",
            "message": f"Submit failed: {resp.get('msg', resp)}",
            "detail": resp,
        }, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)

    data = resp.get("data", {})
    task_id = data.get("taskId")
    if not task_id:
        print(json.dumps({
            "error": "SUBMIT_FAILED",
            "message": "No taskId in response",
            "detail": resp,
        }, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)

    prompt_tips_str = data.get("promptTips")
    if prompt_tips_str:
        try:
            tips = json.loads(prompt_tips_str)
            node_errors = tips.get("node_errors", {})
            if node_errors:
                print(json.dumps({
                    "error": "NODE_ERRORS",
                    "message": "Workflow has node errors",
                    "node_errors": node_errors,
                }, ensure_ascii=False), file=sys.stderr)
                sys.exit(1)
        except (json.JSONDecodeError, TypeError):
            pass

    return data


def download_file(url: str, output_path: str) -> str:
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    cmd = ["curl", "-s", "-S", "-L", "-o", output_path, "--max-time", "300", url]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Download failed: {result.stderr}", file=sys.stderr)
        sys.exit(1)
    return str(Path(output_path).resolve())


# ---------------------------------------------------------------------------
# --node / --file argument parsing
# ---------------------------------------------------------------------------

def parse_node_arg(arg: str, workflow: dict | None = None, expected_kind: str = "value") -> tuple[str, str, str]:
    """Parse either raw 'nodeId:fieldName=value' or workflow alias 'input=value'."""
    eq_idx = arg.find("=")
    if eq_idx == -1:
        print(f"Error: invalid argument '{arg}', expected key=value", file=sys.stderr)
        sys.exit(1)

    key = arg[:eq_idx]
    value = arg[eq_idx + 1:]

    colon_idx = key.find(":")
    if colon_idx != -1:
        node_id = key[:colon_idx]
        field_name = key[colon_idx + 1:]
        return node_id, field_name, value

    if not workflow:
        print(
            f"Error: shorthand '{arg}' requires --workflow. "
            "Use nodeId:fieldName=value for raw mode.",
            file=sys.stderr,
        )
        sys.exit(1)

    field_spec = workflow.get("inputs", {}).get(key)
    if not field_spec:
        available = ", ".join(sorted(workflow.get("inputs", {}).keys())) or "(none)"
        print(
            f"Error: workflow '{workflow['alias']}' has no input named '{key}'. "
            f"Available inputs: {available}",
            file=sys.stderr,
        )
        sys.exit(1)

    field_kind = field_spec.get("kind", "value")
    if expected_kind == "file" and field_kind != "file":
        print(
            f"Error: workflow input '{key}' expects a value argument, not a file upload.",
            file=sys.stderr,
        )
        sys.exit(1)
    if expected_kind == "value" and field_kind == "file":
        print(
            f"Error: workflow input '{key}' expects a file upload. Use --file {key}=PATH",
            file=sys.stderr,
        )
        sys.exit(1)

    return field_spec["nodeId"], field_spec["fieldName"], value


def _extract_dialogue_char_count(text: str) -> int:
    return sum(1 for ch in text if not ch.isspace() and ch not in '，。！？、；：,.!?;:"“”‘’()（）-')


def _apply_dialogue_duration_rule(node_args: list[str] | None) -> list[str] | None:
    if not node_args:
        return node_args

    prompt_value = None
    duration_index = None
    duration_value = None
    for i, arg in enumerate(node_args):
        if arg.startswith('prompt='):
            prompt_value = arg[len('prompt='):]
        elif arg.startswith('duration='):
            duration_index = i
            try:
                duration_value = int(float(arg[len('duration='):]))
            except ValueError:
                duration_value = None

    if prompt_value is None or duration_value is None:
        return node_args

    marker = 'says, "'
    marker_idx = prompt_value.rfind(marker)
    if marker_idx == -1:
        return node_args
    dialogue_part = prompt_value[marker_idx + len(marker):]
    end_idx = dialogue_part.find('"')
    if end_idx == -1:
        return node_args
    dialogue = dialogue_part[:end_idx].strip()
    if not dialogue:
        return node_args

    char_count = _extract_dialogue_char_count(dialogue)
    dialogue_seconds = int(math.ceil(char_count / 5))
    final_duration = max(duration_value, dialogue_seconds + 1)
    if final_duration != duration_value and duration_index is not None:
        updated = list(node_args)
        updated[duration_index] = f'duration={final_duration}'
        print(
            f'Adjusted duration from {duration_value}s to {final_duration}s '
            f'based on dialogue length ({char_count} chars).',
            file=sys.stderr,
        )
        return updated
    return node_args


def apply_modifications(api_key: str, node_list: list[dict],
                        node_args: list[str] | None,
                        file_args: list[str] | None,
                        workflow: dict | None = None,
                        auto_dialogue_duration: bool = False) -> list[dict]:
    if auto_dialogue_duration:
        node_args = _apply_dialogue_duration_rule(node_args)

    if node_args:
        for arg in node_args:
            nid, fname, fval = parse_node_arg(arg, workflow=workflow, expected_kind="value")
            target = next(
                (n for n in node_list if n["nodeId"] == nid and n["fieldName"] == fname),
                None,
            )
            if target:
                target["fieldValue"] = fval
            else:
                node_list.append({"nodeId": nid, "fieldName": fname, "fieldValue": fval})

    if file_args:
        for arg in file_args:
            nid, fname, fpath = parse_node_arg(arg, workflow=workflow, expected_kind="file")
            uploaded_name = upload_file(api_key, fpath)
            target = next(
                (n for n in node_list if n["nodeId"] == nid and n["fieldName"] == fname),
                None,
            )
            if target:
                target["fieldValue"] = uploaded_name
            else:
                node_list.append({"nodeId": nid, "fieldName": fname, "fieldValue": uploaded_name})

    return node_list


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_info(api_key: str, webapp_id: str):
    node_list = get_node_info(api_key, webapp_id)
    print(json.dumps({
        "webappId": webapp_id,
        "nodeCount": len(node_list),
        "nodes": node_list,
    }, indent=2, ensure_ascii=False))


def cmd_list_workflows(type_filter: str | None, profile_filter: str | None):
    workflows = list_workflows(type_filter=type_filter, profile_filter=profile_filter)
    print(f"Total: {len(workflows)} workflows")
    if type_filter:
        print(f"Filter: type={type_filter}")
    if profile_filter:
        print(f"Filter: profile={profile_filter}")
    print()
    for workflow in workflows:
        effective_profile = workflow.get("profile") or get_default_workflow_profile() or "-"
        inputs = ",".join(sorted(workflow.get("inputs", {}).keys()))
        print(
            f"{workflow['alias']:32s} profile={effective_profile:10s} "
            f"type={workflow.get('type') or '-':6s} webapp={workflow['webappId']} inputs=[{inputs}]"
        )


def cmd_workflow_info(alias: str):
    workflow = find_workflow(alias)
    if not workflow:
        print(f"Error: workflow '{alias}' not found", file=sys.stderr)
        sys.exit(1)
    print(json.dumps(workflow, indent=2, ensure_ascii=False))


def cmd_run(args):
    workflow = find_workflow(args.workflow) if args.workflow else None
    if args.workflow and not workflow:
        print(f"Error: workflow '{args.workflow}' not found", file=sys.stderr)
        sys.exit(1)

    profile = args.profile or (workflow.get("profile") if workflow else None)
    api_key = require_api_key(args.api_key, profile)
    webapp_id = workflow["webappId"] if workflow else args.run

    node_list = get_node_info(api_key, webapp_id)
    node_list = apply_modifications(
        api_key,
        node_list,
        args.node,
        args.file,
        workflow=workflow,
        auto_dialogue_duration=args.auto_dialogue_duration,
    )

    data = submit_task(api_key, webapp_id, node_list, args.instance_type or "default")
    task_id = str(data["taskId"])

    final = poll_task(api_key, task_id)
    results = final.get("results")

    usage = final.get("usage") or {}
    consume_money = usage.get("consumeMoney") or usage.get("thirdPartyConsumeMoney")
    task_cost_time = usage.get("taskCostTime")

    if not results:
        print(json.dumps({
            "error": "TASK_FAILED",
            "message": "No results in final response",
        }, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)

    file_urls = []
    for item in results:
        url = item.get("url") or item.get("outputUrl")
        ext = item.get("outputType", "")
        if url:
            file_urls.append((url, ext))

    if not file_urls:
        text_results = []
        for item in results:
            t = item.get("text") or item.get("content") or item.get("output")
            if t:
                text_results.append(t)
        if text_results:
            for t in text_results:
                print(t)
            if consume_money is not None:
                print(f"COST:¥{consume_money}")
            return
        print(json.dumps(results, indent=2, ensure_ascii=False))
        return

    output_base = args.output
    for i, (url, ext) in enumerate(file_urls):
        if not ext:
            ext = _guess_ext_from_url(url)
        if output_base:
            if len(file_urls) == 1:
                out_path = output_base
            else:
                stem = Path(output_base).stem
                suffix = Path(output_base).suffix or f".{ext}"
                out_path = str(Path(output_base).parent / f"{stem}_{i+1}{suffix}")
        else:
            out_path = f"/tmp/openclaw/rh-output/app_result_{i+1}.{ext}"

        if ext:
            out_path = str(Path(out_path).with_suffix(f".{ext}"))
        elif not Path(out_path).suffix:
            out_path = f"{out_path}.png"

        print(f"Downloading result {i+1}/{len(file_urls)}...", file=sys.stderr)
        full_path = download_file(url, out_path)
        fix_mov_to_mp4(full_path)
        print(f"OUTPUT_FILE:{full_path}")

    if consume_money is not None:
        print(f"COST:¥{consume_money}")
    if task_cost_time and str(task_cost_time) != "0":
        print(f"DURATION:{task_cost_time}s")


def _guess_ext_from_url(url: str) -> str:
    path = url.split("?")[0]
    if "." in path.split("/")[-1]:
        return path.split("/")[-1].rsplit(".", 1)[-1].lower()
    return "png"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="RunningHub AI Application client for OpenClaw",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
Modes:
  --check                           Check API key and account balance
  --info WEBAPP_ID                  Show app's modifiable nodes
  --list-workflows                  List registered workflow aliases
  --workflow-info WORKFLOW          Show workflow registry details
  --run WEBAPP_ID [options]         Execute an AI application task
  --workflow WORKFLOW [options]     Execute a registered workflow alias

Examples:
  python3 runninghub_app.py --check --profile personal
  python3 runninghub_app.py --info 1877265245566922800
  python3 runninghub_app.py --list-workflows
  python3 runninghub_app.py --workflow-info economy.shot.qwen_edit_3img
  python3 runninghub_app.py --run 1877265245566922800 \\
    --node "52:prompt=a girl dancing" \\
    --file "39:image=/tmp/photo.jpg" \\
    -o /tmp/result.png
  python3 runninghub_app.py --workflow economy.video.ltx23 \\
    --node "prompt=a girl dancing in the rain" \\
    --file "image=/tmp/photo.jpg" \\
    --node "duration=3" \\
    -o /tmp/result.mp4
""",
    )

    parser.add_argument("--check", action="store_true", help="Check API key and account status")
    parser.add_argument("--info", metavar="WEBAPP_ID", help="Show modifiable nodes for an AI app")
    parser.add_argument("--run", metavar="WEBAPP_ID", help="Run an AI application")
    parser.add_argument("--list-workflows", action="store_true", help="List workflow aliases from data/my-workflows.json")
    parser.add_argument("--workflow-info", metavar="WORKFLOW", help="Show workflow alias details from data/my-workflows.json")
    parser.add_argument("--workflow", metavar="WORKFLOW", help="Run a registered workflow alias from data/my-workflows.json")
    parser.add_argument("--node", action="append",
                        help="Set node value as nodeId:fieldName=value, or input=value when using --workflow")
    parser.add_argument("--file", action="append",
                        help="Upload file as nodeId:fieldName=/path, or input=/path when using --workflow")
    parser.add_argument("--instance-type", choices=["default", "plus"], default="default",
                        help="GPU instance type: default=24G, plus=48G (default: default)")
    parser.add_argument("--output", "-o", help="Output file path")
    parser.add_argument("--api-key", "-k", help="API key (optional, resolved from config)")
    parser.add_argument("--profile", help="API key profile name (for example: personal, enterprise)")
    parser.add_argument("--workflow-type", help="Filter --list-workflows by workflow type")
    parser.add_argument(
        "--auto-dialogue-duration",
        action="store_true",
        help="Auto-adjust duration node by dialogue length when prompt contains The ... says, \"...\"",
    )

    args = parser.parse_args()

    if args.check:
        cmd_check(args.api_key, args.profile)
    elif args.list_workflows:
        cmd_list_workflows(args.workflow_type, args.profile)
    elif args.workflow_info:
        cmd_workflow_info(args.workflow_info)
    elif args.info:
        api_key = require_api_key(args.api_key, args.profile)
        cmd_info(api_key, args.info)
    elif args.run or args.workflow:
        cmd_run(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()

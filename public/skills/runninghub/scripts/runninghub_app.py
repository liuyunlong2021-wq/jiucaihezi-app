#!/usr/bin/env python3
"""
RunningHub AI Application compatibility wrapper.

Desktop media generation is managed by Jiucaihezi Gateway account membership.
This bundled script must not collect or use upstream RunningHub credentials.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from runninghub import find_workflow, list_workflows  # noqa: E402


def gateway_only_payload() -> dict:
    return {
        "error": "NO_API_KEY",
        "message": "Desktop RunningHub access is managed by Jiucaihezi Gateway account membership. 桌面端请使用韭菜盒子账号会员体系。",
        "steps": [
            "1. Log in to the Jiucaihezi desktop account center.",
            "2. Open or renew 会员 in the account center.",
            "3. Use canvas or creation panel media features through Gateway and NewAPI automatic routing.",
        ],
    }


def print_gateway_only() -> None:
    print(json.dumps(gateway_only_payload(), ensure_ascii=False))


def cmd_list_workflows(type_filter: str | None) -> None:
    workflows = list_workflows(type_filter=type_filter)
    print(f"Total: {len(workflows)} workflows")
    if type_filter:
        print(f"Filter: type={type_filter}")
    print()
    for workflow in workflows:
        inputs = ",".join(sorted(workflow.get("inputs", {}).keys()))
        print(
            f"{workflow['alias']:32s} type={workflow.get('type') or '-':6s} "
            f"webapp={workflow['webappId']} inputs=[{inputs}]"
        )


def cmd_workflow_info(alias: str) -> None:
    workflow = find_workflow(alias)
    if not workflow:
        print(f"Error: workflow '{alias}' not found", file=sys.stderr)
        sys.exit(1)
    print(json.dumps(workflow, indent=2, ensure_ascii=False))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="RunningHub AI Application compatibility wrapper for Jiucaihezi Gateway",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
Modes:
  --check                           Explain Gateway membership access
  --list-workflows                  List registered workflow aliases
  --workflow-info WORKFLOW          Show workflow registry details
  --run WEBAPP_ID                   Disabled; use the desktop canvas or creation panel
  --workflow WORKFLOW               Disabled; use the desktop canvas or creation panel

Examples:
  python3 runninghub_app.py --check
  python3 runninghub_app.py --list-workflows
  python3 runninghub_app.py --workflow-info economy.video.ltx23
""",
    )

    parser.add_argument("--check", action="store_true", help="Explain Gateway membership access")
    parser.add_argument("--info", metavar="WEBAPP_ID", help="Disabled; use Gateway-backed desktop media features")
    parser.add_argument("--run", metavar="WEBAPP_ID", help="Disabled; use Gateway-backed desktop media features")
    parser.add_argument("--list-workflows", action="store_true", help="List workflow aliases from data/my-workflows.json")
    parser.add_argument("--workflow-info", metavar="WORKFLOW", help="Show workflow alias details from data/my-workflows.json")
    parser.add_argument("--workflow", metavar="WORKFLOW", help="Disabled; use Gateway-backed desktop media features")
    parser.add_argument("--node", action="append", help=argparse.SUPPRESS)
    parser.add_argument("--file", action="append", help=argparse.SUPPRESS)
    parser.add_argument("--instance-type", choices=["default", "plus"], default="default", help=argparse.SUPPRESS)
    parser.add_argument("--output", "-o", help=argparse.SUPPRESS)
    parser.add_argument("--workflow-type", help="Filter --list-workflows by workflow type")
    parser.add_argument("--auto-dialogue-duration", action="store_true", help=argparse.SUPPRESS)

    args = parser.parse_args()

    if args.list_workflows:
        cmd_list_workflows(args.workflow_type)
    elif args.workflow_info:
        cmd_workflow_info(args.workflow_info)
    elif args.check or args.info or args.run or args.workflow:
        print_gateway_only()
        sys.exit(1 if (args.info or args.run or args.workflow) else 0)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()

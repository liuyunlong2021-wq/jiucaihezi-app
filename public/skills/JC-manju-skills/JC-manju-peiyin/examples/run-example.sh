#!/usr/bin/env bash
set -euo pipefail

python3 ~/.openclaw/skills/voice-bound-shot-video/run.py \
  shots/shot_001/input/request.json \
  --profile personal

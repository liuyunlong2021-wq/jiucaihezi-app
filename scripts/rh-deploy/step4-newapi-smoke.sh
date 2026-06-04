#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-https://api.jiucaihezi.studio}"
POLL_INTERVAL="${POLL_INTERVAL:-10}"
POLL_LIMIT="${POLL_LIMIT:-90}"
WORK_DIR="${WORK_DIR:-/tmp/rh-step4-smoke}"

mkdir -p "$WORK_DIR"

if [ -z "${NEWAPI_TEST_TOKEN:-}" ]; then
  printf 'Paste NewAPI test token, then press Enter: '
  IFS= read -r -s NEWAPI_TEST_TOKEN
  printf '\n'
fi

if [ -z "${NEWAPI_TEST_TOKEN:-}" ]; then
  echo "ERROR: NEWAPI_TEST_TOKEN is required" >&2
  exit 1
fi

json_value() {
  local file="$1"
  local expr="$2"
  python3 - "$file" "$expr" <<'PY'
import json, sys
path, expr = sys.argv[1], sys.argv[2]
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)

def first(*values):
    for value in values:
        if value not in (None, "", []):
            return value
    return ""

d = data.get("data") if isinstance(data, dict) else None
item = d[0] if isinstance(d, list) and d else d if isinstance(d, dict) else {}

if expr == "task_id":
    print(first(
        data.get("task_id") if isinstance(data, dict) else None,
        data.get("taskId") if isinstance(data, dict) else None,
        data.get("id") if isinstance(data, dict) else None,
        item.get("task_id") if isinstance(item, dict) else None,
        item.get("taskId") if isinstance(item, dict) else None,
        item.get("id") if isinstance(item, dict) else None,
        d if isinstance(d, str) else None,
    ))
elif expr == "status":
    print(first(
        data.get("status") if isinstance(data, dict) else None,
        item.get("status") if isinstance(item, dict) else None,
    ))
elif expr == "url":
    candidates = [
        data.get("url") if isinstance(data, dict) else None,
        data.get("output") if isinstance(data, dict) else None,
        item.get("url") if isinstance(item, dict) else None,
    ]
    if isinstance(data, dict):
        output = data.get("output") or data.get("result")
        if isinstance(output, dict):
            candidates += [output.get("url"), output.get("image_url"), output.get("video_url"), output.get("audio_url")]
        raw = data.get("raw") or {}
        if isinstance(raw, dict):
            candidates += [raw.get("url"), raw.get("fileUrl")]
    value = first(*candidates)
    if isinstance(value, list):
        value = value[0] if value else ""
    print(value or "")
else:
    print("")
PY
}

post_json() {
  local path="$1"
  local body="$2"
  local out="$3"
  local code
  code="$(curl -sS -o "$out" -w '%{http_code}' \
    -H "Authorization: Bearer ${NEWAPI_TEST_TOKEN}" \
    -H 'Content-Type: application/json' \
    "${API_BASE}${path}" \
    -d "$body")"
  if [ "$code" -lt 200 ] || [ "$code" -ge 300 ]; then
    echo "HTTP $code from $path" >&2
    head -c 1000 "$out" >&2 || true
    echo >&2
    return 1
  fi
}

poll_task() {
  local task_id="$1"
  local query="${2:-}"
  local label="$3"
  local out="$WORK_DIR/poll-${label// /_}.json"
  local i status url
  for i in $(seq 1 "$POLL_LIMIT"); do
    curl -fsS "${API_BASE}/rh/tasks/${task_id}${query}" -o "$out"
    status="$(json_value "$out" status | tr '[:upper:]' '[:lower:]')"
    url="$(json_value "$out" url)"
    printf '[%s] poll %s/%s status=%s\n' "$label" "$i" "$POLL_LIMIT" "${status:-unknown}"
    if [ "$status" = "success" ] || [ "$status" = "completed" ] || [ "$status" = "done" ]; then
      if [ -n "$url" ]; then
        echo "$url"
        return 0
      fi
      echo "ERROR: $label completed but no media URL returned" >&2
      cat "$out" >&2
      return 1
    fi
    if [ "$status" = "failed" ] || [ "$status" = "error" ] || [ "$status" = "cancelled" ]; then
      echo "ERROR: $label failed" >&2
      cat "$out" >&2
      return 1
    fi
    sleep "$POLL_INTERVAL"
  done
  echo "ERROR: $label timed out" >&2
  return 1
}

submit_and_poll() {
  local label="$1"
  local path="$2"
  local body="$3"
  local query="${4:-}"
  local out="$WORK_DIR/submit-${label// /_}.json"
  echo "=== $label submit ===" >&2
  post_json "$path" "$body" "$out"
  local task_id
  task_id="$(json_value "$out" task_id)"
  if [ -z "$task_id" ]; then
    echo "ERROR: $label submit returned no task id" >&2
    cat "$out" >&2
    return 1
  fi
  echo "task_id=$task_id" >&2
  poll_task "$task_id" "$query" "$label"
}

echo "=== NewAPI model list check ==="
curl -fsS -H "Authorization: Bearer ${NEWAPI_TEST_TOKEN}" "${API_BASE}/v1/models" -o "$WORK_DIR/models.json"
python3 - "$WORK_DIR/models.json" <<'PY'
import json, sys
data=json.load(open(sys.argv[1]))
ids=[item.get("id") for item in data.get("data", [])]
need=[
 "rh-pro-image","rh-image-v2","rh-gpt2-image","rh-gpt2-text",
 "rh-video-v31-fast","rh-seedance2-text-video","rh-seedance2-image-video",
 "rh-seedance2-multimodal-video","rh-grok-text-video","rh-grok-image-video",
 "rh-aiapp-fast-digital-human","rh-aiapp-digital-human","rh-aiapp-director",
 "rh-speech-hd","rh-speech-turbo","rh-music","rh-voice-clone",
 "rh-aiapp-voice-clone","rh-aiapp-voice-design"
]
missing=[item for item in need if item not in ids]
print("models_found=", len(ids), "missing=", ",".join(missing) or "none")
if missing:
    raise SystemExit(1)
PY

IMAGE_URL="$(submit_and_poll \
  'image rh-gpt2-text' \
  '/v1/images/generations' \
  '{"model":"rh-gpt2-text","prompt":"A simple red square on a clean white background, minimal test image.","aspect_ratio":"1:1","resolution":"1k"}')"
echo "IMAGE_URL=$IMAGE_URL"

submit_and_poll \
  'audio rh-speech-turbo' \
  '/v1/audio/speech' \
  '{"model":"rh-speech-turbo","prompt":"This is a short RunningHub smoke test.","text":"This is a short RunningHub smoke test."}' >/dev/null

submit_and_poll \
  'video rh-grok-text-video' \
  '/v1/videos' \
  '{"model":"rh-grok-text-video","prompt":"A red square gently drifting across a white background.","aspect_ratio":"16:9","resolution":"480p","duration":6}' >/dev/null

submit_and_poll \
  'video rh-grok-image-video' \
  '/v1/videos' \
  "{\"model\":\"rh-grok-image-video\",\"prompt\":\"The red square gently moves from left to right.\",\"images\":[\"${IMAGE_URL}\"],\"aspect_ratio\":\"16:9\",\"resolution\":\"480p\",\"duration\":6}" >/dev/null

submit_and_poll \
  'video rh-seedance2-text-video' \
  '/v1/videos' \
  '{"model":"rh-seedance2-text-video","prompt":"A red square slowly floating on a clean white background.","ratio":"16:9","resolution":"480p","duration":4}' >/dev/null

submit_and_poll \
  'video rh-seedance2-image-video' \
  '/v1/videos' \
  "{\"model\":\"rh-seedance2-image-video\",\"prompt\":\"The red square slowly floats upward.\",\"images\":[\"${IMAGE_URL}\"],\"ratio\":\"16:9\",\"resolution\":\"480p\",\"duration\":4}" >/dev/null

submit_and_poll \
  'video rh-seedance2-multimodal-video' \
  '/v1/videos' \
  "{\"model\":\"rh-seedance2-multimodal-video\",\"prompt\":\"Use the reference image and animate the red square with subtle movement.\",\"images\":[\"${IMAGE_URL}\"],\"ratio\":\"16:9\",\"resolution\":\"480p\",\"duration\":4}" >/dev/null

submit_and_poll \
  'ai-app rh-gpt2-image' \
  '/v1/images/generations' \
  '{"model":"rh-gpt2-image","prompt":"A tiny blue circle on white background, smoke test.","aspect_ratio":"1:1","ratio":"1:1","size":"1024x1024"}' \
  '?ai_app=true' >/dev/null

echo "=== Step 4 NewAPI smoke finished ==="

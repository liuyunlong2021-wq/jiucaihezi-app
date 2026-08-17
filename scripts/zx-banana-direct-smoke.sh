#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${ZX_BASE_URL:-https://img-api.zxcode.vip}"
MODEL="${ZX_BANANA_MODEL:-gemini-3.1-flash-image}"
OUT_DIR="${ZX_BANANA_OUT_DIR:-$(mktemp -d /tmp/zx-banana-direct.XXXXXX)}"
KEY="${ZX_API_KEY:-}"

mkdir -p "$OUT_DIR"
cd "$OUT_DIR"

curl -fL 'https://picsum.photos/seed/jc-zx-person/768/512' -o ref-1.jpg
curl -fL 'https://picsum.photos/seed/jc-zx-street/768/512' -o ref-2.jpg
curl -fL 'https://picsum.photos/seed/jc-zx-object/768/512' -o ref-3.jpg

if [[ -z "$KEY" ]]; then
  read -rsp 'ZX API Key: ' KEY
  echo
fi

python3 - "$MODEL" ref-1.jpg ref-2.jpg ref-3.jpg > request.json <<'PY'
import base64
import json
import sys

model, *images = sys.argv[1:]
parts = [{"text": "参考图1确定人物，参考图2确定环境，参考图3确定道具。生成一张横向16:9写实电影剧照，高细节。"}]
for path in images:
    with open(path, "rb") as image:
        parts.append({"inlineData": {"mimeType": "image/jpeg", "data": base64.b64encode(image.read()).decode()}})
json.dump({
    "contents": [{"parts": parts}],
    "generationConfig": {
        "responseModalities": ["TEXT", "IMAGE"],
        "imageConfig": {"aspectRatio": "16:9", "imageSize": "2K"},
    },
}, sys.stdout)
PY

STATUS="$(curl -sS -o submit.json -w '%{http_code}' \
  "$BASE_URL/v1/models/$MODEL:generateContent" \
  -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @request.json)"

python3 - <<'PY'
import json

with open("submit.json") as response:
    data = json.load(response)
for candidate in data.get("candidates", []):
    for part in candidate.get("content", {}).get("parts", []):
        inline = part.get("inlineData")
        if isinstance(inline, dict) and isinstance(inline.get("data"), str):
            inline["data"] = f"<base64 {len(inline['data'])} characters>"
print(json.dumps(data, ensure_ascii=False, indent=2))
PY
if [[ "$STATUS" != 2* ]]; then
  echo "ZX Banana request failed: HTTP $STATUS" >&2
  exit 1
fi

python3 - <<'PY'
import base64
import json

with open("submit.json") as response:
    data = json.load(response)
for candidate in data.get("candidates", []):
    for part in candidate.get("content", {}).get("parts", []):
        inline = part.get("inlineData", {})
        if inline.get("data"):
            mime = inline.get("mimeType", "image/png")
            extension = ".jpg" if mime == "image/jpeg" else ".png"
            with open("output" + extension, "wb") as output:
                output.write(base64.b64decode(inline["data"]))
            print(f"Saved {output.name}")
            raise SystemExit(0)
raise SystemExit("ZX returned HTTP 2xx but no inlineData image")
PY

echo "Artifacts: $OUT_DIR"

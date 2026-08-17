#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${ZX_BASE_URL:-https://img-api.zxcode.vip}"
OUT_DIR="${ZX_IMAGE_OUT_DIR:-$(mktemp -d /tmp/zx-gpt-image.XXXXXX)}"
KEY="${ZX_API_KEY:-}"
MODEL="${1:-}"

case "$MODEL" in
  gpt-image-2|gpt-image-2-A|gpt-image-2C|gpt-image-2L) ;;
  *)
    echo "用法: $0 gpt-image-2|gpt-image-2-A|gpt-image-2C|gpt-image-2L" >&2
    exit 2
    ;;
esac

mkdir -p "$OUT_DIR"
cd "$OUT_DIR"

curl -fL 'https://picsum.photos/seed/jc-zx-person/768/512' -o ref-1.jpg
curl -fL 'https://picsum.photos/seed/jc-zx-street/768/512' -o ref-2.jpg
curl -fL 'https://picsum.photos/seed/jc-zx-object/768/512' -o ref-3.jpg

if [[ -z "$KEY" ]]; then
  read -rsp 'ZX API Key: ' KEY
  echo
fi

RESPONSE="response-${MODEL}.json"
STATUS="$(curl --max-time 300 -sS -o "$RESPONSE" -w '%{http_code}' \
  "$BASE_URL/v1/images/edits" \
  -H "Authorization: Bearer $KEY" \
  -F "model=$MODEL" \
  -F 'size=2048x1152' \
  -F 'quality=medium' \
  -F 'n=1' \
  -F 'response_format=b64_json' \
  -F 'prompt=参考图1确定人物，参考图2确定环境，参考图3确定道具。生成一张横向16:9写实电影剧照，高细节。' \
  -F 'image[]=@ref-1.jpg;type=image/jpeg' \
  -F 'image[]=@ref-2.jpg;type=image/jpeg' \
  -F 'image[]=@ref-3.jpg;type=image/jpeg')"

python3 - "$STATUS" "$RESPONSE" <<'PY'
import base64
import json
import sys

status, path = sys.argv[1:]
with open(path) as response:
    data = json.load(response)
print(f"HTTP {status}")
if not str(status).startswith("2"):
    print(json.dumps(data, ensure_ascii=False, indent=2))
    raise SystemExit(1)

items = data.get("data") or []
item = items[0] if items else {}
if item.get("b64_json"):
    with open("output.png", "wb") as output:
        output.write(base64.b64decode(item["b64_json"]))
    print("SUCCESS: output.png")
elif item.get("url"):
    print(f"SUCCESS: {item['url']}")
else:
    print(json.dumps(data, ensure_ascii=False, indent=2))
    raise SystemExit("成功响应没有 b64_json 或 url")
PY

echo "Artifacts: $OUT_DIR"

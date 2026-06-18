#!/usr/bin/env bash
set -euo pipefail

LOG="${LOG:-/tmp/rh-step4-diagnose.log}"
exec > >(tee "$LOG") 2>&1

echo "=== start $(date -Iseconds) ==="

if [ ! -f /opt/creation-models/.env ]; then
  echo "ERROR: /opt/creation-models/.env not found"
  exit 1
fi

set -a
. /opt/creation-models/.env
set +a

PG_CONT="$(docker ps -q -f name=postgres | head -n 1)"
if [ -z "$PG_CONT" ]; then
  echo "ERROR: postgres container not found"
  exit 1
fi

PSQL_BASE=(docker exec -e PGPASSWORD="$NEWAPI_PSQL_PASSWORD" "$PG_CONT" psql -h localhost -U "${NEWAPI_PSQL_USER:-newapi}" -d "${NEWAPI_PSQL_DB:-new-api}")
psqlc() { "${PSQL_BASE[@]}" -c "$1"; }
psqla() { "${PSQL_BASE[@]}" -At -c "$1"; }

quote_ident() {
  local s="$1"
  s="${s//\"/\"\"}"
  printf '"%s"' "$s"
}

column_exists() {
  local table="$1"
  local column="$2"
  psqla "SELECT 1 FROM information_schema.columns WHERE table_name='${table}' AND column_name='${column}' LIMIT 1;" | grep -qx 1
}

existing_cols() {
  local table="$1"; shift
  local wanted=("$@")
  local col out=()
  for col in "${wanted[@]}"; do
    if column_exists "$table" "$col"; then
      out+=("$(quote_ident "$col")")
    fi
  done
  local IFS=,
  printf '%s' "${out[*]}"
}

channel_group_col=""
if column_exists channels group; then
  channel_group_col='"group"'
elif column_exists channels groups; then
  channel_group_col='"groups"'
fi

user_group_col=""
if column_exists users group; then
  user_group_col='"group"'
elif column_exists users groups; then
  user_group_col='"groups"'
fi

echo "=== NewAPI containers ==="
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -E 'new|api|postgres|rh-adapter' || true

echo "=== channels columns ==="
psqlc "SELECT column_name,data_type FROM information_schema.columns WHERE table_name='channels' ORDER BY ordinal_position;"

echo "=== RH channels 55/56/57 ==="
if [ -n "$channel_group_col" ]; then
  psqlc "SELECT id,name,status,${channel_group_col} AS channel_group,models FROM channels WHERE id IN (55,56,57) ORDER BY id;"
else
  psqlc "SELECT id,name,status,models FROM channels WHERE id IN (55,56,57) ORDER BY id;"
fi

echo "=== RH-like channels ==="
if [ -n "$channel_group_col" ]; then
  psqlc "SELECT id,name,status,${channel_group_col} AS channel_group,base_url,models FROM channels WHERE models LIKE '%rh-%' OR base_url LIKE '%8789%' OR base_url LIKE '%rh-adapter%' ORDER BY id;"
else
  psqlc "SELECT id,name,status,base_url,models FROM channels WHERE models LIKE '%rh-%' OR base_url LIKE '%8789%' OR base_url LIKE '%rh-adapter%' ORDER BY id;"
fi

echo "=== tokens columns ==="
psqlc "SELECT column_name,data_type FROM information_schema.columns WHERE table_name='tokens' ORDER BY ordinal_position;"

echo "=== latest enabled tokens safe fields ==="
TOKEN_SELECT="$(existing_cols tokens id user_id name status remain_quota unlimited_quota expired_time models used_quota created_time accessed_time)"
if [ -n "$TOKEN_SELECT" ]; then
  psqlc "SELECT ${TOKEN_SELECT} FROM tokens WHERE status=1 ORDER BY id DESC LIMIT 10;"
fi

echo "=== users columns ==="
psqlc "SELECT column_name,data_type FROM information_schema.columns WHERE table_name='users' ORDER BY ordinal_position;"

echo "=== latest token users safe fields ==="
USER_SELECT="$(existing_cols users id username status quota used_quota request_count)"
if [ -n "$user_group_col" ]; then
  USER_SELECT="${USER_SELECT},${user_group_col} AS user_group"
fi
if [ -n "$USER_SELECT" ]; then
  psqlc "SELECT ${USER_SELECT} FROM users WHERE id IN (SELECT user_id FROM tokens WHERE status=1 ORDER BY id DESC LIMIT 10) ORDER BY id DESC;"
fi

echo "=== NewAPI /v1/models with latest enabled token ==="
RAW_TOKEN="$(
  psqla "SELECT key FROM tokens WHERE status=1 ORDER BY id DESC LIMIT 1;" \
  | head -n 1 | tr -d '\r\n '
)"
TOKEN=""
for CANDIDATE in "$RAW_TOKEN" "sk-$RAW_TOKEN"; do
  CODE="$(curl -sS -o /tmp/rh-v1-models.json -w '%{http_code}' \
    -H "Authorization: Bearer ${CANDIDATE}" \
    https://api.jiucaihezi.studio/v1/models || true)"
  echo "token candidate http=$CODE"
  if [ "$CODE" = "200" ]; then
    TOKEN="$CANDIDATE"
    break
  fi
done
if [ -n "$TOKEN" ]; then
  python3 - /tmp/rh-v1-models.json <<'PY'
import json, sys
data=json.load(open(sys.argv[1], encoding="utf-8"))
ids=[item.get("id") for item in data.get("data", [])]
need=[
 "rh-pro-image","rh-image-v2","rh-gpt2-image","rh-gpt2-text","z-image-turbo",
 "rh-video-v31-fast","rh-seedance2-text-video","rh-seedance2-image-video",
 "rh-seedance2-multimodal-video","rh-grok-text-video","rh-grok-image-video",
 "rh-aiapp-fast-digital-human","rh-aiapp-digital-human","rh-aiapp-director",
 "rh-speech-hd","rh-speech-turbo","rh-music","rh-voice-clone",
 "rh-aiapp-voice-clone","rh-aiapp-voice-design"
]
missing=[item for item in need if item not in ids]
print("model_count=", len(ids))
print("missing=", ",".join(missing) or "none")
print("rh_visible=", ",".join([item for item in ids if isinstance(item, str) and item.startswith("rh-")]) or "none")
PY
else
  echo "ERROR: no latest enabled token candidate passed /v1/models"
  cat /tmp/rh-v1-models.json || true
fi

echo "=== current public creation model ids ==="
curl -fsS https://api.jiucaihezi.studio/api/creation/models -o /tmp/rh-creation-models.json
python3 - /tmp/rh-creation-models.json <<'PY'
import json,sys
data=json.load(open(sys.argv[1], encoding="utf-8"))
for item in data.get("data",{}).get("models",[]):
    print(f"{item.get('id','')}:{item.get('status','')}")
PY

echo "=== end $(date -Iseconds) ==="
echo "LOG=$LOG"

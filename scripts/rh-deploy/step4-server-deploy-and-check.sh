#!/usr/bin/env bash
set -euo pipefail

MODEL_LIST="rh-pro-image,rh-image-v2,rh-gpt2-image,rh-gpt2-text,z-image-turbo,rh-video-v31-fast,rh-seedance2-text-video,rh-seedance2-image-video,rh-seedance2-multimodal-video,rh-grok-text-video,rh-grok-image-video,rh-aiapp-fast-digital-human,rh-aiapp-digital-human,rh-aiapp-director,rh-suno-v55-single,rh-suno-v55-custom,rh-suno-lyrics,rh-speech-hd,rh-speech-turbo,rh-music,rh-voice-clone,rh-aiapp-voice-clone,rh-aiapp-voice-design"
IMAGE_MODEL_LIST="rh-pro-image,rh-image-v2,rh-gpt2-image,rh-gpt2-text,z-image-turbo"
VIDEO_MODEL_LIST="rh-video-v31-fast,rh-seedance2-text-video,rh-seedance2-image-video,rh-seedance2-multimodal-video,rh-grok-text-video,rh-grok-image-video,rh-aiapp-fast-digital-human,rh-aiapp-digital-human,rh-aiapp-director"
AUDIO_MODEL_LIST="rh-suno-v55-single,rh-suno-v55-custom,rh-suno-lyrics,rh-speech-hd,rh-speech-turbo,rh-music,rh-voice-clone,rh-aiapp-voice-clone,rh-aiapp-voice-design"
RH_ADAPTER_DIR="/opt/rh-adapter"
CREATION_MODELS_DIR="/opt/creation-models"
STAMP="$(date +%Y%m%d-%H%M%S)"

log() {
  printf '\n=== %s ===\n' "$*"
}

require_root() {
  if [ "$(id -u)" != "0" ]; then
    echo "ERROR: please run as root" >&2
    exit 1
  fi
}

package_root() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cd "$script_dir/../.." && pwd
}

install_rh_adapter() {
  local root="$1"
  log "Install rh-adapter"
  if [ ! -f "$root/rh-adapter/docker-compose.yml" ]; then
    echo "ERROR: package missing rh-adapter/docker-compose.yml" >&2
    exit 1
  fi

  local tmp_env=""
  if [ -f "$RH_ADAPTER_DIR/.env" ]; then
    tmp_env="/tmp/rh-adapter.env.$STAMP"
    cp "$RH_ADAPTER_DIR/.env" "$tmp_env"
  else
    echo "ERROR: $RH_ADAPTER_DIR/.env not found; refusing to deploy without RUNNINGHUB_API_KEY" >&2
    exit 1
  fi

  if [ -d "$RH_ADAPTER_DIR" ]; then
    cp -a "$RH_ADAPTER_DIR" "${RH_ADAPTER_DIR}.backup.$STAMP"
  fi
  rm -rf "$RH_ADAPTER_DIR"
  mkdir -p "$RH_ADAPTER_DIR"
  cp -a "$root/rh-adapter/." "$RH_ADAPTER_DIR/"
  rm -rf "$RH_ADAPTER_DIR/.venv" "$RH_ADAPTER_DIR/.pytest_cache"
  find "$RH_ADAPTER_DIR" -type d -name __pycache__ -prune -exec rm -rf {} +
  cp "$tmp_env" "$RH_ADAPTER_DIR/.env"
  chmod 600 "$RH_ADAPTER_DIR/.env"

  cd "$RH_ADAPTER_DIR"
  docker compose build rh-adapter
  docker compose up -d rh-adapter
}

install_creation_models() {
  local root="$1"
  log "Install creation-models"
  if [ ! -f "$root/scripts/creation-models/server.mjs" ]; then
    echo "ERROR: package missing scripts/creation-models/server.mjs" >&2
    exit 1
  fi

  local tmp_env=""
  if [ -f "$CREATION_MODELS_DIR/.env" ]; then
    tmp_env="/tmp/creation-models.env.$STAMP"
    cp "$CREATION_MODELS_DIR/.env" "$tmp_env"
  fi

  if [ -d "$CREATION_MODELS_DIR" ]; then
    cp -a "$CREATION_MODELS_DIR" "${CREATION_MODELS_DIR}.backup.$STAMP"
  fi
  mkdir -p "$CREATION_MODELS_DIR"
  cp "$root/scripts/creation-models/server.mjs" "$CREATION_MODELS_DIR/server.mjs"
  if [ -n "$tmp_env" ]; then
    cp "$tmp_env" "$CREATION_MODELS_DIR/.env"
    chmod 600 "$CREATION_MODELS_DIR/.env"
  fi
  cp "$root/scripts/creation-models/creation-models.service" /etc/systemd/system/creation-models.service
  systemctl daemon-reload
  systemctl enable creation-models >/dev/null
  systemctl restart creation-models
}

install_nginx_rh_tasks() {
  local root="$1"
  log "Install /rh/tasks/ Nginx route"
  if [ -f "$root/scripts/rh-deploy/install-nginx-rh-tasks.py" ]; then
    python3 "$root/scripts/rh-deploy/install-nginx-rh-tasks.py"
    nginx -t
    systemctl reload nginx
  else
    echo "WARN: Nginx helper not found; skipping"
  fi
}

load_creation_models_env() {
  if [ -f "$CREATION_MODELS_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$CREATION_MODELS_DIR/.env"
    set +a
  fi
  : "${NEWAPI_PSQL_USER:=newapi}"
  : "${NEWAPI_PSQL_DB:=new-api}"
}

psql_in_postgres_container() {
  local sql="$1"
  local postgres_container
  postgres_container="$(docker ps -q -f name=postgres | head -n 1)"
  if [ -z "$postgres_container" ]; then
    echo "ERROR: postgres container not found" >&2
    return 1
  fi
  if [ -z "${NEWAPI_PSQL_PASSWORD:-}" ]; then
    echo "ERROR: NEWAPI_PSQL_PASSWORD is not configured in $CREATION_MODELS_DIR/.env" >&2
    return 1
  fi
  docker exec -e PGPASSWORD="$NEWAPI_PSQL_PASSWORD" "$postgres_container" \
    psql -h localhost -U "$NEWAPI_PSQL_USER" -d "$NEWAPI_PSQL_DB" -At -F $'\t' -c "$sql"
}

update_newapi_rh_channel_models() {
  log "Update NewAPI RH channel model list"
  load_creation_models_env
  local where_clause="base_url LIKE '%8789%' OR base_url LIKE '%rh-adapter%' OR models LIKE '%rh-pro-image%' OR models LIKE '%rh-gpt2-image%' OR models LIKE '%rh-seedance2%' OR models LIKE '%rh-kling-v30-pro%' OR models LIKE '%rh-veo-31%'"
  echo "Before:"
  psql_in_postgres_container "SELECT id,name,status,models FROM channels WHERE $where_clause ORDER BY id;" || return 0
  psql_in_postgres_container "UPDATE channels SET models=CASE WHEN name LIKE '%图片%' THEN '${IMAGE_MODEL_LIST}' WHEN name LIKE '%视频%' THEN '${VIDEO_MODEL_LIST}' WHEN name LIKE '%音频%' THEN '${AUDIO_MODEL_LIST}' ELSE '${MODEL_LIST}' END WHERE $where_clause RETURNING id,name,status,models;" || return 0
  echo "After:"
  psql_in_postgres_container "SELECT id,name,status,models FROM channels WHERE models LIKE '%rh-pro-image%' OR models LIKE '%rh-seedance2-text-video%' ORDER BY id;" || return 0
}

check_services() {
  log "Service checks"
  cd "$RH_ADAPTER_DIR"
  docker compose ps rh-adapter
  systemctl is-active creation-models nginx

  log "Adapter health"
  curl -fsS http://172.17.0.1:8789/health
  echo

  log "Adapter models"
  curl -fsS http://172.17.0.1:8789/v1/models
  echo

  log "Public /rh/tasks route"
  curl -sS -i https://api.jiucaihezi.studio/rh/tasks/step4-check | head -n 20

  log "Public creation model availability"
  curl -fsS https://api.jiucaihezi.studio/api/creation/models
  echo
}

optional_newapi_smoke() {
  if [ -z "${NEWAPI_TEST_TOKEN:-}" ]; then
    log "NewAPI smoke skipped"
    echo "Set NEWAPI_TEST_TOKEN before running this script to execute paid Step 4 submit/poll smoke tests."
    return 0
  fi

  log "NewAPI /v1/models"
  curl -fsS -H "Authorization: Bearer ${NEWAPI_TEST_TOKEN}" https://api.jiucaihezi.studio/v1/models | head -c 4000
  echo

  log "Low-cost image submit smoke: rh-gpt2-text"
  curl -fsS https://api.jiucaihezi.studio/v1/images/generations \
    -H "Authorization: Bearer ${NEWAPI_TEST_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"model":"rh-gpt2-text","prompt":"small red paper square on white background","aspect_ratio":"1:1","resolution":"720p"}'
  echo
}

main() {
  require_root
  local root
  root="$(package_root)"
  log "RH Step 4 deploy/check start"
  date -Iseconds
  install_rh_adapter "$root"
  install_creation_models "$root"
  install_nginx_rh_tasks "$root"
  update_newapi_rh_channel_models
  check_services
  optional_newapi_smoke
  log "RH Step 4 deploy/check finished"
}

main "$@"

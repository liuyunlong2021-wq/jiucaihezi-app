#!/usr/bin/env bash
# Safely add OSS direct uploads to the deployed NewAPI rc.40 media extension.
set -euo pipefail
umask 077
BASE=/root/new-api-new
BASE_TAG=jiucaihezi/new-api:rc40-local-media-20261006
BASE_ID=sha256:59fe85edf1175981780b08ad99c072d07e1f29e8869e12ec45fae470dc80f24d
IMAGE=jiucaihezi/new-api:rc40-local-media-ossdirect-20261009
MEDIA_OVERRIDE=$BASE/docker-compose.media.yml
OSS_OVERRIDE=$BASE/docker-compose.oss-direct.yml
OSS_ENV=/root/jc-oss.env
[ "$(id -u)" = 0 ] || { echo 'Run as root';exit 1; }
[ "$(docker inspect new-api --format '{{.Config.Image}}')" = "$BASE_TAG" ] || { echo 'Production image tag changed; stop and review';exit 1; }
[ "$(docker inspect new-api --format '{{.Image}}')" = "$BASE_ID" ] || { echo 'Production image ID changed; stop and review';exit 1; }
[ "$(docker inspect new-api --format '{{index .Config.Labels "com.docker.compose.project"}}')" = 'new-api-new' ] || { echo 'Compose project changed; stop and review';exit 1; }
[ "$(docker inspect new-api --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')" = "$BASE" ] || { echo 'Compose directory changed; stop and review';exit 1; }
[ "$(docker inspect new-api --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}')" = "$BASE/docker-compose.yml,$MEDIA_OVERRIDE" ] || { echo 'Production Compose files changed; stop and review';exit 1; }
[ -s "$MEDIA_OVERRIDE" ] && grep -Fq "image: $BASE_TAG" "$MEDIA_OVERRIDE" || { echo 'Current media override changed; stop and review';exit 1; }
[ -s "$OSS_ENV" ] || { echo 'Missing /root/jc-oss.env; configure the bucket-scoped RAM key first';exit 1; }
[ "$(stat -c '%a' "$OSS_ENV" 2>/dev/null || stat -f '%Lp' "$OSS_ENV")" = 600 ] || { echo '/root/jc-oss.env must have mode 600';exit 1; }
for name in OSS_ENDPOINT OSS_REGION OSS_BUCKET OSS_ACCESS_KEY_ID OSS_ACCESS_KEY_SECRET; do
  grep -Eq "^${name}=.+$" "$OSS_ENV" || { echo "Missing $name in /root/jc-oss.env";exit 1; }
done
docker image inspect "$IMAGE" >/dev/null
[ ! -e "$OSS_OVERRIDE" ] || { echo 'OSS direct Compose override already exists; stop and review';exit 1; }
PROJECT=new-api-new
AVAILABLE=$(df --output=avail -B1 / | tail -1)
[ "$AVAILABLE" -gt 5368709120 ] || { echo 'Need at least 5GB free before database backup';exit 1; }
BACKUP=/root/jc-oss-switch-$(date -u +%Y%m%dT%H%M%SZ)
mkdir -m 700 "$BACKUP"
cp "$BASE/docker-compose.yml" "$BACKUP/docker-compose.yml"
cp "$MEDIA_OVERRIDE" "$BACKUP/docker-compose.media.yml"
cp -a /etc/nginx "$BACKUP/nginx"
OLD_ID=$(docker inspect new-api --format '{{.Image}}')
ROLLBACK_IMAGE=jiucaihezi/new-api:rollback-oss-$(date -u +%Y%m%dT%H%M%SZ)
docker tag "$OLD_ID" "$ROLLBACK_IMAGE"
printf '%s\n' "$ROLLBACK_IMAGE" > "$BACKUP/old-image.txt"
printf '%s\n' "$PROJECT" > "$BACKUP/project.txt"
printf 'services:\n  new-api:\n    image: %s\n' "$ROLLBACK_IMAGE" > "$BACKUP/rollback.yml"
SWITCHED=0
cleanup() {
  rc=$?
  rm -f "$BACKUP/verify.curl" "$BACKUP/oss-upload.curl" "$BACKUP/asset-url.txt" "$BACKUP/upload-grant.json"
  if [ "$rc" -ne 0 ] && [ "$SWITCHED" = 1 ]; then
    echo '验证失败，恢复原媒体镜像……'
    docker compose -p "$PROJECT" -f "$BASE/docker-compose.yml" -f "$MEDIA_OVERRIDE" -f "$BACKUP/rollback.yml" up -d --no-deps --force-recreate new-api || { echo "自动回滚失败；备份目录：$BACKUP";exit "$rc"; }
    rm -f "$OSS_OVERRIDE"
    echo '原媒体镜像已恢复；保留了原 docker-compose.media.yml。请把日志发回核实健康状态。'
  fi
  exit "$rc"
}
trap cleanup EXIT
printf '数据库备份中（不输出凭据）……\n'
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
python3 "$HERE/backup_db.py" "$BACKUP"
# Read the user token without echoing it; keep it only in a root-only temporary curl config.
printf '请粘贴一个当前有效的 NewAPI 用户 Key（隐藏输入，仅验上传，不生成、不扣费）：\n'
IFS= read -r -s KEY </dev/tty
printf '\n'
[[ "$KEY" =~ ^sk-[A-Za-z0-9_-]+$ ]] || { unset KEY;echo 'Key 格式不正确，未切换生产';exit 1; }
printf 'header = "Authorization: Bearer %s"\n' "$KEY" > "$BACKUP/verify.curl"
unset KEY
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' | base64 -d > "$BACKUP/reference.png"
SIZE=$(wc -c < "$BACKUP/reference.png" | tr -d ' ')
printf '{"content_type":"image/png","size":%s}\n' "$SIZE" > "$BACKUP/upload-request.json"

printf 'services:\n  new-api:\n    image: %s\n    env_file:\n      - %s\n' "$IMAGE" "$OSS_ENV" > "$OSS_OVERRIDE"
SWITCHED=1
docker compose -p "$PROJECT" -f "$BASE/docker-compose.yml" -f "$MEDIA_OVERRIDE" -f "$OSS_OVERRIDE" up -d --no-deps --force-recreate new-api
READY=0
for ((i=0;i<60;i++)); do
  if curl -fsS --max-time 5 http://127.0.0.1:3000/api/status > "$BACKUP/status.json" && python3 - "$BACKUP/status.json" <<'PY'
import json,sys
v=json.load(open(sys.argv[1]));assert v.get('success') is True
PY
  then READY=1;break;fi
  sleep 2
done
[ "$READY" = 1 ]

# Preserve and verify the existing local-media upload contract.
CODE=$(curl -sS --max-time 10 -o "$BACKUP/unauth-local.json" -w '%{http_code}' -X POST http://127.0.0.1:3000/api/creations/uploads)
[ "$CODE" = 401 ] || { echo "未登录本地上传校验异常：$CODE";exit 1; }
curl -fsS --max-time 120 --config "$BACKUP/verify.curl" -F "file=@$BACKUP/reference.png;type=image/png" http://127.0.0.1:3000/api/creations/uploads > "$BACKUP/local-upload.json"
TOKEN=$(python3 - "$BACKUP/local-upload.json" <<'PY'
import json,re,sys
v=json.load(open(sys.argv[1]));m=re.fullmatch(r'https://api\.jiucaihezi\.studio/media/creation/([a-f0-9]{32})',v['url']);assert m;print(m[1])
PY
)
curl -fsS --max-time 30 "http://127.0.0.1:3000/media/creation/$TOKEN" -o "$BACKUP/local-readback.png"
cmp "$BACKUP/reference.png" "$BACKUP/local-readback.png"

# Verify the new authenticated grant and the actual app-to-OSS byte path.
CODE=$(curl -sS --max-time 10 -o "$BACKUP/unauth-oss.json" -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data-binary "@$BACKUP/upload-request.json" http://127.0.0.1:3000/api/creations/upload-url)
[ "$CODE" = 401 ] || { echo "未登录 OSS 授权校验异常：$CODE";exit 1; }
curl -fsS --max-time 15 --config "$BACKUP/verify.curl" -H 'Content-Type: application/json' --data-binary "@$BACKUP/upload-request.json" http://127.0.0.1:3000/api/creations/upload-url -o "$BACKUP/upload-grant.json"
python3 - "$BACKUP/upload-grant.json" "$BACKUP/oss-upload.curl" "$BACKUP/asset-url.txt" "$BACKUP/reference.png" <<'PY'
import json,pathlib,sys
grant=json.load(open(sys.argv[1]))
url=grant['upload_url'];asset=grant['asset_url'];fields=grant['form_fields']
assert url.startswith('https://') and asset.startswith('https://')
assert {'key','Content-Type','policy','x-oss-signature-version','x-oss-credential','x-oss-date','x-oss-signature'} <= set(fields)
config=['url = '+json.dumps(url)]
config += ['form-string = '+json.dumps(k+'='+v) for k,v in fields.items()]
config += ['form = '+json.dumps('file=@'+sys.argv[4]+';type=image/png')]
pathlib.Path(sys.argv[2]).write_text('\n'.join(config)+'\n')
pathlib.Path(sys.argv[3]).write_text(asset+'\n')
PY
curl -sS --show-error --fail --max-time 120 --config "$BACKUP/oss-upload.curl" -o "$BACKUP/oss-upload-result.xml"
ASSET_URL=$(cat "$BACKUP/asset-url.txt")
curl -sS --show-error --fail --max-time 30 "$ASSET_URL" -o "$BACKUP/oss-readback.png"
cmp "$BACKUP/reference.png" "$BACKUP/oss-readback.png"

printf '\nORIGIN VERIFIED: 健康检查、现有素材上传读回、OSS 未登录 401、直传授权和 OSS 字节读回全部通过。\n备份目录：%s\n' "$BACKUP"
printf 'NewAPI 已切换；原 docker-compose.media.yml 保留。测试写入的 OSS 小文件按 creation-temp/ 生命周期规则过期删除。\n'

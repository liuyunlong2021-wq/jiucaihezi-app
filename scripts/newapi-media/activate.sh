#!/usr/bin/env bash
# Switch only NewAPI after backup; verify origin upload, never submit generation.
set -euo pipefail
umask 077
BASE=/root/new-api-new
IMAGE=jiucaihezi/new-api:rc40-local-media-20261006
[ "$(id -u)" = 0 ] || { echo 'Run as root';exit 1; }
[ "$(docker inspect new-api --format '{{.Config.Image}}')" = calciumion/new-api:v1.0.0-rc.40 ] || { echo 'Production image changed; stop and review';exit 1; }
[ "$(docker inspect new-api --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}')" = "$BASE/docker-compose.yml" ] || { echo 'Compose config changed; stop and review';exit 1; }
docker image inspect "$IMAGE" >/dev/null
PROJECT=$(docker inspect new-api --format '{{index .Config.Labels "com.docker.compose.project"}}')
[ -n "$PROJECT" ]
[ ! -e "$BASE/docker-compose.media.yml" ] || { echo 'Media override already exists; stop and review';exit 1; }
AVAILABLE=$(df --output=avail -B1 / | tail -1)
[ "$AVAILABLE" -gt 5368709120 ] || { echo 'Need at least 5GB free before database backup';exit 1; }
BACKUP=/root/jc-media-switch-$(date -u +%Y%m%dT%H%M%SZ)
mkdir -m 700 "$BACKUP"
cp "$BASE/docker-compose.yml" "$BACKUP/docker-compose.yml"
cp -a /etc/nginx "$BACKUP/nginx"
OLD_ID=$(docker inspect new-api --format '{{.Image}}')
ROLLBACK_IMAGE=jiucaihezi/new-api:rollback-media-$(date -u +%Y%m%dT%H%M%SZ)
docker tag "$OLD_ID" "$ROLLBACK_IMAGE"
printf '%s\n' "$ROLLBACK_IMAGE" > "$BACKUP/old-image.txt"
printf '%s\n' "$PROJECT" > "$BACKUP/project.txt"
printf 'services:\n  new-api:\n    image: %s\n' "$ROLLBACK_IMAGE" > "$BACKUP/rollback.yml"
printf '数据库备份中（不输出凭据）……\n'
docker exec postgres sh -c 'exec pg_dumpall -U "${POSTGRES_USER:-postgres}"' | gzip > "$BACKUP/postgres.sql.gz"
gzip -t "$BACKUP/postgres.sql.gz"
[ "$(stat -c %s "$BACKUP/postgres.sql.gz")" -gt 1024 ]
# Ask before changing production. /dev/tty keeps the key out of shell history/logs.
printf '请粘贴一个当前有效的 NewAPI 用户 Key（隐藏输入，仅验证上传，不生成、不扣费）：\n'
IFS= read -r -s KEY </dev/tty
printf '\n'
[[ "$KEY" =~ ^sk-[A-Za-z0-9_-]+$ ]] || { unset KEY;echo 'Key 格式不正确，未切换生产';exit 1; }
printf 'header = "Authorization: Bearer %s"\n' "$KEY" > "$BACKUP/verify.curl"
unset KEY
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' | base64 -d > "$BACKUP/reference.png"
SWITCHED=0
rollback() {
 rc=$?
 rm -f "$BACKUP/verify.curl"
 if [ "$rc" -ne 0 ] && [ "$SWITCHED" = 1 ]; then
  echo '验证失败，恢复固定的旧镜像……'
  docker compose -p "$PROJECT" -f "$BASE/docker-compose.yml" -f "$BACKUP/rollback.yml" up -d --no-deps --force-recreate new-api || { echo "自动回滚失败；备份目录：$BACKUP";exit "$rc"; }
  rm -f "$BASE/docker-compose.media.yml"
  echo '旧镜像容器已重建；请把日志发回核实健康状态。'
 fi
 exit "$rc"
}
trap rollback EXIT
printf 'services:\n  new-api:\n    image: %s\n' "$IMAGE" > "$BASE/docker-compose.media.yml"
SWITCHED=1
docker compose -p "$PROJECT" -f "$BASE/docker-compose.yml" -f "$BASE/docker-compose.media.yml" up -d --no-deps --force-recreate new-api
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
CODE=$(curl -sS --max-time 10 -o "$BACKUP/unauth.json" -w '%{http_code}' -X POST http://127.0.0.1:3000/api/creations/uploads)
[ "$CODE" = 401 ] || { echo "未登录校验异常：$CODE";exit 1; }
curl -fsS --max-time 120 --config "$BACKUP/verify.curl" -F "file=@$BACKUP/reference.png;type=image/png" http://127.0.0.1:3000/api/creations/uploads > "$BACKUP/upload.json"
TOKEN=$(python3 - "$BACKUP/upload.json" <<'PY'
import json,re,sys
v=json.load(open(sys.argv[1]));m=re.fullmatch(r'https://api\.jiucaihezi\.studio/media/creation/([a-f0-9]{32})',v['url']);assert m;print(m[1])
PY
)
curl -fsS --max-time 30 "http://127.0.0.1:3000/media/creation/$TOKEN" -o "$BACKUP/readback.png"
cmp "$BACKUP/reference.png" "$BACKUP/readback.png"
curl -fsS --max-time 30 -H 'Range: bytes=0-7' "http://127.0.0.1:3000/media/creation/$TOKEN" -o "$BACKUP/range.bin"
head -c 8 "$BACKUP/reference.png" | cmp - "$BACKUP/range.bin"
HEAD_CODE=$(curl -sS --max-time 10 -I -o /dev/null -w '%{http_code}' "http://127.0.0.1:3000/media/creation/$TOKEN")
[ "$HEAD_CODE" = 200 ]
rm -f "$BACKUP/verify.curl"
printf '\nORIGIN VERIFIED: 健康检查、401 鉴权、上传读回、Range 和 HEAD 全部通过。\n备份目录：%s\n' "$BACKUP"
printf 'NewAPI 已切换。公网上传暂未切换：等待撤下 Cloudflare 旧路由。\n今后 Compose 操作需要同时使用 docker-compose.yml 和 docker-compose.media.yml。\n'

#!/usr/bin/env bash
# Repair the existing OSS-direct image. Local mock tests never call paid providers.
set -euo pipefail
umask 077
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SOURCE=/opt/jc-newapi-media/source
BASE=/root/new-api-new
OLD_TAG=jiucaihezi/new-api:rc40-local-media-ossdirect-20261009
IMAGE=jiucaihezi/new-api:rc40-local-media-ossdirect-multipart-20261009
UPSTREAM=0aec08fee811ec6136828fda790551b49e410301
OVERRIDE=$BASE/docker-compose.oss-direct.yml
FILES=$BASE/docker-compose.yml,$BASE/docker-compose.media.yml,$OVERRIDE
[ "$(id -u)" = 0 ] || { echo 'Run as root'; exit 1; }
[ "$(docker inspect new-api --format '{{.Config.Image}}')" = "$OLD_TAG" ] || { echo 'Production image changed; stop and inspect'; exit 1; }
[ "$(docker inspect new-api --format '{{.State.Running}}')" = true ]
[ "$(docker inspect new-api --format '{{index .Config.Labels "com.docker.compose.project"}}')" = new-api-new ]
[ "$(docker inspect new-api --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}')" = "$FILES" ] || { echo 'Compose files changed; stop and inspect'; exit 1; }
[ "$(git -C "$SOURCE" rev-parse HEAD)" = "$UPSTREAM" ] || { echo 'Unexpected upstream revision'; exit 1; }
[ -s "$OVERRIDE" ] && [ -s /root/jc-oss.env ]
[ "$(df --output=avail -B1 / | tail -1)" -gt 5368709120 ] || { echo 'Need at least 5GB free'; exit 1; }
python3 "$HERE/patch_task_multipart.py" "$SOURCE"
python3 - "$SOURCE" <<'PY'
import subprocess,sys
changed=subprocess.check_output(['git','-C',sys.argv[1],'diff','--name-only']).decode().splitlines()
assert set(changed) <= {'router/main.go','relay/channel/task/jsplugin/adaptor.go'}, 'Unexpected tracked source changes'
from pathlib import Path
original=subprocess.check_output(['git','-C',sys.argv[1],'show','HEAD:router/main.go']).decode()
expected=original.replace('SetRelayRouter(router)','SetRelayRouter(router)\n\tSetCreationMediaRouter(router)',1)
assert (Path(sys.argv[1])/'router/main.go').read_text() == expected, 'Unexpected media router registration'
PY
# Keep both original product extensions. No replacement of their configuration.
cmp "$HERE/extension/jcmedia/store.go" "$SOURCE/jcmedia/store.go"
cmp "$HERE/extension/ossdirect/signer.go" "$SOURCE/ossdirect/signer.go"
cmp "$HERE/extension/creation_media_router.go" "$SOURCE/router/creation_media_router.go"
TEST_DIR=$SOURCE/relay/channel/task/jsplugin
mkdir -p "$TEST_DIR/jc-test-plugins"
cp "$HERE/regression/task_multipart_header_test.go" "$TEST_DIR/jc_multipart_header_test.go"
cp "$HERE/../../newapi-plugins/fk.plugin.js" "$HERE/../../newapi-plugins/xiaoyi-image.plugin.js" "$TEST_DIR/jc-test-plugins/"
# Reuse the existing Docker build cache; test inside the real Linux builder.
docker build --progress plain --target builder2 -t "$IMAGE-build" "$SOURCE"
docker run --rm --entrypoint go "$IMAGE-build" test ./relay/channel/task/jsplugin ./jcmedia ./ossdirect
docker build --progress plain -t "$IMAGE" "$SOURCE"
NEW_ID=$(docker image inspect "$IMAGE" --format '{{.Id}}')
OLD_ID=$(docker inspect new-api --format '{{.Image}}')
BACKUP=/root/jc-multipart-switch-$(date -u +%Y%m%dT%H%M%SZ)
mkdir -m 700 "$BACKUP"
cp -a "$OVERRIDE" "$BACKUP/docker-compose.oss-direct.yml"
cat > "$BACKUP/rollback.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cp -a '$BACKUP/docker-compose.oss-direct.yml' '$OVERRIDE'
docker compose -p new-api-new -f '$BASE/docker-compose.yml' -f '$BASE/docker-compose.media.yml' -f '$OVERRIDE' up -d --no-deps --force-recreate new-api
EOF
docker tag "$OLD_ID" "jiucaihezi/new-api:rollback-multipart-$(basename "$BACKUP")"
compose() {
  docker compose -p new-api-new -f "$BASE/docker-compose.yml" -f "$BASE/docker-compose.media.yml" -f "$OVERRIDE" "$@"
}
SWITCHED=0
cleanup() {
  rc=$?
  trap - EXIT
  if [ "$rc" != 0 ] && [ "$SWITCHED" = 1 ]; then
    cp -a "$BACKUP/docker-compose.oss-direct.yml" "$OVERRIDE"
    compose up -d --no-deps --force-recreate new-api
    echo "Repair failed; previous Compose restored. Backup: $BACKUP"
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
python3 "$HERE/backup_db.py" "$BACKUP"
# Check the running baseline again after the build, before the short restart.
[ "$(docker inspect new-api --format '{{.Image}}')" = "$OLD_ID" ]
[ "$(docker inspect new-api --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}')" = "$FILES" ]
SWITCHED=1
python3 - "$OVERRIDE" "$OLD_TAG" "$IMAGE" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1]);s=p.read_text()
pattern=r'(?m)^([ \t]+image:[ \t]*)'+re.escape(sys.argv[2])+r'[ \t]*$'
assert len(re.findall(pattern,s)) == 1, 'Unexpected image override'
p.write_text(re.sub(pattern,lambda m:m.group(1)+sys.argv[3],s))
PY
compose up -d --no-deps --force-recreate new-api
READY=0
for ((i=0;i<60;i++)); do
  if curl -fsS --max-time 5 http://127.0.0.1:3000/api/status > "$BACKUP/status.json" && python3 - "$BACKUP/status.json" <<'PY'
import json,sys
assert json.load(open(sys.argv[1])).get('success') is True
PY
  then READY=1; break; fi
  sleep 2
done
[ "$READY" = 1 ]
[ "$(docker inspect new-api --format '{{.Image}}')" = "$NEW_ID" ]
printf 'MULTIPART HOST FIX ACTIVE\n备份目录：%s\n本地模拟上游测试已通过；未调用付费生成，真实图生图需继续验收。\n' "$BACKUP"

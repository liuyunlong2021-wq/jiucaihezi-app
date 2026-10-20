#!/usr/bin/env bash
# Prepare the six-model Yihong R2 host extension; never activate or change Compose.
set -euo pipefail
umask 077
[ "$(id -u)" = 0 ] || { echo 'Run as root on the server'; exit 1; }
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SOURCE=/opt/jc-newapi-media/source
IMAGE=jiucaihezi/new-api:rc40-yihong-six-r2-20261019
OLD_ID=sha256:c9ff2598d34790b2ee2848e7e75984198b9716788d98cf9f77d98737fd9a6ab4
FILES=/root/new-api-new/docker-compose.yml,/root/new-api-new/docker-compose.media.yml,/root/new-api-new/docker-compose.oss-direct.yml,/root/new-api-new/docker-compose.r2.json
stop() { echo "$1"; exit 1; }
[ "$(docker inspect new-api --format '{{.Image}}')" = "$OLD_ID" ] || stop 'Production image changed; stop and inspect'
[ "$(docker inspect new-api --format '{{.State.Running}}')" = true ] || stop 'Production is not running'
[ "$(docker inspect new-api --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}')" = "$FILES" ] || stop 'Compose baseline changed'
[ "$(git -C "$SOURCE" rev-parse HEAD)" = 0aec08fee811ec6136828fda790551b49e410301 ] || stop 'Source revision changed'
if docker image inspect "$IMAGE" >/dev/null 2>&1; then stop 'Prepared image already exists; do not overwrite'; fi
[ "$(df --output=avail -B1 / | tail -1)" -gt 5368709120 ] || stop 'Less than 5 GiB available; stop without deleting anything'
cmp "$HERE/extension/ossdirect/signer.go" "$SOURCE/ossdirect/signer.go"
cmp "$HERE/extension/jcmedia/store.go" "$SOURCE/jcmedia/store.go"
for file in signer.go signer_test.go; do [ -f "$SOURCE/r2direct/$file" ] || stop 'Existing R2 source incomplete'; done
if ! cmp -s "$HERE/extension/creation_media_router.go" "$SOURCE/router/creation_media_router.go"; then
    [ "$(sha256sum "$SOURCE/router/creation_media_router.go" | cut -d ' ' -f1)" = 114d509a539ef734281b2d78d380fd3c894e6469bd15582eff1080afdfaa1b85 ] || stop 'Media router changed'
fi
if ! cmp -s "$HERE/extension/r2direct/signer.go" "$SOURCE/r2direct/signer.go"; then
    [ "$(sha256sum "$SOURCE/r2direct/signer.go" | cut -d ' ' -f1)" = 0402bb6915d316758a704bb9d86ba2ce97510e2114904064a9591440b2c9e9c2 ] || stop 'R2 signer changed'
fi
python3 - "$SOURCE" <<'PY'
from pathlib import Path
import sys
root = Path(sys.argv[1])
assert 'SetCreationMediaRouter(router)' in (root/'router/main.go').read_text(), 'Media router not registered'
assert 'descriptor.Headers["Content-Type"] = writer.FormDataContentType()' in (root/'relay/channel/task/jsplugin/adaptor.go').read_text(), 'Existing multipart fix missing'
PY
BACKUP=$(mktemp -d /root/jc-yihong-r2-source.XXXXXX)
cp -a "$SOURCE/router/creation_media_router.go" "$BACKUP/creation_media_router.go"
cp -a "$SOURCE/r2direct" "$BACKUP/r2direct"
printf 'Source backup: %s\n' "$BACKUP"
restore_on_failure() {
    rc=$?
    trap - EXIT
    if [ "$rc" != 0 ]; then
        cp -a "$BACKUP/creation_media_router.go" "$SOURCE/router/creation_media_router.go"
        cp -a "$BACKUP/r2direct/signer.go" "$BACKUP/r2direct/signer_test.go" "$SOURCE/r2direct/"
        echo 'Preparation failed; media source restored. Production was not switched.'
    fi
    exit "$rc"
}
trap restore_on_failure EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
cp "$HERE/extension/creation_media_router.go" "$SOURCE/router/creation_media_router.go"
cp "$HERE/extension/r2direct/signer.go" "$HERE/extension/r2direct/signer_test.go" "$SOURCE/r2direct/"
docker build --progress plain --target builder2 -t "$IMAGE-build" "$SOURCE"
docker run --rm --network none --entrypoint go "$IMAGE-build" test -mod=readonly ./r2direct ./ossdirect ./jcmedia ./relay/channel/task/jsplugin
docker build --progress plain -t "$IMAGE" "$SOURCE"
[ "$(docker inspect new-api --format '{{.Image}}')" = "$OLD_ID" ] || stop 'Production changed during preparation; do not activate'
[ "$(docker inspect new-api --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}')" = "$FILES" ] || stop 'Compose changed during preparation'
docker image inspect "$IMAGE" --format 'PREPARED {{.Id}}'
df -h /
echo 'Only prepared the image. Production, databases, credentials and plugins unchanged.'

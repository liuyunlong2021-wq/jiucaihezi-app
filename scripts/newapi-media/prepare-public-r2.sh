#!/bin/bash
# Build only. Keep existing production, credentials, Compose files and databases untouched.
set -euo pipefail
umask 077
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SOURCE=/opt/jc-newapi-media/source
IMAGE=jiucaihezi/new-api:rc40-public-r2-20261021
stop() { echo "$1"; exit 1; }
[ "$(id -u)" = 0 ] || stop 'Run as root on the existing NewAPI host'
[ "$#" = 1 ] || stop 'Usage: bash prepare-public-r2.sh <verified-current-image-sha256>'
EXPECTED=$1
[[ "$EXPECTED" =~ ^sha256:[a-f0-9]{64}$ ]] || stop 'Expected exact current image ID'
[ "$(docker inspect new-api --format '{{.Image}}')" = "$EXPECTED" ] || stop 'Production image changed'
[ "$(docker inspect new-api --format '{{.State.Running}}')" = true ] || stop 'Production is not running'
[ "$(git -C "$SOURCE" rev-parse HEAD)" = 0aec08fee811ec6136828fda790551b49e410301 ] || stop 'Source revision changed'
[ "$(sha256sum "$SOURCE/router/creation_media_router.go" | cut -d ' ' -f1)" = 67d6620971d5b743c06ef66f19a28921ac8dfc98ea9887b9bd2e5f9046f676da ] || stop 'Media router baseline changed; inspect before preparing'
[ "$(sha256sum "$SOURCE/r2direct/signer.go" | cut -d ' ' -f1)" = 356d4646af8ba7cc787618142105158f2c389e2d7a92199837aa5854eb761684 ] || stop 'R2 source baseline changed; inspect before preparing'
[ ! -e "$SOURCE/r2direct/handler.go" ] && [ ! -e "$SOURCE/r2direct/handler_test.go" ] || stop 'Public R2 handler already exists; inspect first'
if docker image inspect "$IMAGE" >/dev/null 2>&1; then stop 'Target image exists; do not overwrite'; fi
[ "$(df --output=avail -B1 / | tail -1)" -gt 5368709120 ] || stop 'Less than 5 GiB free; do not delete other services'
python3 - "$SOURCE" <<'CHECK'
from pathlib import Path
import sys
root=Path(sys.argv[1])
assert 'SetCreationMediaRouter(router)' in (root/'router/main.go').read_text(), 'Media router not registered'
assert 'descriptor.Headers["Content-Type"] = writer.FormDataContentType()' in (root/'relay/channel/task/jsplugin/adaptor.go').read_text(), 'Existing multipart fix missing'
CHECK
BACKUP=$(mktemp -d /root/jc-public-r2-source.XXXXXX)
cp -a "$SOURCE/router/creation_media_router.go" "$BACKUP/creation_media_router.go"
cp -a "$SOURCE/r2direct" "$BACKUP/r2direct"
restore() {
 rc=$?
 trap - EXIT
 if [ "$rc" != 0 ]; then
  cp -a "$BACKUP/creation_media_router.go" "$SOURCE/router/creation_media_router.go"
  cp -a "$BACKUP/r2direct/signer.go" "$BACKUP/r2direct/signer_test.go" "$SOURCE/r2direct/"
  rm -f "$SOURCE/r2direct/handler.go" "$SOURCE/r2direct/handler_test.go"
  echo 'Build failed; original source restored. Production untouched.'
 fi
 exit "$rc"
}
trap restore EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
cp "$HERE/extension/creation_media_router.go" "$SOURCE/router/creation_media_router.go"
cp "$HERE/extension/r2direct/"*.go "$SOURCE/r2direct/"
docker build --progress plain --target builder2 -t "$IMAGE-build" "$SOURCE"
docker run --rm --network none --entrypoint go "$IMAGE-build" test -mod=readonly ./r2direct ./ossdirect ./jcmedia ./router ./relay/channel/task/jsplugin
docker build --progress plain -t "$IMAGE" "$SOURCE"
[ "$(docker inspect new-api --format '{{.Image}}')" = "$EXPECTED" ] || stop 'Production changed while preparing'
docker image inspect "$IMAGE" --format 'PUBLIC R2 PREPARED {{.Id}}'
printf 'Source backup: %s\n' "$BACKUP"
echo 'Image prepared only. Activation requires current Compose/runtime comparison, verified database backup and automatic rollback; do not rerun old activation scripts.'

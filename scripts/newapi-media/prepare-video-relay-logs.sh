#!/bin/bash
# Build only. Keep existing production, credentials, Compose files and databases untouched.
# Hardens the deployed R2 video relay: failure logs without signed URLs, upload deadline from upload start.
set -euo pipefail
umask 077
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SOURCE=/opt/jc-newapi-media/source
IMAGE=jiucaihezi/new-api:rc40-video-relay-logs-20261026
stop() { echo "$1"; exit 1; }
[ "$(id -u)" = 0 ] || stop 'Run as root on the existing NewAPI host'
[ "$#" = 1 ] || stop 'Usage: bash prepare-video-relay-logs.sh <verified-current-image-sha256>'
EXPECTED=$1
[[ "$EXPECTED" =~ ^sha256:[a-f0-9]{64}$ ]] || stop 'Expected exact current image ID'
[ "$(docker inspect new-api --format '{{.Image}}')" = "$EXPECTED" ] || stop 'Production image changed'
[ "$(docker inspect new-api --format '{{.State.Running}}')" = true ] || stop 'Production is not running'
[ "$(git -C "$SOURCE" rev-parse HEAD)" = 0aec08fee811ec6136828fda790551b49e410301 ] || stop 'Source revision changed'
# Baselines are the files shipped in the first relay bundle (7394975a), now in production.
pin() { [ "$(sha256sum "$SOURCE/$1" | cut -d ' ' -f1)" = "$2" ] || stop "$1 baseline changed; inspect before preparing"; }
pin router/creation_media_router.go 408a0a8b6900b5f8e72c3a6f9ddd6267aa7cb3bd17bfd27ca481143cd3934f9f
pin r2direct/results.go 8df4ff2a6db11790bffdee1ea8b20079455c146f40368fc29789c2852e3e3c1c
pin r2direct/results_test.go b96bf8dc9823674e2397891d2d17b24d3e7ee0a1a8788343b858408ad42963f2
pin r2direct/signer.go 9ff8ab07d551d142dc3d9d495d543f508d62709676edfb3a41cb479c6dcafaf5
if docker image inspect "$IMAGE" >/dev/null 2>&1; then stop 'Target image exists; do not overwrite'; fi
[ "$(df --output=avail -B1 / | tail -1)" -gt 5368709120 ] || stop 'Less than 5 GiB free; do not delete other services'
python3 - "$SOURCE" <<'CHECK'
from pathlib import Path
import sys
root=Path(sys.argv[1])
assert 'SetCreationMediaRouter(router)' in (root/'router/main.go').read_text(), 'Media router not registered'
assert any('func TokenAuthReadOnly(' in p.read_text() for p in (root/'middleware').glob('*.go')), 'TokenAuthReadOnly missing'
CHECK
BACKUP=$(mktemp -d /root/jc-video-relay-logs-source.XXXXXX)
cp -a "$SOURCE/router/creation_media_router.go" "$BACKUP/creation_media_router.go"
cp -a "$SOURCE/r2direct" "$BACKUP/r2direct"
restore() {
 rc=$?
 trap - EXIT
 if [ "$rc" != 0 ]; then
  cp -a "$BACKUP/creation_media_router.go" "$SOURCE/router/creation_media_router.go"
  rm -rf "$SOURCE/r2direct"
  cp -a "$BACKUP/r2direct" "$SOURCE/"
  echo 'Build failed; original source restored. Production untouched.'
 fi
 exit "$rc"
}
trap restore EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
cp "$HERE/extension/creation_media_router.go" "$SOURCE/router/creation_media_router.go"
cp "$HERE/extension/r2direct/results.go" "$HERE/extension/r2direct/results_test.go" "$SOURCE/r2direct/"
docker build --progress plain --target builder2 -t "$IMAGE-build" "$SOURCE"
docker run --rm --network none --entrypoint go "$IMAGE-build" test -mod=readonly ./r2direct ./ossdirect ./jcmedia ./router ./relay/channel/task/jsplugin
docker build --progress plain -t "$IMAGE" "$SOURCE"
[ "$(docker inspect new-api --format '{{.Image}}')" = "$EXPECTED" ] || stop 'Production changed while preparing'
docker image inspect "$IMAGE" --format 'VIDEO RELAY LOGS PREPARED {{.Id}}'
printf 'Source backup: %s\n' "$BACKUP"
echo 'Image prepared only. Production was not switched; activation needs its own reviewed script.'

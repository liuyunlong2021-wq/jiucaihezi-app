#!/bin/bash
# Build only. Keep existing production, credentials, Compose files and databases untouched.
# Adds GET /api/creations/videos/:task_id/content (R2 video relay) on top of the public R2 image.
set -euo pipefail
umask 077
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SOURCE=/opt/jc-newapi-media/source
IMAGE=jiucaihezi/new-api:rc40-video-relay-20261026
stop() { echo "$1"; exit 1; }
[ "$(id -u)" = 0 ] || stop 'Run as root on the existing NewAPI host'
[ "$#" = 1 ] || stop 'Usage: bash prepare-video-relay.sh <verified-current-image-sha256>'
EXPECTED=$1
[[ "$EXPECTED" =~ ^sha256:[a-f0-9]{64}$ ]] || stop 'Expected exact current image ID'
[ "$(docker inspect new-api --format '{{.Image}}')" = "$EXPECTED" ] || stop 'Production image changed'
[ "$(docker inspect new-api --format '{{.State.Running}}')" = true ] || stop 'Production is not running'
[ "$(git -C "$SOURCE" rev-parse HEAD)" = 0aec08fee811ec6136828fda790551b49e410301 ] || stop 'Source revision changed'
# Baselines are the repository versions deployed by the public R2 switch (cad1a0b6).
pin() { [ "$(sha256sum "$SOURCE/$1" | cut -d ' ' -f1)" = "$2" ] || stop "$1 baseline changed; inspect before preparing"; }
pin router/creation_media_router.go f125983117ef19a23faf0a4911f94c098629910a3367d6d7fc092633b9999e69
pin r2direct/signer.go 9ff8ab07d551d142dc3d9d495d543f508d62709676edfb3a41cb479c6dcafaf5
pin r2direct/handler.go 8e5eda47526632bf3137a29bd98b8bfe7dc448d96d43e32172b7ec9084225d46
pin jcmedia/disk_unix.go 40749bccd5f33ef7c2e5ed4fd42707c93abd3abc387b4116bbfb9f4dbe3c181b
pin jcmedia/store.go fcfd5b3c6f8164d81938cd7df5386562850e9f05292ed5186db43e278517faf9
[ ! -e "$SOURCE/r2direct/results.go" ] && [ ! -e "$SOURCE/r2direct/results_test.go" ] || stop 'Video relay already exists; inspect first'
if docker image inspect "$IMAGE" >/dev/null 2>&1; then stop 'Target image exists; do not overwrite'; fi
[ "$(df --output=avail -B1 / | tail -1)" -gt 5368709120 ] || stop 'Less than 5 GiB free; do not delete other services'
python3 - "$SOURCE" <<'CHECK'
from pathlib import Path
import sys
root=Path(sys.argv[1])
assert 'SetCreationMediaRouter(router)' in (root/'router/main.go').read_text(), 'Media router not registered'
assert any('func TokenAuthReadOnly(' in p.read_text() for p in (root/'middleware').glob('*.go')), 'TokenAuthReadOnly missing'
CHECK
BACKUP=$(mktemp -d /root/jc-video-relay-source.XXXXXX)
cp -a "$SOURCE/router/creation_media_router.go" "$BACKUP/creation_media_router.go"
cp -a "$SOURCE/r2direct" "$BACKUP/r2direct"
cp -a "$SOURCE/jcmedia" "$BACKUP/jcmedia"
restore() {
 rc=$?
 trap - EXIT
 if [ "$rc" != 0 ]; then
  cp -a "$BACKUP/creation_media_router.go" "$SOURCE/router/creation_media_router.go"
  rm -rf "$SOURCE/r2direct" "$SOURCE/jcmedia"
  cp -a "$BACKUP/r2direct" "$BACKUP/jcmedia" "$SOURCE/"
  echo 'Build failed; original source restored. Production untouched.'
 fi
 exit "$rc"
}
trap restore EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
cp "$HERE/extension/creation_media_router.go" "$SOURCE/router/creation_media_router.go"
cp "$HERE/extension/r2direct/results.go" "$HERE/extension/r2direct/results_test.go" "$SOURCE/r2direct/"
cp "$HERE/extension/jcmedia/disk_unix.go" "$HERE/extension/jcmedia/store.go" "$SOURCE/jcmedia/"
docker build --progress plain --target builder2 -t "$IMAGE-build" "$SOURCE"
docker run --rm --network none --entrypoint go "$IMAGE-build" test -mod=readonly ./r2direct ./ossdirect ./jcmedia ./router ./relay/channel/task/jsplugin
docker build --progress plain -t "$IMAGE" "$SOURCE"
[ "$(docker inspect new-api --format '{{.Image}}')" = "$EXPECTED" ] || stop 'Production changed while preparing'
docker image inspect "$IMAGE" --format 'VIDEO RELAY PREPARED {{.Id}}'
printf 'Source backup: %s\n' "$BACKUP"
echo 'Image prepared only. Production was not switched; activation needs its own reviewed script.'

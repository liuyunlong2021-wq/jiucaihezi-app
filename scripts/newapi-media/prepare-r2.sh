#!/usr/bin/env bash
# Prepare only. Never load credentials, change Compose, or restart production.
set -euo pipefail
umask 077
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SOURCE=/opt/jc-newapi-media/source
IMAGE=jiucaihezi/new-api:rc40-media-lingdong-r2
[ "$(id -u)" = 0 ] || { echo 'Run as root'; exit 1; }
if docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo 'Prepared image tag already exists; stop rather than overwrite a release image'; exit 1
fi
[ "$(git -C "$SOURCE" rev-parse HEAD)" = 0aec08fee811ec6136828fda790551b49e410301 ] || { echo 'Unexpected upstream revision; stop and inspect'; exit 1; }
# Refuse to rebuild an unknown media baseline or overwrite another router extension.
cmp "$HERE/extension/ossdirect/signer.go" "$SOURCE/ossdirect/signer.go"
cmp "$HERE/extension/jcmedia/store.go" "$SOURCE/jcmedia/store.go"
if [ -e "$SOURCE/r2direct" ]; then
    diff -qr "$HERE/extension/r2direct" "$SOURCE/r2direct" || { echo 'R2 source changed; stop rather than overwrite'; exit 1; }
fi
if ! cmp -s "$HERE/extension/creation_media_router.go" "$SOURCE/router/creation_media_router.go"; then
    [ "$(sha256sum "$SOURCE/router/creation_media_router.go" | cut -d ' ' -f 1)" = 9ff63226ecf3a49f84b61d6c2b8a284307caeaa971d839808ded05bb069e2c10 ] || { echo 'Media router changed; stop and inspect'; exit 1; }
fi
python3 - "$SOURCE" <<'PY'
from pathlib import Path
import subprocess, sys
root = Path(sys.argv[1])
changed = subprocess.check_output(['git', '-C', str(root), 'diff', '--name-only'], text=True).splitlines()
assert set(changed) <= {'router/main.go', 'relay/channel/task/jsplugin/adaptor.go'}, 'Unexpected tracked source changes'
assert 'SetCreationMediaRouter(router)' in (root/'router/main.go').read_text(), 'Media router not registered'
assert 'descriptor.Headers["Content-Type"] = writer.FormDataContentType()' in (root/'relay/channel/task/jsplugin/adaptor.go').read_text(), 'Existing multipart fix missing'
PY
BACKUP=$(mktemp -d /opt/jc-r2-source-backup.XXXXXX)
cp -a "$SOURCE/router/creation_media_router.go" "$BACKUP/creation_media_router.go"
cp -R "$HERE/extension/r2direct" "$SOURCE/"
cp "$HERE/extension/creation_media_router.go" "$SOURCE/router/"
# The SDK signer is already pinned in rc.40; no new production dependency or hand-written signing.
docker build --progress plain --target builder2 -t "$IMAGE-build" "$SOURCE"
docker run --rm --entrypoint go "$IMAGE-build" test ./r2direct ./ossdirect ./jcmedia
docker build --progress plain -t "$IMAGE" "$SOURCE"
docker image inspect "$IMAGE" --format 'PREPARED {{.Id}}'
printf 'Only prepared image; production unchanged. Source-router backup: %s\n' "$BACKUP"

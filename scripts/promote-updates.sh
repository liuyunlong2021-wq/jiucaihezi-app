#!/usr/bin/env bash
# 上传和公网摘要验证之后调用；候选版本与正式 OTA 推广分别执行。
set -euo pipefail
DIR="${1:?updates directory required}"
VERSION="${2:?version required}"
MODE="${3:-downloads}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 2
[[ "$MODE" == downloads || "$MODE" == updater ]] || exit 2
python3 - "$DIR" "$VERSION" "$MODE" <<'PY'
import fcntl, json, os, pathlib, sys, urllib.parse
root, version, mode = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
lock = (root / '.publish.lock').open('w')
fcntl.flock(lock, fcntl.LOCK_EX)
name = 'updater.json' if mode == 'updater' else 'latest.json'
source = root / version / name
manifest = json.loads(source.read_text())
assert manifest['version'] == version, 'Manifest version mismatch'
for platform in ('darwin-aarch64', 'darwin-x86_64', 'windows-x86_64'):
    entry = manifest['platforms'][platform]
    url = urllib.parse.urlparse(entry['url'])
    assert url.scheme == 'https' and url.hostname == 'api.jiucaihezi.studio', 'Untrusted URL'
    assert url.path.startswith('/updates/' + version + '/'), 'Unversioned URL'
    filename = urllib.parse.unquote(url.path.rsplit('/', 1)[-1])
    assert '/' not in filename and '\\' not in filename, 'Invalid filename'
    assert (root / version / filename).is_file(), 'Missing artifact'
    if mode == 'updater':
        assert entry['signature'] == (root / version / (filename + '.sig')).read_text().strip(), 'Signature mismatch'
current = root / name
if current.exists():
    previous = json.loads(current.read_text())
    old = tuple(map(int, previous['version'].split('.')))
    assert old <= tuple(map(int, version.split('.'))), 'Use an explicit rollback procedure to downgrade'
    if old == tuple(map(int, version.split('.'))):
        assert previous['platforms'] == manifest['platforms'], 'Published version is immutable'
        sys.exit(0)
    if mode == 'updater':
        temporary = root / 'updater-previous.json.tmp'
        temporary.write_bytes(current.read_bytes())
        os.replace(temporary, root / 'updater-previous.json')
temporary = root / (name + '.tmp')
temporary.write_bytes(source.read_bytes())
os.replace(temporary, current)
PY

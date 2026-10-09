#!/usr/bin/env bash
# Prepare the OSS-direct extension on the currently deployed NewAPI rc.40 media image.
# This rebuilds a pinned upstream source plus both product extensions; it never restarts production.
set -euo pipefail
BASE=/opt/jc-newapi-media
TAG=jiucaihezi/new-api:rc40-local-media-ossdirect-20261009
BASE_TAG=jiucaihezi/new-api:rc40-local-media-20261006
BASE_ID=sha256:59fe85edf1175981780b08ad99c072d07e1f29e8869e12ec45fae470dc80f24d
UPSTREAM=0aec08fee811ec6136828fda790551b49e410301
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[ "$(id -u)" = 0 ] || { echo 'Run as root'; exit 1; }
[ "$(docker inspect new-api --format '{{.Config.Image}}')" = "$BASE_TAG" ] || { echo 'Production image tag changed; stop and re-audit.';exit 1; }
[ "$(docker inspect new-api --format '{{.Image}}')" = "$BASE_ID" ] || { echo 'Production image ID changed; stop and re-audit.';exit 1; }
[ "$(docker inspect new-api --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}')" = '/root/new-api-new/docker-compose.yml,/root/new-api-new/docker-compose.media.yml' ] || { echo 'Production Compose files changed; stop and re-audit.';exit 1; }
[ -s /root/new-api-new/docker-compose.media.yml ] || { echo 'Current media Compose override is missing; stop and re-audit.';exit 1; }
AVAILABLE=$(df --output=avail -B1 / | tail -1)
[ "$AVAILABLE" -gt 10737418240 ] || { echo 'Need at least 10GB free for build and backups.';exit 1; }
mkdir -p "$BASE"
if [ ! -d "$BASE/source" ]; then
 git clone --depth 1 --branch v1.0.0-rc.40 https://github.com/QuantumNous/new-api.git "$BASE/source"
fi
[ "$(git -C "$BASE/source" rev-parse HEAD)" = "$UPSTREAM" ] || { echo 'Unexpected upstream revision';exit 1; }
python3 "$HERE/patch_task_multipart.py" "$BASE/source"
python3 - "$BASE/source" <<'PYCODE'
import pathlib,subprocess,sys
root=pathlib.Path(sys.argv[1])
original=subprocess.check_output(['git','-C',str(root),'show','HEAD:router/main.go']).decode()
expected=original.replace('SetRelayRouter(router)','SetRelayRouter(router)\n\tSetCreationMediaRouter(router)',1)
assert (root/'router/main.go').read_text() in (original,expected), 'Unexpected router changes'
changed=subprocess.check_output(['git','-C',str(root),'diff','--name-only']).decode().splitlines()
assert set(changed)<= {'router/main.go','relay/channel/task/jsplugin/adaptor.go'}, 'Unexpected tracked source changes'
PYCODE
cp -R "$HERE/extension/jcmedia" "$BASE/source/"
cp -R "$HERE/extension/ossdirect" "$BASE/source/"
cp "$HERE/extension/creation_media_router.go" "$BASE/source/router/"
TEST_DIR=$BASE/source/relay/channel/task/jsplugin
mkdir -p "$TEST_DIR/jc-test-plugins"
cp "$HERE/regression/task_multipart_header_test.go" "$TEST_DIR/jc_multipart_header_test.go"
cp "$HERE/../../newapi-plugins/fk.plugin.js" "$HERE/../../newapi-plugins/xiaoyi-image.plugin.js" "$TEST_DIR/jc-test-plugins/"
cd "$BASE/source"
python3 - "$BASE/source/router/main.go" <<'PY'
import sys
p=sys.argv[1];s=open(p).read();needle='SetRelayRouter(router)'
assert s.count(needle)==1
if 'SetCreationMediaRouter(router)' not in s:
 open(p,'w').write(s.replace(needle,needle+'\n\tSetCreationMediaRouter(router)',1))
PY
# Compile and verify against the exact official release before the full image build.
docker run --rm -v "$BASE/source:/src" -w /src golang:1.26.1 sh -c 'go test ./relay/channel/task/jsplugin && go test -race ./jcmedia ./ossdirect && go test ./router -run "^$"'
docker build --progress plain -t "$TAG" "$BASE/source"
docker image inspect "$TAG" --format 'PREPARED image={{.Id}}'
docker inspect new-api --format 'Compose目录={{index .Config.Labels "com.docker.compose.project.working_dir"}} 配置={{index .Config.Labels "com.docker.compose.project.config_files"}} 服务={{index .Config.Labels "com.docker.compose.service"}}'
printf '\n构建完成。生产容器尚未修改。请把末尾日志发回，再执行生产切换。\n'

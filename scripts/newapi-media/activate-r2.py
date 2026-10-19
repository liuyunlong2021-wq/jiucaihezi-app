#!/usr/bin/env python3
"""Activate the prepared Lingdong image, preserving the verified production baseline."""
import base64
import copy
import getpass
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, parse_qs
from urllib.request import HTTPRedirectHandler, Request, build_opener

BASE = Path('/root/new-api-new')
FILES = [BASE / name for name in ('docker-compose.yml', 'docker-compose.media.yml', 'docker-compose.oss-direct.yml')]
OLD_IMAGE = 'jiucaihezi/new-api:rc40-local-media-ossdirect-yihong-images-20261016'
IMAGE = 'jiucaihezi/new-api:rc40-media-lingdong-r2'
PREPARED_ID = 'sha256:4daecc3bc0f41dbf39dfda3847b28193438e436cfd8be0537d3dde3898ff23bc'
ENV = Path('/root/jc-r2.env')
OVERRIDE = BASE / 'docker-compose.r2.json'
ORIGIN = 'https://huabu.jiucaihezi.studio'
ACCOUNT = 'd055e5deea504cb25551755cc486a61a'
BUCKET = 'jiucaihezi-media-test'
LOCAL = 'http://127.0.0.1:3000'


class ActivationError(RuntimeError):
    """Safe operational message; never include payloads or credentials."""


def require(condition, message):
    if not condition:
        raise ActivationError(message)


def run(*args):
    # Capture command output: Compose config/inspect may contain secrets.
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    require(result.returncode == 0, 'Command failed: ' + ' '.join(args[:3]) + ' (output withheld to protect credentials)')
    return result.stdout


def docker_object(*args):
    return json.loads(run('docker', *args))[0]


def compose(files):
    return ['docker', 'compose', '--project-directory', str(BASE), '-p', 'new-api-new', *[part for path in files for part in ('-f', str(path))]]


def read_env(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600 and info.st_uid == os.geteuid(), 'R2 env must be an owned regular file with permissions 600')
    values = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key, separator, value = line.partition('=')
        require(separator and key not in values and re.fullmatch(r'[A-Za-z0-9_+=/.-]+', value), 'R2 env has a duplicate, empty, quoted or invalid value')
        values[key] = value
    require(set(values) == {'R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'}, 'R2 env fields do not match the template')
    require(values['R2_ACCOUNT_ID'] == ACCOUNT and values['R2_BUCKET'] == BUCKET, 'R2 account/bucket does not match this experiment')
    require(not any('REPLACE' in value for value in values.values()), 'R2 credentials still contain placeholders')
    return values


def check_config(before, after, credentials, image):
    old, new = before['services']['new-api'], after['services']['new-api']
    require(new['image'] == image, 'New image override was not applied')
    expected = {**old.get('environment', {}), **credentials}
    require(new.get('environment', {}) == expected, 'Existing environment (including OSS) was changed or R2 was not injected')
    left, right = copy.deepcopy(before), copy.deepcopy(after)
    for config in (left, right):
        service = config['services']['new-api']
        for key in ('image', 'environment', 'env_file'):
            service.pop(key, None)
    require(left == right, 'Ports, mounts, networks or another service would change; refusing activation')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def http(address, method='GET', data=None, headers=None, expected=(200,), timeout=30):
    try:
        response = build_opener(NoRedirect).open(Request(address, data=data, headers=headers or {}, method=method), timeout=timeout)
    except HTTPError as error:
        response = error
    except (URLError, TimeoutError, OSError):
        raise ActivationError('Network verification failed; signed URLs and credentials withheld') from None
    with response:
        require(response.code in expected, f'HTTP verification failed ({response.code}); response withheld')
        return response.read(), response.headers


def check_grant(grant):
    require(grant.get('method') == 'PUT' and grant.get('headers') == {'Content-Type': 'image/png'}, 'Unexpected R2 upload method or headers')
    urls = [urlsplit(grant[name]) for name in ('upload_url', 'asset_url', 'head_url')]
    for url in urls:
        require(url.scheme == 'https' and url.netloc == ACCOUNT + '.r2.cloudflarestorage.com' and not url.fragment and parse_qs(url.query).get('X-Amz-Signature'), 'Unexpected signed URL destination')
    require(len({url.path for url in urls}) == 1 and urls[0].path.startswith('/' + BUCKET + '/lingdong-temp/'), 'R2 grant must name the same experiment object')


def verify(key, model):
    route = LOCAL + '/api/creations/lingdong/upload-url'
    http(route, 'POST', b'{}', {'Content-Type': 'application/json'}, expected=(401,))
    png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')
    auth = {'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'}
    grant = json.loads(http(route, 'POST', json.dumps({'model': model, 'content_type': 'image/png', 'size': len(png)}).encode(), auth, timeout=15)[0])
    check_grant(grant)
    # Origin checks exercise R2's CORS responses, but do not replace a real browser test.
    _, cors = http(grant['upload_url'], 'OPTIONS', headers={'Origin': ORIGIN, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type'}, expected=(200, 204))
    require(cors.get('Access-Control-Allow-Origin') == ORIGIN and 'PUT' in cors.get('Access-Control-Allow-Methods', ''), 'R2 PUT preflight is not allowed')
    http(grant['upload_url'], 'PUT', png, {**grant['headers'], 'Origin': ORIGIN}, expected=(200, 204), timeout=120)
    content, headers = http(grant['asset_url'], headers={'Origin': ORIGIN})
    require(content == png and headers.get_content_type() == 'image/png' and headers.get('Access-Control-Allow-Origin') == ORIGIN, 'R2 readback or CORS verification failed')
    _, head = http(grant['head_url'], 'HEAD')
    require(head.get('Content-Length') == str(len(png)), 'R2 HEAD verification failed')
    # Also exercise the unchanged OSS grant without uploading or generating anything.
    oss = json.loads(http(LOCAL + '/api/creations/upload-url', 'POST', json.dumps({'content_type': 'image/png', 'size': len(png)}).encode(), auth, timeout=15)[0])
    require(bool(oss.get('form_fields', {}).get('policy')), 'Existing OSS grant is unavailable')


def wait_healthy():
    # Same health-check budget as the existing media deployment scripts.
    for attempt in range(60):
        try:
            if json.loads(http(LOCAL + '/api/status', timeout=5)[0]).get('success') is True:
                return
        except (RuntimeError, ValueError):
            pass
        time.sleep(2)
    raise ActivationError('NewAPI did not become healthy')


def main():
    require(os.geteuid() == 0 and sys.stdin.isatty(), 'Run interactively as root; do not pipe credentials')
    os.umask(0o077)
    credentials = read_env(ENV)
    require(not OVERRIDE.exists(), 'R2 override already exists; stop and inspect')
    old = docker_object('inspect', 'new-api')
    labels = old['Config']['Labels']
    require(old['State']['Running'] and old['Config']['Image'] == OLD_IMAGE, 'Running production image no longer matches the verified baseline')
    require(labels.get('com.docker.compose.project') == 'new-api-new' and labels.get('com.docker.compose.project.config_files') == ','.join(map(str, FILES)), 'Production Compose files changed')
    require(labels.get('com.docker.compose.project.working_dir') == str(BASE), 'Production Compose working directory changed')
    require(docker_object('image', 'inspect', IMAGE)['Id'] == PREPARED_ID, 'Prepared image ID changed; refusing activation')
    old_image = old['Image']
    docker_object('image', 'inspect', old_image)  # Roll back the actual running image, not a mutable tag.
    before = json.loads(run(*compose(FILES), 'config', '--format', 'json'))
    key = getpass.getpass('NewAPI 用户 Key（隐藏输入；只验上传/读回，不触发模型计费）：')
    require(bool(re.fullmatch(r'sk-[A-Za-z0-9_-]+', key)), 'Invalid NewAPI user key format')
    models = json.loads(http(LOCAL + '/v1/models', headers={'Authorization': 'Bearer ' + key})[0])
    visible = {item['id'] for item in models.get('data', [])}
    allowed = ['SD-2.5-特价-2', 'SD-2.5-特价', 'cvk-2.5-480', 'cvk-2.5-720', 'cvk-2.5-1080', 'sd-2.5-720-v3', 'sd2.5-101010', 'sd2.5-301010']
    model = next((name for name in allowed if name in visible), None)
    require(model, 'This key has no verified Lingdong model; production unchanged')
    backup = Path(tempfile.mkdtemp(prefix='jc-r2-switch-', dir='/root'))
    for file in FILES:
        shutil.copyfile(file, backup / file.name)
    backup_files = [backup / file.name for file in FILES]
    rollback = backup / 'rollback.json'
    rollback.write_text(json.dumps({'services': {'new-api': {'image': old_image}}}))
    (backup / 'rollback.sh').write_text('#!/bin/sh\nset -eu\nexec ' + shlex.join([*compose([*backup_files, rollback]), 'up', '-d', '--no-deps', '--force-recreate', 'new-api']) + '\n')
    (backup / 'rollback.sh').chmod(0o700)
    switched = False
    try:
        with OVERRIDE.open('x') as output:
            json.dump({'services': {'new-api': {'image': PREPARED_ID, 'env_file': [str(ENV)]}}}, output)
        after = json.loads(run(*compose([*FILES, OVERRIDE]), 'config', '--format', 'json'))
        check_config(before, after, credentials, PREPARED_ID)
        print('Config preserved. Backing up and verifying databases...', flush=True)
        run('python3', str(Path(__file__).with_name('backup_db.py')), str(backup))
        require(docker_object('inspect', 'new-api')['Id'] == old['Id'], 'Production container changed during backup; refusing activation')
        switched = True
        print('Database backup verified. Recreating only NewAPI; not rebooting the server...', flush=True)
        run(*compose([*FILES, OVERRIDE]), 'up', '-d', '--no-deps', '--force-recreate', 'new-api')
        wait_healthy()
        require(docker_object('inspect', 'new-api')['Config']['Image'] == PREPARED_ID, 'New container is not running the pinned image')
        print('NewAPI healthy. Testing one tiny private upload/readback and the existing OSS grant...', flush=True)
        verify(key, model)
    except BaseException:
        if switched:
            try:
                run(*compose([*backup_files, rollback]), 'up', '-d', '--no-deps', '--force-recreate', 'new-api')
                wait_healthy()
                require(docker_object('inspect', 'new-api')['Config']['Image'] == old_image, 'Rollback image verification failed')
                print('Activation failed; old image restored and healthy. Backup:', backup, flush=True)
            except BaseException:
                print('AUTO-ROLLBACK FAILED. Run: bash ' + str(backup / 'rollback.sh'), flush=True)
        else:
            print('Validation failed; production unchanged. Backup:', backup, flush=True)
        raise
    finally:
        key = ''
    print('R2 ACTIVE: private upload/GET/HEAD and R2 CORS probes passed; OSS grant preserved. No generation requested.', flush=True)
    print('Backup:', backup, '\nBrowser/API public CORS and paid Lingdong generation remain unverified.', flush=True)


if __name__ == '__main__':
    def interrupted(signum, frame):
        raise KeyboardInterrupt('Activation interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGHUP, interrupted)
    try:
        main()
    except ActivationError as error:
        print(str(error) + '. No generation requested; check backup/rollback status above.', file=sys.stderr)
        sys.exit(1)
    except (Exception, KeyboardInterrupt):
        # Exception details can contain signed URLs, environment values or API responses.
        print('R2 activation stopped. Do not share env/config contents. Check the backup/rollback message above.', file=sys.stderr)
        sys.exit(1)

#!/usr/bin/env python3
"""Image-only switch to desktop public R2 on the verified four-Compose production baseline."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import shlex
import shutil
import signal
import sys
import tempfile

spec = importlib.util.spec_from_file_location('r2_activation_ops', Path(__file__).with_name('activate-r2.py'))
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)
verify_spec = importlib.util.spec_from_file_location('public_r2_check', Path(__file__).with_name('verify-public-r2.py'))
public_check = importlib.util.module_from_spec(verify_spec)
verify_spec.loader.exec_module(public_check)
OLD_ID = 'sha256:bfd510bc74c2fb4bf2d7dd7c687aa6228a74273a2b061ca773702a1d371af428'
IMAGE = 'jiucaihezi/new-api:rc40-public-r2-20261021'
PREPARED_ID = 'sha256:311f21c7a4787a294028a56302b8257b6f0f35b611ffa506d3821b6c78d07eda'
FILES = [*ops.FILES, ops.OVERRIDE]
PUBLIC = 'https://api.jiucaihezi.studio'


def check_image_only(before, after):
    ops.require(after['services']['new-api']['image'] == PREPARED_ID, 'Prepared image override missing')
    left, right = copy.deepcopy(before), copy.deepcopy(after)
    for config in (left, right):
        config['services']['new-api'].pop('image', None)
    ops.require(left == right, 'Environment, mounts, ports or another service would change')


def check_environment(expected, running):
    normalized = dict(expected)
    redis = normalized.get('REDIS_CONN_STRING')
    # Compose serializes literal dollars as $$; docker inspect returns the runtime value.
    if isinstance(redis, str) and '$$' in redis and redis.replace('$$', '$') == running.get('REDIS_CONN_STRING'):
        normalized['REDIS_CONN_STRING'] = running['REDIS_CONN_STRING']
    ops.require(normalized == running, 'Prepared image would change the runtime environment; difference is not only equivalent Redis dollar escaping')
    if normalized != expected:
        print('Redis dollar escaping verified equivalent; keeping the existing connection unchanged.', flush=True)


def verify_public():
    for channel in ('r2', 'lingdong', 'yihong'):
        route = PUBLIC + '/api/creations/' + channel + '/upload-url'
        _, headers = ops.http(route, 'OPTIONS', headers={'Origin': ops.ORIGIN, 'User-Agent': 'jiucaihezi-media-check/1.0', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type'}, expected=(200, 204))
        ops.require(headers.get_all('Access-Control-Allow-Origin') == [ops.ORIGIN], 'API preflight Origin missing or duplicated')
        ops.require('POST' in headers.get('Access-Control-Allow-Methods', ''), 'API preflight does not allow POST')
        allowed = {item.strip().lower() for item in headers.get('Access-Control-Allow-Headers', '').split(',')}
        ops.require({'authorization', 'content-type'} <= allowed, 'API preflight headers not allowed')
        _, headers = ops.http(route, 'POST', b'{}', {'Origin': ops.ORIGIN, 'User-Agent': 'jiucaihezi-media-check/1.0', 'Content-Type': 'application/json'}, expected=(401,))
        ops.require(headers.get_all('Access-Control-Allow-Origin') == [ops.ORIGIN], 'API POST Origin missing or duplicated')


def replace_override(content, mode):
    with tempfile.NamedTemporaryFile(dir=ops.BASE, prefix='.jc-public-r2-', delete=False) as output:
        path = Path(output.name)
        output.write(content)
    try:
        path.chmod(mode)
        path.replace(ops.OVERRIDE)
    finally:
        path.unlink(missing_ok=True)


def check_runtime(before, after):
    env = lambda obj: dict(item.split('=', 1) for item in obj['Config']['Env'] if '=' in item)
    mounts = lambda obj: sorted(obj['Mounts'], key=lambda item: item['Destination'])
    ops.require(env(before) == env(after) and mounts(before) == mounts(after), 'Runtime environment or mounts changed')
    for key in ('PortBindings', 'NetworkMode', 'RestartPolicy'):
        ops.require(before['HostConfig'].get(key) == after['HostConfig'].get(key), 'Runtime host configuration changed')
    ops.require(after['Config']['Labels'].get('com.docker.compose.project.config_files') == ','.join(map(str, FILES)), 'Runtime Compose files changed')


def main():
    ops.require(os.geteuid() == 0 and sys.stdin.isatty(), 'Run interactively as root; do not pipe credentials')
    ops.require(PREPARED_ID.startswith('sha256:') and len(PREPARED_ID) == 71, 'Prepared image ID is not pinned; do not activate')
    os.umask(0o077)
    ops.read_env(ops.ENV)  # Validate the existing private env; never rewrite it.
    old = ops.docker_object('inspect', 'new-api')
    labels = old['Config']['Labels']
    ops.require(old['State']['Running'] and old['Image'] == OLD_ID, 'Production image changed; stop and inspect')
    ops.require(labels.get('com.docker.compose.project') == 'new-api-new' and labels.get('com.docker.compose.project.working_dir') == str(ops.BASE) and labels.get('com.docker.compose.project.config_files') == ','.join(map(str, FILES)), 'Production Compose baseline changed')
    prepared = ops.docker_object('image', 'inspect', IMAGE)
    ops.require(prepared['Id'] == PREPARED_ID, 'Prepared image changed')
    ops.docker_object('image', 'inspect', OLD_ID)
    original = ops.OVERRIDE.read_bytes()
    mode = ops.OVERRIDE.stat().st_mode & 0o777
    updated = json.loads(original)
    updated['services']['new-api']['image'] = PREPARED_ID
    before = json.loads(ops.run(*ops.compose(FILES), 'config', '--format', 'json'))
    ops.require(before['services']['new-api']['image'] == old['Config']['Image'], 'Compose image differs from running configuration')
    key = ops.getpass.getpass('NewAPI 用户 Key（隐藏输入；只测素材，不生成、不触发模型计费）：').strip()
    ops.require(bool(key), 'User key is empty')
    ops.http(ops.LOCAL + '/v1/models', headers={'Authorization': 'Bearer ' + key})
    backup = Path(tempfile.mkdtemp(prefix='jc-public-r2-switch-', dir='/root'))
    for file in FILES:
        shutil.copy2(file, backup / file.name)
    preview = backup / 'image-only.json'
    preview.write_text(json.dumps({'services': {'new-api': {'image': PREPARED_ID}}}))
    after = json.loads(ops.run(*ops.compose([*FILES, preview]), 'config', '--format', 'json'))
    check_image_only(before, after)
    image_env = dict(item.split('=', 1) for item in prepared['Config'].get('Env', []) if '=' in item)
    image_env.update(after['services']['new-api'].get('environment', {}))
    running_env = dict(item.split('=', 1) for item in old['Config']['Env'] if '=' in item)
    check_environment(image_env, running_env)
    rollback = backup / 'rollback.sh'
    rollback.write_text('#!/bin/sh\nset -eu\n' + shlex.join(['cp', '-p', str(backup / ops.OVERRIDE.name), str(ops.OVERRIDE)]) + '\n' + shlex.join([*ops.compose(FILES), 'up', '-d', '--no-deps', '--force-recreate', 'new-api']) + '\n')
    rollback.chmod(0o700)
    switched = False
    try:
        print('Configuration preserved. Backing up and verifying databases...', flush=True)
        ops.run('python3', str(Path(__file__).with_name('backup_db.py')), str(backup))
        ops.require(ops.docker_object('inspect', 'new-api')['Id'] == old['Id'], 'Production container changed during backup')
        ops.require(all(file.read_bytes() == (backup / file.name).read_bytes() for file in FILES), 'Compose files changed during backup')
        print('Database backup verified. Recreating only NewAPI...', flush=True)
        switched = True
        replace_override(json.dumps(updated).encode(), mode)
        ops.run(*ops.compose(FILES), 'up', '-d', '--no-deps', '--force-recreate', 'new-api')
        ops.wait_healthy()
        current = ops.docker_object('inspect', 'new-api')
        ops.require(current['Image'] == PREPARED_ID, 'New container image does not match')
        check_runtime(old, current)
        public_check.verify(key)
        ops.verify(key, 'yh-seedance2.5 Ultra', channel='yihong')
        ops.verify(key, '灵动-gpt-image-2.5-flare')
        verify_public()
    except BaseException:
        if switched:
            try:
                replace_override(original, mode)
                ops.run(*ops.compose(FILES), 'up', '-d', '--no-deps', '--force-recreate', 'new-api')
                ops.wait_healthy()
                ops.require(ops.docker_object('inspect', 'new-api')['Image'] == OLD_ID, 'Rollback image mismatch')
                print('Activation failed; old image restored and healthy. Backup:', backup, flush=True)
            except BaseException:
                print('AUTO-ROLLBACK FAILED. Run: bash ' + str(rollback), flush=True)
        else:
            print('Production unchanged. Backup:', backup, flush=True)
        raise
    finally:
        key = ''
    print('PUBLIC R2 ACTIVE: image switched; public/Yihong/Lingdong R2 readback, legacy OSS grants and public API CORS probes passed.', flush=True)
    print('Backup:', backup, '\nNo generation requested. Desktop packages, canvas, prices and legacy OSS retirement are NOT completed.', flush=True)


if __name__ == '__main__':
    def interrupted(signum, frame):
        raise KeyboardInterrupt('Activation interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGHUP, interrupted)
    try:
        main()
    except ops.ActivationError as error:
        print(str(error) + '. Check the backup/rollback message. No generation requested.', file=sys.stderr)
        sys.exit(1)
    except BaseException:
        print('Public R2 activation stopped. Check the backup/rollback message. Do not share env/config or keys.', file=sys.stderr)
        sys.exit(1)

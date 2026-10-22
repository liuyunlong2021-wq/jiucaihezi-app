#!/usr/bin/env python3
"""Upload final desktop release bytes to the isolated public R2 bucket."""
import hashlib
from pathlib import Path
import re
import sys

ACCOUNT = 'd055e5deea504cb25551755cc486a61a'
BUCKET = 'jiucaihezi-releases'
PUBLIC_BASE = 'https://downloads.jiucaihezi.studio'
ASSET = re.compile(r'[\w.\-]+\.(?:dmg|exe|zip|app\.tar\.gz|sig)', re.UNICODE)


def digest(stream):
    value = hashlib.sha256()
    while chunk := stream.read(1024 * 1024):
        value.update(chunk)
    return value.hexdigest()


def inventory(root):
    root = Path(root)
    names = sorted(p.name for p in root.iterdir() if ASSET.fullmatch(p.name) or p.name == 'SHA256SUMS')
    required = [r'.+_aarch64\.dmg', r'.+_x64\.dmg', r'.+_x64_windows_setup\.exe',
                r'.+_x64_windows_portable\.zip', r'.*aarch64\.app\.tar\.gz', r'.*x64\.app\.tar\.gz']
    for pattern in required:
        matches = [name for name in names if re.fullmatch(pattern, name)]
        if len(matches) != 1:
            raise ValueError('Missing or ambiguous release artifact: ' + pattern)
        if matches[0].endswith(('.exe', '.tar.gz')) and matches[0] + '.sig' not in names:
            raise ValueError('Missing update signature: ' + matches[0])
    checksums = {}
    for line in (root / 'R2-SHA256SUMS').read_text().splitlines():
        match = re.fullmatch(r'([a-f0-9]{64})  (?:\./)?([\w.\-]+)', line)
        if not match or match[2] in checksums:
            raise ValueError('Invalid R2-SHA256SUMS entry')
        checksums[match[2]] = match[1]
    if set(checksums) != set(names):
        raise ValueError('R2-SHA256SUMS must cover every release artifact exactly once')
    for name in names:
        path = root / name
        if path.is_symlink() or not path.is_file() or not path.stat().st_size:
            raise ValueError('Invalid release file: ' + name)
        with path.open('rb') as stream:
            if digest(stream) != checksums[name]:
                raise ValueError('Local SHA256 mismatch: ' + name)
    return [root / name for name in names + ['R2-SHA256SUMS']]


def upload_file(client, bucket, key, path):
    with path.open('rb') as stream:
        expected = digest(stream)
    try:
        with path.open('rb') as stream:
            client.put_object(Bucket=bucket, Key=key, Body=stream,
                              ContentLength=path.stat().st_size, IfNoneMatch='*',
                              ContentType='text/plain' if path.name.endswith('SHA256SUMS') else 'application/octet-stream',
                              CacheControl='public, max-age=31536000, immutable')
    except Exception as error:
        if getattr(error, 'response', {}).get('Error', {}).get('Code') not in ('PreconditionFailed', '412'):
            raise
    # Metadata alone cannot prove that an existing immutable object has the right bytes.
    response = client.get_object(Bucket=bucket, Key=key)
    try:
        if response['ContentLength'] != path.stat().st_size or digest(response['Body']) != expected:
            raise ValueError('R2 SHA256 mismatch: ' + path.name)
    finally:
        response['Body'].close()
    print('Verified immutable R2 asset: ' + path.name, flush=True)


def main():
    version, directory, config = sys.argv[1:]
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Invalid version')
    files = sorted(inventory(directory), key=lambda file: file.stat().st_size)
    path = Path(config)
    if path.stat().st_mode & 0o077:
        raise ValueError('R2 config must be readable only by its owner (chmod 600)')
    values = {}
    for line in path.read_text().splitlines():
        if line.strip() and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip().strip('\"\'')
    if set(values) != {'R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'}:
        raise ValueError('Unexpected release R2 config fields')
    if values['R2_ACCOUNT_ID'] != ACCOUNT or values['R2_BUCKET'] != BUCKET:
        raise ValueError('Release R2 account/bucket mismatch; private media bucket is forbidden')
    if any(not value or value.startswith('REPLACE_') for value in values.values()):
        raise ValueError('Release R2 credentials are not configured')
    import boto3
    from botocore.config import Config
    client = boto3.client('s3', endpoint_url=f'https://{ACCOUNT}.r2.cloudflarestorage.com',
                          region_name='auto', aws_access_key_id=values['R2_ACCESS_KEY_ID'],
                          aws_secret_access_key=values['R2_SECRET_ACCESS_KEY'],
                          config=Config(signature_version='s3v4', retries={'max_attempts': 3},
                                        request_checksum_calculation='when_required',
                                        response_checksum_validation='when_required'))
    for file in files:
        print(f'Uploading R2 asset: {file.name} ({file.stat().st_size} bytes)', flush=True)
        upload_file(client, BUCKET, version + '/' + file.name, file)


if __name__ == '__main__':
    main()

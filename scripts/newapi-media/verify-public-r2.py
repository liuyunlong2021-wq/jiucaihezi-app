#!/usr/bin/env python3
"""Verify the public R2 contract with synthetic bytes; never submit a model task."""
import base64
import getpass
import importlib.util
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit, parse_qs

spec = importlib.util.spec_from_file_location('r2_ops', Path(__file__).with_name('activate-r2.py'))
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


def verify(key):
    route = 'https://api.jiucaihezi.studio/api/creations/r2/upload-url'
    ops.http(route, 'POST', b'{}', {'Content-Type': 'application/json', 'User-Agent': 'jiucaihezi-media-check/1.0'}, expected=(401,))
    png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')
    data, _ = ops.http(route, 'POST', json.dumps({'content_type': 'image/png', 'size': len(png)}).encode(), {'Authorization': 'Bearer '+key, 'Content-Type': 'application/json', 'User-Agent': 'jiucaihezi-media-check/1.0'})
    grant = json.loads(data)
    ops.require(grant.get('method') == 'PUT' and grant.get('headers') == {'Content-Type': 'image/png'}, 'Invalid R2 grant')
    urls = [urlsplit(grant[name]) for name in ('upload_url', 'asset_url', 'head_url')]
    for index, url in enumerate(urls):
        query = parse_qs(url.query)
        ops.require(url.scheme == 'https' and url.netloc == ops.ACCOUNT+'.r2.cloudflarestorage.com' and not url.fragment and query.get('X-Amz-Signature') and query.get('X-Amz-Expires') == [('300' if index == 0 else '21600')], 'Invalid signed R2 URL')
    ops.require(len({url.path for url in urls}) == 1 and re.fullmatch('/'+ops.BUCKET+r'/creation-temp/[1-9]\d*/[a-f0-9]{32}\.png', urls[0].path), 'Invalid owner/object scope')
    ops.http(grant['upload_url'], 'PUT', png, grant['headers'], expected=(200, 204), timeout=120)
    content, headers = ops.http(grant['asset_url'])
    ops.require(content == png and headers.get_content_type() == 'image/png', 'Readback bytes or MIME mismatch')
    _, headers = ops.http(grant['head_url'], 'HEAD')
    ops.require(headers.get('Content-Length') == str(len(png)), 'HEAD length mismatch')


if __name__ == '__main__':
    key = ''
    try:
        ops.require(sys.stdin.isatty(), 'Run interactively; never put credentials on the command line')
        key = getpass.getpass('NewAPI 用户 Key（隐藏输入；只上传合成小图，不生成）：').strip()
        ops.require(bool(key), 'Missing user key')
        verify(key)
        print('PUBLIC R2 VERIFIED: synthetic PUT/GET/HEAD bytes match. No generation requested; paid models/platforms remain unverified.')
    except BaseException:
        print('Public R2 verification stopped. URLs, keys and response bodies withheld.', file=sys.stderr)
        sys.exit(1)
    finally:
        key = ''

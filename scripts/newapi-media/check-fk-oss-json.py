#!/usr/bin/env python3
"""One FK image edit via OSS + JSON; no service changes or automatic retries."""
import getpass
import hashlib
import json
import re
import struct
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zlib

BASE = 'http://127.0.0.1:3000'
MODEL = 'ft-image-v1-211f28f47b0355abb1798f72eb65f22d'


def png():
    def chunk(name, data):
        return struct.pack('!I', len(data)) + name + data + struct.pack('!I', zlib.crc32(name + data) & 0xffffffff)
    rows = []
    for y in range(512):
        row = bytearray()
        for x in range(512):
            sun = (x - 256) ** 2 + (y - 210) ** 2 < 70 ** 2
            color = (255, 220, 70) if sun else ((30, 100, 40) if y > 330 else (80, 150, 220))
            row.extend(color)
        rows.append(b'\x00' + row)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', 512, 512, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b''.join(rows))) + chunk(b'IEND', b'')


def multipart(fields, data):
    boundary = 'jc-check-' + uuid.uuid4().hex
    parts = []
    for name, value in fields.items():
        if not re.fullmatch(r'[A-Za-z0-9_-]+', name):
            raise ValueError('Invalid OSS form field')
        parts.append(('--' + boundary + '\r\nContent-Disposition: form-data; name="' + name + '"\r\n\r\n' + str(value) + '\r\n').encode())
    parts.append(('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="reference.png"\r\nContent-Type: image/png\r\n\r\n').encode() + data + b'\r\n')
    parts.append(('--' + boundary + '--\r\n').encode())
    return b''.join(parts), 'multipart/form-data; boundary=' + boundary


def safe(text, key=''):
    if key:
        text = text.replace(key, '[redacted]')
    return re.sub(r'https?://[^\s"<>]+', '[URL redacted]', text)[:1800]


def request(url, data=None, headers=None, timeout=60):
    req = urllib.request.Request(url, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read()


def main():
    print('仅测试一次 FK-image2 图生图，可能按渠道价格扣费；不重启、不改配置、不自动重试。', flush=True)
    key = getpass.getpass('请粘贴有效 NewAPI 用户 Key（隐藏输入，不是阿里云 AccessKey）：').strip()
    if not re.fullmatch(r'sk-[A-Za-z0-9_-]+', key):
        raise ValueError('NewAPI Key 格式不正确')
    auth = {'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'}
    image = png()
    code, _, body = request(BASE + '/api/creations/upload-url', json.dumps({'content_type': 'image/png', 'size': len(image)}).encode(), auth)
    if code != 200:
        raise ValueError('OSS 授权 HTTP %s: %s' % (code, safe(body.decode(errors='replace'), key)))
    grant = json.loads(body)
    for field in ('upload_url', 'asset_url'):
        url = urllib.parse.urlsplit(grant[field])
        if url.scheme != 'https' or not (url.hostname or '').endswith('.aliyuncs.com'):
            raise ValueError('Unexpected OSS endpoint; stopped')
    upload, content_type = multipart(grant['form_fields'], image)
    code, _, body = request(grant['upload_url'], upload, {'Content-Type': content_type}, 120)
    if code not in (200, 201, 204):
        raise ValueError('OSS 上传 HTTP %s: %s' % (code, safe(body.decode(errors='replace'), key)))
    code, _, readback = request(grant['asset_url'])
    if code != 200 or hashlib.sha256(readback).digest() != hashlib.sha256(image).digest():
        raise ValueError('OSS 图片字节读回不一致，未调用生成')
    print('OSS 上传及完整字节读回通过。正在向本机 NewAPI 提交 JSON imageUrls（仅一次）……', flush=True)
    data = {'model': MODEL, 'prompt': '保留参考图的构图，将晴天场景改为日出时的暖色天空。', 'ratio': '1:1', 'imageUrls': [grant['asset_url']]}
    code, headers, body = request(BASE + '/v1/images/edits', json.dumps(data, ensure_ascii=False).encode(), auth, 600)
    print('FK JSON 图生图 HTTP=' + str(code))
    for name, value in headers.items():
        if name.lower() in ('x-request-id', 'request-id', 'x-oneapi-request-id'):
            print(name + '=' + value)
    try:
        result = json.loads(body)
    except ValueError:
        print('响应字节数=' + str(len(body)))
        print(safe(body.decode(errors='replace'), key))
        return 1
    if code == 200 and isinstance(result.get('data'), list) and result['data']:
        print('JSON 图生图成功，结果张数=' + str(len(result['data'])))
        print('未下载生成成品；OSS 签名链接和生成链接未输出。')
        return 0
    print(safe(json.dumps(result, ensure_ascii=False), key))
    return 1


if __name__ == '__main__':
    if sys.argv[1:] == ['--self-check']:
        image = png()
        assert image.startswith(b'\x89PNG') and struct.unpack('!II', image[16:24]) == (512, 512)
        body, header = multipart({'key': 'creation-temp/test.png', 'policy': 'test'}, image)
        assert image in body and header.startswith('multipart/form-data; boundary=')
        assert 'secret' not in safe('secret https://bucket.example/a?signature=private', 'secret')
        print('SELF CHECK PASS: 512px PNG, OSS form, credential/URL redaction')
    else:
        try:
            sys.exit(main())
        except Exception as exc:
            print('检查停止：' + safe(str(exc)))
            sys.exit(1)

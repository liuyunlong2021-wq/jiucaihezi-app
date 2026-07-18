#!/usr/bin/env python3
from __future__ import annotations

import os
import re
import subprocess
from datetime import datetime
from pathlib import Path


CONF = Path('/etc/nginx/sites-enabled/api.jiucaihezi.studio.conf')
BACKUP_DIR = Path('/etc/nginx/backups')
PRIMARY_ANCHOR = 'location = /api/creation/models'
FALLBACK_ANCHOR = 'location /api/health'

BLOCK = '''
    location = /documents/markdown {
        set $document_converter_origin "";
        if ($http_origin ~* ^https://([a-z0-9-]+\\.)?jiucaihezi\\.pages\\.dev$) {
            set $document_converter_origin $http_origin;
        }
        if ($http_origin = "https://jiucaihezi.studio") {
            set $document_converter_origin $http_origin;
        }
        if ($request_method = OPTIONS) {
            add_header Access-Control-Allow-Origin $document_converter_origin always;
            add_header Access-Control-Allow-Methods "POST, OPTIONS" always;
            add_header Access-Control-Allow-Headers "Authorization, Content-Type, X-API-Key" always;
            add_header Vary "Origin" always;
            return 204;
        }

        client_max_body_size 20m;
        proxy_pass http://127.0.0.1:8810/documents/markdown;
        proxy_connect_timeout 10s;
        proxy_read_timeout 100s;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header X-API-Key $http_x_api_key;
        proxy_set_header Host $host;
        proxy_hide_header Access-Control-Allow-Origin;
        add_header Access-Control-Allow-Origin $document_converter_origin always;
        add_header Access-Control-Allow-Headers "Authorization, Content-Type, X-API-Key" always;
        add_header Vary "Origin" always;
    }
'''


def has_live_location(text: str) -> bool:
    return any(
        re.search(r'\blocation\s+=\s+/documents/markdown\s*\{', line.strip())
        for line in text.splitlines()
        if line.strip() and not line.lstrip().startswith('#')
    )


def find_location_end(text: str, anchor: str) -> int:
    start = text.find(anchor)
    if start == -1:
        return -1
    brace_start = text.find('{', start)
    if brace_start == -1:
        return -1

    depth = 0
    for index in range(brace_start, len(text)):
        if text[index] == '{':
            depth += 1
        elif text[index] == '}':
            depth -= 1
            if depth == 0:
                line_end = text.find('\n', index)
                return len(text) if line_end == -1 else line_end + 1
    return -1


def insert_after_anchor(text: str) -> str:
    for anchor in (PRIMARY_ANCHOR, FALLBACK_ANCHOR):
        end = find_location_end(text, anchor)
        if end != -1:
            return text[:end] + BLOCK + text[end:]
    raise SystemExit('neither /api/creation/models nor /api/health location was found')


def main() -> None:
    text = CONF.read_text()
    if has_live_location(text):
        print('document converter location already installed')
        return

    updated = insert_after_anchor(text)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup = BACKUP_DIR / f'{CONF.name}.bak-{datetime.now():%Y%m%d-%H%M%S}'
    backup.write_text(text)
    os.chmod(backup, 0o600)
    CONF.write_text(updated)
    check = subprocess.run(['nginx', '-t'], capture_output=True, text=True)
    if check.returncode != 0:
        CONF.write_text(text)
        raise SystemExit(
            'nginx config test failed; restored original config from backup. '
            + (check.stderr or check.stdout).strip()
        )
    print(f'installed document converter location, backup={backup}')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
from __future__ import annotations

import os
import re
import subprocess
from datetime import datetime
from pathlib import Path


CONF = Path('/etc/nginx/sites-enabled/api.jiucaihezi.studio.conf')
BACKUP_DIR = Path('/etc/nginx/backups')

LOCATION = 'location /rh/tasks/'
PRIMARY_ANCHOR = 'location = /api/creation/models'
FALLBACK_ANCHOR = 'location /api/health'

BLOCK = '''
    location /rh/tasks/ {
        limit_except GET { deny all; }
        proxy_pass http://172.17.0.1:8789/tasks/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
    }
'''


def has_live_location(text: str) -> bool:
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue
        if re.search(r'\blocation\s+/rh/tasks/\s*\{', stripped):
            return True
    return False


def find_location_end(text: str, anchor: str) -> int:
    start = text.find(anchor)
    if start == -1:
        return -1

    brace_start = text.find('{', start)
    if brace_start == -1:
        return -1

    depth = 0
    for index in range(brace_start, len(text)):
        char = text[index]
        if char == '{':
            depth += 1
        elif char == '}':
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
        print('rh tasks location already installed')
        return

    updated = insert_after_anchor(text)

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup = BACKUP_DIR / f'{CONF.name}.bak-{datetime.now().strftime("%Y%m%d-%H%M%S")}'
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
    print(f'installed rh tasks location, backup={backup}')


if __name__ == '__main__':
    main()

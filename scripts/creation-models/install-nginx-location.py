#!/usr/bin/env python3
from pathlib import Path
from datetime import datetime

CONF = Path('/etc/nginx/sites-enabled/api.jiucaihezi.studio.conf')
BACKUP_DIR = Path('/etc/nginx/backups')

MARKER = '''    location /api/health {
        proxy_pass http://127.0.0.1:8090/api/health;
    }
'''

BLOCK = '''
    location = /api/creation/models {
        proxy_hide_header Access-Control-Allow-Origin;
        proxy_hide_header Access-Control-Allow-Credentials;
        proxy_hide_header Access-Control-Allow-Methods;
        proxy_hide_header Access-Control-Allow-Headers;
        proxy_pass http://127.0.0.1:8790/api/creation/models;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
    }
'''


def main() -> None:
    text = CONF.read_text()
    if 'location = /api/creation/models' in text:
        print('creation models location already installed')
        return
    if MARKER not in text:
        raise SystemExit('api health marker not found')
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup = BACKUP_DIR / f'{CONF.name}.bak-{datetime.now().strftime("%Y%m%d-%H%M%S")}'
    backup.write_text(text)
    CONF.write_text(text.replace(MARKER, MARKER + BLOCK))
    print(f'installed creation models location, backup={backup}')


if __name__ == '__main__':
    main()

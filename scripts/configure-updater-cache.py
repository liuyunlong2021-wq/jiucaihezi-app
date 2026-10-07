#!/usr/bin/env python3
"""仅为 updater.json 增加精确无缓存规则；备份、nginx -t、失败还原。"""
import datetime
import pathlib
import re
import shutil
import subprocess

config = pathlib.Path('/etc/nginx/sites-enabled/api.jiucaihezi.studio.conf').resolve()
source = config.read_text()
marker = '# jiucaihezi desktop updater manifest cache'
if marker not in source:
    match = re.search(r'(?m)^([ \t]*)location\s+(?:\^~\s+)?/updates/?\s*\{', source)
    if not match:
        raise SystemExit('Existing /updates location not found; refusing to guess server block')
    indent = match[1]
    lines = [marker, 'location = /updates/updater.json {',
             '    alias /opt/updates/updater.json;', '    default_type application/json;',
             '    expires off;', '    add_header Cache-Control "no-cache, max-age=0, must-revalidate" always;',
             '    add_header Access-Control-Allow-Origin "*" always;', '}']
    updated = source[:match.start()] + '\n'.join(indent + line for line in lines) + '\n' + source[match.start():]
    backups = pathlib.Path('/etc/nginx/backups')
    backups.mkdir(parents=True, exist_ok=True)
    shutil.copy2(config, backups / ('api-updater-cache-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S') + '.conf'))
    config.write_text(updated)
    try:
        subprocess.run(['nginx', '-t'], check=True)
    except subprocess.CalledProcessError:
        config.write_text(source)
        raise
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    print('Configured updater manifest revalidation')
else:
    subprocess.run(['nginx', '-t'], check=True)
    print('Updater cache rule already configured')

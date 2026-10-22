#!/usr/bin/env python3
"""Install exact redirects only after public R2 SHA256 verification."""
import datetime
import importlib.util
from pathlib import Path
import re
import shutil
import subprocess
import sys
from urllib.parse import quote

PUBLIC_BASE = 'https://downloads.jiucaihezi.studio'


def render(source, version, names):
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Invalid version')
    for name in names:
        if not re.fullmatch(r'[\w.\-]+', name) or not (name in ('SHA256SUMS', 'R2-SHA256SUMS') or name.endswith(('.dmg', '.exe', '.zip', '.app.tar.gz', '.sig'))):
            raise ValueError('Invalid release filename')
    marker = '# jiucaihezi R2 release ' + version
    lines = [marker + ' begin']
    for name in sorted(names):
        lines.extend([f'location = /updates/{version}/{name} {{',
                      '    add_header Cache-Control "no-store" always;',
                      '    add_header Access-Control-Allow-Origin "*" always;',
                      f'    return 302 {PUBLIC_BASE}/{version}/{quote(name)};', '}'])
    lines.append(marker + ' end')
    block = '\n'.join('    ' + line for line in lines) + '\n'
    pattern = r'(?m)^    ' + re.escape(marker) + r' begin\n[\s\S]*?^    ' + re.escape(marker) + r' end\n'
    if re.search(pattern, source):
        return re.sub(pattern, lambda _: block, source, count=1)
    match = re.search(r'(?m)^[ \t]*location\s+(?:\^~\s+)?/updates/?\s*\{', source)
    if not match:
        raise ValueError('Existing /updates location not found; refusing to guess server block')
    return source[:match.start()] + block + source[match.start():]


def activate(config, updated, backup_dir, run=subprocess.run):
    source = config.read_text()
    if updated == source:
        run(['nginx', '-t'], check=True)
        return None
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup = backup_dir / ('api-r2-downloads-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '.conf')
    shutil.copy2(config, backup)
    try:
        config.write_text(updated)
        run(['nginx', '-t'], check=True)
        run(['systemctl', 'reload', 'nginx'], check=True)
    except Exception:
        shutil.copy2(backup, config)
        run(['nginx', '-t'], check=True)
        run(['systemctl', 'reload', 'nginx'], check=True)
        raise
    print('R2 redirects activated; rollback config: ' + str(backup))
    return backup


if __name__ == '__main__':
    version, directory, *operation = sys.argv[1:]
    config = Path('/etc/nginx/sites-enabled/api.jiucaihezi.studio.conf').resolve()
    receipt = Path(directory) / '.r2-nginx-backup'
    if operation:
        if operation != ['rollback']:
            raise ValueError('Unknown operation')
        previous = receipt.read_text().strip()
        if previous:
            backup = Path(previous)
            if backup.parent != Path('/etc/nginx/backups') or not backup.name.startswith('api-r2-downloads-'):
                raise ValueError('Invalid rollback path')
            activate(config, backup.read_text(), Path('/etc/nginx/backups'))
            receipt.write_text('')
        sys.exit(0)
    spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('publish-r2-updates.py'))
    release = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(release)
    names = [file.name for file in release.inventory(directory)]
    backup = activate(config, render(config.read_text(), version, names), Path('/etc/nginx/backups'))
    receipt.write_text(str(backup) if backup else '')

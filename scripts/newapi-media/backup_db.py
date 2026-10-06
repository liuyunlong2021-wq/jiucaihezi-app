#!/usr/bin/env python3
"""Back up the DB NewAPI actually uses; never print or put its password in argv."""
import json
import os
import pathlib
import shlex
import subprocess
import sys
from urllib.parse import unquote, urlsplit


def connection(dsn):
    parsed = urlsplit(dsn)
    if parsed.scheme not in ('postgres', 'postgresql'):
        raise ValueError('Expected a PostgreSQL URL; stop for connection review')
    values = {
        'PGHOST': parsed.hostname or '',
        'PGPORT': str(parsed.port or 5432),
        'PGUSER': unquote(parsed.username or ''),
        'PGPASSWORD': unquote(parsed.password or ''),
        'PGDATABASE': unquote(parsed.path.lstrip('/')),
    }
    if not all(values[k] for k in ('PGHOST', 'PGUSER', 'PGDATABASE')):
        raise ValueError('Incomplete database connection; stop for review')
    # Preserve libpq TLS/search-path connection settings without exposing the URL.
    values['PGDATABASE'] = dsn
    return values


def main(directory):
    config = json.loads(subprocess.check_output(['docker', 'inspect', 'new-api']))[0]
    env = dict(value.split('=', 1) for value in config['Config']['Env'] if '=' in value)
    dsns = [('primary', env.get('SQL_DSN', ''))]
    if env.get('LOG_SQL_DSN') and env['LOG_SQL_DSN'] != env.get('SQL_DSN'):
        dsns.append(('logs', env['LOG_SQL_DSN']))
    for name, dsn in dsns:
        values = connection(dsn)
        script = ''.join('export ' + key + '=' + shlex.quote(value) + '\n' for key, value in values.items())
        script += 'exec pg_dump --format=custom\n'
        target = pathlib.Path(directory) / (name + '.dump')
        with target.open('wb') as output:
            os.chmod(target, 0o600)
            result = subprocess.run(['docker', 'exec', '-i', 'postgres', 'sh', '-s'],
                                    input=script.encode(), stdout=output, stderr=subprocess.PIPE)
        if result.returncode:
            # Avoid printing third-party errors that might contain connection data.
            raise RuntimeError('Database dump failed; production has not been switched')
        if target.stat().st_size < 1024:
            raise RuntimeError('Database archive unexpectedly small')
        with target.open('rb') as archive:
            result = subprocess.run(['docker', 'exec', '-i', 'postgres', 'pg_restore', '--list'],
                                    stdin=archive, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if result.returncode or b'TABLE' not in result.stdout:
            raise RuntimeError('Database archive verification failed')
        print(name + ': database archive verified (' + str(target.stat().st_size) + ' bytes)', flush=True)


if __name__ == '__main__':
    try:
        main(sys.argv[1])
    except Exception as error:
        print('Backup failed: ' + type(error).__name__ + '. Production has not been switched.', file=sys.stderr)
        sys.exit(1)

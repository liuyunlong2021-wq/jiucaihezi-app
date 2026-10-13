#!/usr/bin/env python3
"""Prepare the bounded Yihong image response fix in a pinned rc.40 checkout; no deployment."""
from pathlib import Path
import subprocess
import sys

UPSTREAM = '0aec08fee811ec6136828fda790551b49e410301'
SOURCE_FILE = 'relay/channel/task/jsplugin/adaptor.go'
MARKER = '\tstarted := time.Now()\n\tvar responseBody any'
REPLACEMENT = '''\tstarted := time.Now()
\t// Only Yihong's synchronous images need large inline Base64 responses.
\tresponseLimit := maxTaskPluginPersistedJSONBytes
\tif a.plugin.Meta.Key == "yihong" &&
\t\t(info.UpstreamModelName == "gemini-nano-banana-2.1" || info.UpstreamModelName == "gpt-image-2-1K-4K") &&
\t\t(c.Request.URL.Path == "/v1/images/generations" || c.Request.URL.Path == "/v1/images/edits") {
\t\tresponseLimit = 32 << 20
\t}
\tvar responseBody any'''
CHANGES = [
    (MARKER, REPLACEMENT),
    ('io.LimitReader(resp.Body, maxTaskPluginPersistedJSONBytes+1)', 'io.LimitReader(resp.Body, int64(responseLimit)+1)'),
    ('len(body) > maxTaskPluginPersistedJSONBytes', 'len(body) > responseLimit'),
    ('len(taskData) > maxTaskPluginPersistedJSONBytes', 'len(taskData) > responseLimit'),
]


def patch(root: Path) -> None:
    if (root / '.git').exists():
        revision = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
        if revision != UPSTREAM:
            raise SystemExit('Unexpected NewAPI revision; stop and inspect')
    target = root / SOURCE_FILE
    source = target.read_text()
    if all(source.count(new) == 1 for _, new in CHANGES):
        print('Yihong image response fix already applied')
        return
    if not all(source.count(old) == 1 for old, _ in CHANGES):
        raise SystemExit('Unexpected task response source; stop and inspect')
    for old, new in CHANGES:
        source = source.replace(old, new, 1)
    target.write_text(source)
    print('Yihong image response fix prepared (32 MiB); no service changed')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: patch_yihong_image_response.py PINNED_NEWAPI_SOURCE')
    patch(Path(sys.argv[1]))

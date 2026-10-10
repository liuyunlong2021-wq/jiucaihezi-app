#!/usr/bin/env python3
"""Stage the creation protocol route in a pinned NewAPI checkout. Never build or deploy."""
import pathlib
import subprocess
import sys

root = pathlib.Path(sys.argv[1]).resolve()
expected = '0aec08fee811ec6136828fda790551b49e410301'
if subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip() != expected:
    raise SystemExit('NewAPI revision changed; re-audit the host authentication before applying')
main = root / 'router/main.go'
original = subprocess.check_output(['git', '-C', str(root), 'show', 'HEAD:router/main.go'], text=True)
current = main.read_text()
allowed = original.replace('SetRelayRouter(router)', 'SetRelayRouter(router)\n\tSetCreationMediaRouter(router)', 1)
patched = allowed.replace('SetCreationMediaRouter(router)', 'SetCreationMediaRouter(router)\n\tSetCreationProtocolRouter(router)', 1)
protocol_only = original.replace('SetRelayRouter(router)', 'SetRelayRouter(router)\n\tSetCreationProtocolRouter(router)', 1)
if current not in (original, allowed, protocol_only, patched):
    raise SystemExit('Unexpected router changes; preserve them and review manually')
source = pathlib.Path(__file__).resolve().parent.parent / 'newapi-media/extension/creation_protocol_router.go'
(root / 'router/creation_protocol_router.go').write_bytes(source.read_bytes())
if current not in (patched, protocol_only):
    main.write_text(current.replace('SetRelayRouter(router)', 'SetRelayRouter(router)\n\tSetCreationProtocolRouter(router)', 1) if current == original else patched)
print('Staged creation protocol route; no server build or production change')

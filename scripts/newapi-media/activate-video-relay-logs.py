#!/usr/bin/env python3
"""Image-only switch from the deployed relay image to the hardened relay image.

Reuses the reviewed activate-video-relay.py flow (image-only check, verified database
backup, NewAPI-only recreate, regression and relay probes, automatic rollback)."""
import importlib.util
from pathlib import Path
import signal
import sys

spec = importlib.util.spec_from_file_location('video_relay_activation', Path(__file__).with_name('activate-video-relay.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
base.OLD_ID = 'sha256:0239e6f663f3c81c05043b2fdfd55e1d7f4311dcd2951590202c64c48161e3b4'
base.IMAGE = 'jiucaihezi/new-api:rc40-video-relay-logs-20261026'
# Prepare receipt 2026-10-26: VIDEO RELAY LOGS PREPARED.
base.PREPARED_ID = 'sha256:0211b15446936b7b0dec93a64547565b45e423a0034dd7e4df235964f6a9ce95'


if __name__ == '__main__':
    def interrupted(signum, frame):
        raise KeyboardInterrupt('Activation interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGHUP, interrupted)
    try:
        base.main()
    except base.ops.ActivationError as error:
        print(str(error) + '. Check the backup/rollback message. No generation requested.', file=sys.stderr)
        sys.exit(1)
    except BaseException:
        print('Video relay activation stopped. Check the backup/rollback message. Do not share env/config or keys.', file=sys.stderr)
        sys.exit(1)

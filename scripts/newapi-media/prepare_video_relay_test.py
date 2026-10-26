"""Exercise fail-closed preparation guards without Docker, root or production access."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('prepare-video-relay.sh').resolve()

class PrepareVideoRelayTests(unittest.TestCase):
    def run_guard(self, args, image='sha256:' + 'b' * 64):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'id').write_text('#!/bin/sh\necho 0\n')
            (root / 'docker').write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\necho "$FAKE_IMAGE"\n')
            for name in ('id', 'docker'):
                (root / name).chmod(0o700)
            result = subprocess.run(['bash', str(SCRIPT), *args], env={**os.environ, 'PATH': str(root) + ':' + os.environ['PATH'], 'CALLS': str(root/'calls'), 'FAKE_IMAGE': image}, capture_output=True, text=True)
            calls = (root/'calls').read_text() if (root/'calls').exists() else ''
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn('build', calls)
            self.assertNotIn('compose', calls)
            return result.stdout, calls

    def test_requires_exact_baseline(self):
        output, calls = self.run_guard([])
        self.assertIn('Usage:', output)
        self.assertEqual(calls, '')

    def test_rejects_tags_and_command_text(self):
        for value in ('latest', 'sha256:no', '$(touch /tmp/never-run-this)'):
            output, calls = self.run_guard([value])
            self.assertIn('Expected exact current image ID', output)
            self.assertEqual(calls, '')

    def test_image_drift_stops_before_source_or_mutation(self):
        output, calls = self.run_guard(['sha256:' + 'a'*64])
        self.assertIn('Production image changed', output)
        self.assertEqual(len(calls.splitlines()), 1)

    def test_build_only_and_restores_every_replaced_file(self):
        text = SCRIPT.read_text()
        for forbidden in ('compose', 'docker stop', 'docker rm ', 'docker restart', 'docker run -d'):
            self.assertNotIn(forbidden, text)
        for copied in ('router/creation_media_router.go', 'r2direct/results.go', 'jcmedia/store.go', 'jcmedia/disk_unix.go'):
            self.assertIn(copied, text)
        self.assertIn('trap restore EXIT', text)
        self.assertIn('--network none', text)

if __name__ == '__main__':
    unittest.main()

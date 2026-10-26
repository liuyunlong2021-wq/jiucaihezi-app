"""Exercise fail-closed preparation guards without Docker, root or production access."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('prepare-video-relay-logs.sh').resolve()

class PrepareVideoRelayLogsTests(unittest.TestCase):
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
        for copied in ('router/creation_media_router.go', 'r2direct/results.go', 'r2direct/results_test.go'):
            self.assertIn(copied, text)
        self.assertIn('trap restore EXIT', text)
        self.assertIn('--network none', text)

    def test_baseline_is_the_deployed_relay_image_and_source(self):
        text = SCRIPT.read_text()
        self.assertIn('rc40-video-relay-logs-20261026', text)
        # Pins are the files shipped in the first relay bundle (commit 7394975a).
        for digest in ('408a0a8b6900b5f8e72c3a6f9ddd6267aa7cb3bd17bfd27ca481143cd3934f9f',
                       '8df4ff2a6db11790bffdee1ea8b20079455c146f40368fc29789c2852e3e3c1c',
                       'b96bf8dc9823674e2397891d2d17b24d3e7ee0a1a8788343b858408ad42963f2'):
            self.assertIn(digest, text)
        self.assertNotIn('jcmedia/store.go', text)

if __name__ == '__main__':
    unittest.main()

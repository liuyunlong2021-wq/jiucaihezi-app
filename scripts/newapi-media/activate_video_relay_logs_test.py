import contextlib
import importlib.util
import io
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('activate_video_relay_logs', Path(__file__).with_name('activate-video-relay-logs.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ActivationLogsTests(unittest.TestCase):
    def test_reuses_the_reviewed_relay_activation_with_new_pins(self):
        base = module.base
        self.assertEqual(base.OLD_ID, 'sha256:0239e6f663f3c81c05043b2fdfd55e1d7f4311dcd2951590202c64c48161e3b4')
        self.assertEqual(base.IMAGE, 'jiucaihezi/new-api:rc40-video-relay-logs-20261026')
        # Receipt: VIDEO RELAY LOGS PREPARED (2026-10-26).
        self.assertEqual(base.PREPARED_ID, 'sha256:0211b15446936b7b0dec93a64547565b45e423a0034dd7e4df235964f6a9ce95')
        # The switch, backup, rollback and relay probes are the ones covered by activate_video_relay_test.py.
        self.assertTrue(callable(base.verify_relay) and callable(base.main))

    def test_refuses_to_activate_until_the_built_image_is_pinned(self):
        with patch.object(module.base, 'PREPARED_ID', ''), patch.object(module.base.os, 'geteuid', return_value=0), \
                patch.object(module.base.sys.stdin, 'isatty', return_value=True), patch.object(module.base.ops, 'docker_object') as docker, \
                contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(module.base.ops.ActivationError):
                module.base.main()
            docker.assert_not_called()


if __name__ == '__main__':
    unittest.main()

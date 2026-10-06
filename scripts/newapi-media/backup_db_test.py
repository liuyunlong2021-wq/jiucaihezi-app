import importlib.util
import json
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('backup', pathlib.Path(__file__).with_name('backup_db.py'))
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupTest(unittest.TestCase):
    def test_uses_running_newapi_connection_not_container_default_user(self):
        config = [{'Config': {'Env': ['SQL_DSN=postgres://real_user:p%40ss@postgres:5432/new_api?sslmode=disable']}}]
        def run(args, **kwargs):
            if args[-2:] == ['sh', '-s']:
                self.assertNotIn('p@ss', str(args))
                self.assertIn(b'PGUSER=real_user', kwargs['input'])
                self.assertIn(b"PGPASSWORD=p@ss", kwargs['input'])
                kwargs['stdout'].write(b'archive' * 200)
                return subprocess.CompletedProcess(args, 0, stderr=b'')
            return subprocess.CompletedProcess(args, 0, stdout=b'TABLE public.users', stderr=b'')
        with tempfile.TemporaryDirectory() as directory, patch.object(backup.subprocess, 'check_output', return_value=json.dumps(config).encode()), patch.object(backup.subprocess, 'run', side_effect=run):
            backup.main(directory)
            self.assertTrue((pathlib.Path(directory) / 'primary.dump').exists())

    def test_failure_stops_before_archive_verification(self):
        config = [{'Config': {'Env': ['SQL_DSN=postgres://real_user:pass@postgres:5432/new_api']}}]
        with tempfile.TemporaryDirectory() as directory, patch.object(backup.subprocess, 'check_output', return_value=json.dumps(config).encode()), patch.object(backup.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, stderr=b'secret')) as run:
            with self.assertRaises(RuntimeError):
                backup.main(directory)
            self.assertEqual(run.call_count, 1)

    def test_rejects_unknown_connection_format(self):
        with self.assertRaises(ValueError):
            backup.connection('host=postgres user=root')


if __name__ == '__main__':
    unittest.main()

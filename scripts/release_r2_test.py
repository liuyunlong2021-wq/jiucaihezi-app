import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import subprocess


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Store:
    def __init__(self):
        self.objects = {}
        self.fail = False
        self.race = None
        self.puts = []

    def put_object(self, **args):
        self.puts.append(args)
        if self.fail:
            raise RuntimeError('upload failed')
        key = args['Key']
        if self.race is not None:
            self.objects[key] = self.race
        if key in self.objects:
            error = RuntimeError('precondition failed')
            error.response = {'Error': {'Code': 'PreconditionFailed'}}
            raise error
        self.objects[key] = args['Body'].read()

    def get_object(self, **args):
        data = self.objects[args['Key']]
        return {'Body': io.BytesIO(data), 'ContentLength': len(data)}


class ReleaseR2Tests(unittest.TestCase):
    def setUp(self):
        self.upload = load('publish-r2-updates')
        self.redirect = load('configure-r2-downloads')

    def test_conditional_upload_reuses_only_identical_bytes(self):
        store = Store()
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / '中文.dmg'
            file.write_bytes(b'final signed bytes\x00')
            for _ in range(2):
                self.upload.upload_file(store, 'releases', '2.2.38/' + file.name, file)
            self.assertEqual(store.puts[0]['IfNoneMatch'], '*')
            self.assertIn('immutable', store.puts[0]['CacheControl'])
            file.write_bytes(b'other signed bytes!')
            with self.assertRaisesRegex(ValueError, 'SHA256'):
                self.upload.upload_file(store, 'releases', '2.2.38/' + file.name, file)
            self.assertEqual(store.objects['2.2.38/' + file.name], b'final signed bytes\x00')

    def test_upload_failure_and_concurrent_conflict_are_not_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / 'file.exe'
            file.write_bytes(b'expected')
            store = Store()
            store.fail = True
            with self.assertRaisesRegex(RuntimeError, 'upload failed'):
                self.upload.upload_file(store, 'releases', '2.2.38/file.exe', file)
            store.fail = False
            store.race = b'conflict'
            with self.assertRaisesRegex(ValueError, 'SHA256'):
                self.upload.upload_file(store, 'releases', '2.2.38/file.exe', file)

    def test_inventory_requires_all_platforms_signatures_zip_and_checksums(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            names = ['_v2.2.38_aarch64.dmg', '_v2.2.38_x64.dmg',
                     '_v2.2.38_x64_windows_setup.exe', '_v2.2.38_x64_windows_portable.zip',
                     '_aarch64.app.tar.gz', '_x64.app.tar.gz',
                     '_aarch64.app.tar.gz.sig', '_x64.app.tar.gz.sig',
                     '_v2.2.38_x64_windows_setup.exe.sig']
            for name in names:
                (root / name).write_bytes(name.encode())
            checksum = ''.join(hashlib.sha256(name.encode()).hexdigest() + '  ' + name + '\n' for name in names)
            (root / 'SHA256SUMS').write_text(checksum)
            checksum += hashlib.sha256(checksum.encode()).hexdigest() + '  SHA256SUMS\n'
            (root / 'R2-SHA256SUMS').write_text(checksum)
            files = self.upload.inventory(root)
            self.assertEqual({p.name for p in files}, set(names + ['SHA256SUMS', 'R2-SHA256SUMS']))
            (root / names[3]).unlink()
            with self.assertRaises(ValueError):
                self.upload.inventory(root)
            (root / names[3]).write_bytes(b'corrupt')
            with self.assertRaisesRegex(ValueError, 'SHA256'):
                self.upload.inventory(root)
            (root / names[3]).write_bytes(names[3].encode())
            (root / 'R2-SHA256SUMS').write_text(checksum + '0' * 64 + '  ../outside.dmg\n')
            with self.assertRaises(ValueError):
                self.upload.inventory(root)

    def test_redirects_are_exact_and_preserve_manifests_and_other_versions(self):
        source = 'server {\n    location /updates/ { alias /opt/updates/; }\n}\n'
        files = ['_v2.2.38_aarch64.dmg', 'SHA256SUMS']
        updated = self.redirect.render(source, '2.2.38', files)
        self.assertIn('location = /updates/2.2.38/_v2.2.38_aarch64.dmg', updated)
        self.assertIn('return 302 https://downloads.jiucaihezi.studio/2.2.38/', updated)
        self.assertIn('Cache-Control "no-store"', updated)
        self.assertIn('location /updates/ { alias /opt/updates/; }', updated)
        self.assertNotIn('location = /updates/latest.json', updated)
        self.assertEqual(self.redirect.render(updated, '2.2.38', files), updated)
        both = self.redirect.render(updated, '2.2.39', files)
        self.assertIn('location = /updates/2.2.38/', both)
        self.assertIn('location = /updates/2.2.39/', both)
        for unsafe in ['../file.dmg', 'a;return.dmg', 'file\n.dmg', 'latest.json']:
            with self.assertRaises(ValueError):
                self.redirect.render(source, '2.2.38', [unsafe])
        with self.assertRaises(ValueError):
            self.redirect.render(source, '../bad', files)

    def test_nginx_check_or_reload_failure_restores_previous_config(self):
        for failure in (1, 2):
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                config = root / 'nginx.conf'
                config.write_text('previous working config')
                calls = []
                def run(args, **kwargs):
                    calls.append(args)
                    if len(calls) == failure:
                        raise subprocess.CalledProcessError(1, args)
                with self.assertRaises(subprocess.CalledProcessError):
                    self.redirect.activate(config, 'new config', root / 'backup', run=run)
                self.assertEqual(config.read_text(), 'previous working config')
                self.assertEqual(calls[-1], ['systemctl', 'reload', 'nginx'])


if __name__ == '__main__':
    unittest.main()

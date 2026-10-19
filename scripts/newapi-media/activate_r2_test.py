import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import contextlib
import copy
import io
import json
from email.message import Message

spec = importlib.util.spec_from_file_location('activate_r2', Path(__file__).with_name('activate-r2.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ActivationTests(unittest.TestCase):
    def test_live_probe_never_submits_generation_or_forwards_auth_to_r2(self):
        root = 'https://' + module.ACCOUNT + '.r2.cloudflarestorage.com/' + module.BUCKET + '/lingdong-temp/1/a.png'
        grant = {'method': 'PUT', 'headers': {'Content-Type': 'image/png'}, 'upload_url': root + '?X-Amz-Signature=put', 'asset_url': root + '?X-Amz-Signature=get', 'head_url': root + '?X-Amz-Signature=head'}
        requests = []
        uploaded = []
        def http(url, method='GET', data=None, headers=None, **kwargs):
            requests.append((url, method, headers or {}))
            response = Message()
            response['Access-Control-Allow-Origin'] = module.ORIGIN
            response['Access-Control-Allow-Methods'] = 'PUT, GET, HEAD'
            response['Content-Type'] = 'image/png'
            if url.endswith('/api/creations/lingdong/upload-url'):
                return (json.dumps(grant).encode() if headers.get('Authorization') else b'{}', response)
            if url.endswith('/api/creations/upload-url'):
                return (b'{"form_fields":{"policy":"fixture"}}', response)
            if method == 'PUT':
                uploaded.append(data)
            if method == 'HEAD':
                response['Content-Length'] = str(len(uploaded[0]))
            return (uploaded[0] if method == 'GET' else b'', response)
        with patch.object(module, 'http', side_effect=http):
            module.verify('sk-fixture', 'SD-2.5-特价-2')
        self.assertEqual(len(uploaded), 1)
        self.assertFalse(any('/v1/videos' in url for url, _, _ in requests))
        for url, _, headers in requests:
            if url.startswith('https:'):
                self.assertNotIn('Authorization', headers)

    def test_switch_failure_rolls_back_and_config_failure_never_switches(self):
        for fail_at in ('config', 'verify', None):
            with self.subTest(fail_at=fail_at), tempfile.TemporaryDirectory() as directory:
                base = Path(directory)
                files = [base / name for name in ('base.yml', 'media.yml', 'oss.yml')]
                for file in files:
                    file.write_text('fixture')
                backup = base / 'backup'
                backup.mkdir()
                override = base / 'r2.json'
                credentials = {'R2_BUCKET': 'fixture'}
                before = {'services': {'new-api': {'image': 'old', 'environment': {'OSS_BUCKET': 'keep'}, 'ports': ['3000:3000']}}}
                after = copy.deepcopy(before)
                after['services']['new-api'].update(image=module.PREPARED_ID, environment={'OSS_BUCKET': 'keep', **credentials})
                if fail_at == 'config':
                    after['services']['new-api']['ports'] = []
                old = {'Id': 'old-container', 'Image': 'sha256:old-runtime', 'State': {'Running': True}, 'Config': {'Image': module.OLD_IMAGE, 'Labels': {'com.docker.compose.project': 'new-api-new', 'com.docker.compose.project.working_dir': str(module.BASE), 'com.docker.compose.project.config_files': ','.join(map(str, files))}}}
                switches = []
                def docker(*args):
                    if args[:2] == ('image', 'inspect'):
                        return {'Id': module.PREPARED_ID if args[-1] == module.IMAGE else 'sha256:old-runtime'}
                    return {'Config': {'Image': module.PREPARED_ID if switches[-1] == 'new' else 'sha256:old-runtime'}} if switches else old
                def command(*args):
                    if 'config' in args:
                        return json.dumps(after if str(override) in args else before).encode()
                    if 'up' in args:
                        switches.append('new' if str(override) in args else 'rollback')
                    return b''
                def http(url, *args, **kwargs):
                    return (json.dumps({'data': [{'id': 'SD-2.5-特价-2'}]} if url.endswith('/v1/models') else {'success': True}).encode(), {})
                def verify(*args):
                    if fail_at == 'verify':
                        raise module.ActivationError('fixture upload failed')
                with patch.object(module, 'FILES', files), patch.object(module, 'OVERRIDE', override), patch.object(module.os, 'geteuid', return_value=0), patch.object(module.sys.stdin, 'isatty', return_value=True), patch.object(module, 'read_env', return_value=credentials), patch.object(module, 'docker_object', side_effect=docker), patch.object(module, 'run', side_effect=command), patch.object(module, 'http', side_effect=http), patch.object(module.getpass, 'getpass', return_value='sk-fixture'), patch.object(module.tempfile, 'mkdtemp', return_value=str(backup)), patch.object(module, 'verify', side_effect=verify), contextlib.redirect_stdout(io.StringIO()):
                    previous_umask = os.umask(0o077)
                    try:
                        if fail_at:
                            with self.assertRaises(RuntimeError):
                                module.main()
                        else:
                            module.main()
                    finally:
                        os.umask(previous_umask)
                self.assertEqual(switches, [] if fail_at == 'config' else ['new', 'rollback'] if fail_at == 'verify' else ['new'])
                self.assertIn('sha256:old-runtime', (backup / 'rollback.json').read_text())
                self.assertNotIn('sk-fixture', (backup / 'rollback.sh').read_text())

    def test_config_preserves_oss_ports_mounts_and_other_services(self):
        before = {'services': {'new-api': {'image': 'old', 'environment': {'OSS_BUCKET': 'old-bucket'}, 'ports': ['3000:3000'], 'volumes': ['data:/data']}, 'postgres': {'image': 'postgres:17'}}}
        import copy
        after = copy.deepcopy(before)
        after['services']['new-api']['image'] = 'sha256:new'
        after['services']['new-api']['environment'].update({'R2_BUCKET': 'fixture'})
        module.check_config(before, after, {'R2_BUCKET': 'fixture'}, 'sha256:new')
        for key, value in [('environment', {'R2_BUCKET': 'fixture'}), ('ports', []), ('volumes', [])]:
            broken = copy.deepcopy(after)
            broken['services']['new-api'][key] = value
            with self.assertRaises(RuntimeError):
                module.check_config(before, broken, {'R2_BUCKET': 'fixture'}, 'sha256:new')

    def test_env_validation_does_not_execute_or_expose_values(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'r2.env'
            value = 'R2_ACCOUNT_ID=d055e5deea504cb25551755cc486a61a\nR2_BUCKET=jiucaihezi-media-test\nR2_ACCESS_KEY_ID=fixture-id\nR2_SECRET_ACCESS_KEY=fixture-secret\n'
            path.write_text(value)
            path.chmod(0o600)
            self.assertEqual(module.read_env(path)['R2_BUCKET'], 'jiucaihezi-media-test')
            for content in [value + 'R2_BUCKET=other\n', value.replace('fixture-secret', '$(echo bad)'), value.replace('jiucaihezi-media-test', 'other')]:
                path.write_text(content)
                with self.assertRaises(RuntimeError) as error:
                    module.read_env(path)
                self.assertNotIn('fixture-secret', str(error.exception))
            path.write_text(value)
            path.chmod(0o644)
            with self.assertRaises(RuntimeError):
                module.read_env(path)

    def test_signature_urls_are_restricted_to_one_test_object(self):
        root = 'https://d055e5deea504cb25551755cc486a61a.r2.cloudflarestorage.com/jiucaihezi-media-test/lingdong-temp/1/a.png'
        grant = {'method': 'PUT', 'headers': {'Content-Type': 'image/png'}, 'upload_url': root + '?X-Amz-Signature=put', 'asset_url': root + '?X-Amz-Signature=get', 'head_url': root + '?X-Amz-Signature=head'}
        module.check_grant(grant)
        with self.assertRaises(RuntimeError):
            module.check_grant({**grant, 'asset_url': 'https://evil.invalid/a'})


if __name__ == '__main__':
    unittest.main()

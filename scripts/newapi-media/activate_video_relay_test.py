import copy
import contextlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
from email.message import Message
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('activate_video_relay', Path(__file__).with_name('activate-video-relay.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ActivationTests(unittest.TestCase):
    def setUp(self):
        self.pin = patch.object(module, 'PREPARED_ID', 'sha256:' + 'a' * 64)
        self.pin.start()
        self.addCleanup(self.pin.stop)

    def test_compose_redis_dollar_serialization_is_not_a_runtime_change(self):
        actual = {'REDIS_CONN_STRING': 'redis://:fixture$pass${part}$$tail@redis:6379/0', 'KEEP': 'literal$$value'}
        module.check_environment(actual, actual)
        rendered = {**actual, 'REDIS_CONN_STRING': actual['REDIS_CONN_STRING'].replace('$', '$$')}
        module.check_environment(rendered, actual)
        for broken in [
            {**rendered, 'REDIS_CONN_STRING': 'redis://:different@redis:6379/0'},
            {**rendered, 'REDIS_CONN_STRING': rendered['REDIS_CONN_STRING'].replace('@redis:', '@other:')},
            {**rendered, 'KEEP': 'different'},
            {**rendered, 'EXTRA': 'value'},
            {'KEEP': actual['KEEP']},
        ]:
            with self.assertRaises(module.ops.ActivationError):
                module.check_environment(broken, actual)

    def test_switch_backup_failure_and_rollback_without_secret_output(self):
        for failure in ('config', 'backup', 'verify', 'redis_escaped', None):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                base = Path(directory)
                files = [base / name for name in ('base.yml', 'media.yml', 'oss.yml', 'r2.json')]
                for file in files: file.write_text('fixture')
                files[-1].write_text(json.dumps({'services': {'new-api': {'image': module.OLD_ID, 'env_file': ['private.env']}}}))
                original = files[-1].read_bytes()
                backup = base / 'backup'
                backup.mkdir()
                before = {'services': {'new-api': {'image': module.OLD_ID, 'environment': {'R2_SECRET_ACCESS_KEY': 'fixture-secret'}, 'ports': ['3000:3000']}}}
                after = copy.deepcopy(before)
                after['services']['new-api']['image'] = module.PREPARED_ID
                if failure == 'config': after['services']['new-api']['ports'] = []
                old = {'Id': 'old-container', 'Image': module.OLD_ID, 'State': {'Running': True}, 'Config': {'Image': module.OLD_ID, 'Env': ['R2_SECRET_ACCESS_KEY=fixture-secret'], 'Labels': {'com.docker.compose.project': 'new-api-new', 'com.docker.compose.project.working_dir': str(base), 'com.docker.compose.project.config_files': ','.join(map(str, files))}}, 'Mounts': [], 'HostConfig': {'NetworkMode': 'keep', 'PortBindings': {'3000': 'keep'}, 'RestartPolicy': {'Name': 'unless-stopped'}}}
                if failure == 'redis_escaped':
                    value = 'redis://:fixture$secret@redis:6379/0'
                    for config in (before, after): config['services']['new-api']['environment']['REDIS_CONN_STRING'] = value.replace('$', '$$')
                    old['Config']['Env'].append('REDIS_CONN_STRING=' + value)
                switches, events = [], []
                def docker(*args):
                    if args[0] == 'image': return {'Id': module.PREPARED_ID if args[-1] == module.IMAGE else module.OLD_ID, 'Config': {'Env': []}}
                    current = copy.deepcopy(old)
                    if switches:
                        current['Image'] = switches[-1]
                        current['Config']['Image'] = switches[-1]
                    return current
                def run(*args):
                    if 'config' in args: return json.dumps(after if any(str(arg).endswith('image-only.json') for arg in args) else before).encode()
                    if args[0] == 'python3':
                        events.append('backup')
                        if failure == 'backup': raise module.ops.ActivationError('fixture backup failure')
                    if 'up' in args:
                        events.append('switch')
                        switches.append(json.loads(files[-1].read_text())['services']['new-api']['image'])
                    return b''
                def verify(*args, **kwargs):
                    if failure == 'verify': raise module.ops.ActivationError('fixture verification failure')
                output = io.StringIO()
                with patch.object(module, 'FILES', files), patch.object(module.ops, 'BASE', base), patch.object(module.ops, 'OVERRIDE', files[-1]), patch.object(module.os, 'geteuid', return_value=0), patch.object(module.sys.stdin, 'isatty', return_value=True), patch.object(module.ops, 'read_env'), patch.object(module.ops, 'docker_object', side_effect=docker), patch.object(module.ops, 'run', side_effect=run), patch.object(module.ops, 'http', return_value=(b'{}', {})), patch.object(module.ops.getpass, 'getpass', return_value='sk-fixture-key'), patch.object(module.tempfile, 'mkdtemp', return_value=str(backup)), patch.object(module.ops, 'verify', side_effect=verify), patch.object(module, 'verify_public'), patch.object(module.public_check, 'verify', side_effect=verify), patch.object(module.ops, 'wait_healthy'), contextlib.redirect_stdout(output):
                    old_umask = os.umask(0o077)
                    try:
                        if failure in ('config', 'backup', 'verify'):
                            with self.assertRaises(module.ops.ActivationError): module.main()
                        else: module.main()
                    finally: os.umask(old_umask)
                expected = [] if failure in ('config', 'backup') else [module.PREPARED_ID, module.OLD_ID] if failure == 'verify' else [module.PREPARED_ID]
                self.assertEqual(switches, expected)
                if switches: self.assertEqual(events[:2], ['backup', 'switch'])
                if failure in ('config', 'backup', 'verify'): self.assertEqual(files[-1].read_bytes(), original)
                self.assertNotIn('fixture-secret', output.getvalue())
                self.assertNotIn('sk-fixture-key', output.getvalue())

    def test_only_image_may_change(self):
        before = {'services': {'new-api': {'image': 'old', 'environment': {'R2_SECRET_ACCESS_KEY': 'fixture'}, 'ports': ['3000:3000'], 'volumes': ['data:/data']}, 'postgres': {'image': 'postgres'}}}
        after = copy.deepcopy(before)
        after['services']['new-api']['image'] = module.PREPARED_ID
        module.check_image_only(before, after)
        for key, value in [('environment', {}), ('ports', []), ('volumes', [])]:
            broken = copy.deepcopy(after)
            broken['services']['new-api'][key] = value
            with self.assertRaises(module.ops.ActivationError):
                module.check_image_only(before, broken)
        after['services']['postgres']['image'] = 'changed'
        with self.assertRaises(module.ops.ActivationError):
            module.check_image_only(before, after)

    def test_public_probe_has_no_credentials_or_generation(self):
        calls = []
        def http(url, method='GET', data=None, headers=None, **kwargs):
            calls.append((url, method, headers or {}, kwargs.get('expected')))
            response = Message()
            response['Access-Control-Allow-Origin'] = module.ops.ORIGIN
            response['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
            response['Access-Control-Allow-Headers'] = 'Authorization, Content-Type'
            return b'', response
        with patch.object(module.ops, 'http', side_effect=http):
            module.verify_public()
        self.assertEqual(len(calls), 6)
        self.assertTrue(all('/api/creations/' in url for url, *_ in calls))
        self.assertFalse(any('Authorization' in headers for _, _, headers, _ in calls))
        self.assertTrue(all(headers.get('User-Agent') == 'jiucaihezi-media-check/1.0' for _, _, headers, _ in calls))
        self.assertEqual([expected for _, method, _, expected in calls if method == 'POST'], [(401,), (401,), (401,)])

    def test_yihong_live_probe_is_scoped_and_never_generates(self):
        import json
        calls, uploaded = [], []
        root = 'https://' + module.ops.ACCOUNT + '.r2.cloudflarestorage.com/' + module.ops.BUCKET + '/yihong-temp/1/a.png'
        grant = {'method': 'PUT', 'headers': {'Content-Type': 'image/png'}, 'upload_url': root+'?X-Amz-Signature=put', 'asset_url': root+'?X-Amz-Signature=get', 'head_url': root+'?X-Amz-Signature=head'}
        def http(url, method='GET', data=None, headers=None, **kwargs):
            calls.append((url, method, headers or {}))
            response = Message()
            response['Access-Control-Allow-Origin'] = module.ops.ORIGIN
            response['Access-Control-Allow-Methods'] = 'PUT, GET, HEAD'
            response['Content-Type'] = 'image/png'
            if url.endswith('/api/creations/yihong/upload-url'):
                return json.dumps(grant).encode(), response
            if url.endswith('/api/creations/upload-url'):
                return b'{"form_fields":{"policy":"fixture"}}', response
            if method == 'PUT': uploaded.append(data)
            if method == 'HEAD': response['Content-Length'] = str(len(uploaded[0]))
            return (uploaded[0] if method == 'GET' else b''), response
        with patch.object(module.ops, 'http', side_effect=http):
            module.ops.verify('sk-fixture', 'yh-seedance2.5 Ultra', channel='yihong')
        self.assertEqual(len(uploaded), 1)
        self.assertFalse(any('/v1/videos' in url for url, _, _ in calls))
        for url, _, headers in calls:
            if url.startswith('https:'): self.assertNotIn('Authorization', headers)
        with self.assertRaises(module.ops.ActivationError):
            module.ops.check_grant(grant, channel='lingdong')


    def test_pins_follow_the_public_r2_production_and_prepared_relay_image(self):
        self.pin.stop()
        self.assertEqual(module.OLD_ID, 'sha256:311f21c7a4787a294028a56302b8257b6f0f35b611ffa506d3821b6c78d07eda')
        self.assertEqual(module.PREPARED_ID, 'sha256:0239e6f663f3c81c05043b2fdfd55e1d7f4311dcd2951590202c64c48161e3b4')
        self.assertEqual(module.IMAGE, 'jiucaihezi/new-api:rc40-video-relay-20261026')
        self.pin.start()

    def test_relay_probe_requires_auth_and_reaches_the_host_without_generating(self):
        calls = []
        def http(url, method='GET', data=None, headers=None, **kwargs):
            calls.append((url, method, headers or {}, kwargs.get('expected', (200,))))
            return b'', Message()
        with patch.object(module.ops, 'http', side_effect=http):
            module.verify_relay('sk-fixture')
        self.assertEqual([method for _, method, _, _ in calls], ['GET', 'GET', 'GET'])
        self.assertTrue(all('/api/creations/videos/' in url and url.endswith('/content') for url, *_ in calls))
        anonymous, authenticated = calls[:2], calls[2]
        self.assertEqual({url.split('/api/')[0] for url, *_ in anonymous}, {module.ops.LOCAL, module.PUBLIC})
        for _, _, headers, expected in anonymous:
            self.assertNotIn('Authorization', headers)
            self.assertEqual(expected, (401,))
        _, _, headers, expected = authenticated
        self.assertEqual(headers.get('Authorization'), 'Bearer sk-fixture')
        # A missing task is passed through by the host (4xx); 502 would mean the loopback to the host is broken.
        self.assertIn(404, expected)
        self.assertNotIn(401, expected)
        self.assertNotIn(502, expected)
        self.assertNotIn(302, expected)

if __name__ == '__main__':
    unittest.main()

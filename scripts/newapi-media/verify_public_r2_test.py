import importlib.util
import json
from email.message import Message
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('public_r2', Path(__file__).with_name('verify-public-r2.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class VerifyPublicR2Tests(unittest.TestCase):
    def run_fake(self, invalid=False, corrupt=False):
        calls = []
        uploaded = b''
        root = 'https://'+module.ops.ACCOUNT+'.r2.cloudflarestorage.com/'+module.ops.BUCKET+'/creation-temp/17/'+'a'*32+'.png'
        def fake(url, method='GET', data=None, headers=None, **kwargs):
            nonlocal uploaded
            calls.append((url, method, headers or {}))
            response_headers = Message()
            response_headers['Content-Type'] = 'image/png'
            if url.endswith('/upload-url'):
                if not (headers or {}).get('Authorization'): return b'', response_headers
                grant = {'method': 'PUT', 'headers': {'Content-Type': 'image/png'}}
                for name, ttl in [('upload_url',300),('asset_url',21600),('head_url',21600)]:
                    grant[name] = root+'?X-Amz-Signature=signed&X-Amz-Expires='+str(ttl)
                if invalid: grant['upload_url'] = 'https://evil.invalid/object'
                return json.dumps(grant).encode(), response_headers
            self.assertNotIn('Authorization', headers or {})
            if method == 'PUT': uploaded = data
            response_headers['Content-Length'] = str(len(uploaded))
            return (b'corrupt' if corrupt and method == 'GET' else uploaded), response_headers
        original = module.ops.http
        module.ops.http = fake
        try:
            if invalid or corrupt:
                with self.assertRaises(module.ops.ActivationError): module.verify('fixture-key')
            else: module.verify('fixture-key')
        finally: module.ops.http = original
        self.assertFalse(any('/v1/' in url for url, _, _ in calls))
        return calls

    def test_exact_readback_without_generation(self):
        self.assertEqual(len(self.run_fake()), 5)
    def test_bad_grant_stops_before_put(self):
        self.assertEqual(len(self.run_fake(invalid=True)), 2)
    def test_corrupt_readback_stops(self):
        self.assertEqual(len(self.run_fake(corrupt=True)), 4)

if __name__ == '__main__': unittest.main()

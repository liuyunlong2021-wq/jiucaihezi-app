from importlib.machinery import SourceFileLoader
from pathlib import Path
import unittest


MODULE = SourceFileLoader(
    'install_document_converter_nginx',
    str(Path(__file__).with_name('install-nginx-location.py')),
).load_module()


class InstallNginxLocationTest(unittest.TestCase):
    def test_inserts_exact_route_after_existing_location(self) -> None:
        config = '''server {
    location /api/health {
        proxy_pass http://127.0.0.1:8090/api/health;
    }
}
'''

        result = MODULE.insert_after_anchor(config)

        self.assertIn('location = /documents/markdown {', result)
        self.assertIn('proxy_pass http://127.0.0.1:8810/documents/markdown;', result)
        self.assertLess(result.index('location /api/health'), result.index('location = /documents/markdown'))

    def test_does_not_duplicate_existing_route(self) -> None:
        config = 'server {\n    location = /documents/markdown {\n    }\n}\n'

        self.assertTrue(MODULE.has_live_location(config))


if __name__ == '__main__':
    unittest.main()

import unittest

from src.converter import (
    MAX_FILE_BYTES,
    clamp_max_chars,
    is_supported_filename,
    public_error_message,
)


class ConverterContractTest(unittest.TestCase):
    def test_accepts_supported_document_extensions_only(self):
        self.assertTrue(is_supported_filename('brief.docx'))
        self.assertTrue(is_supported_filename('report.PDF'))
        self.assertTrue(is_supported_filename('sheet.xlsx'))
        self.assertFalse(is_supported_filename('archive.zip'))
        self.assertFalse(is_supported_filename('no-extension'))

    def test_clamps_client_text_limit_to_server_bounds(self):
        self.assertEqual(clamp_max_chars(0), 1)
        self.assertEqual(clamp_max_chars(500_000), 500_000)
        self.assertEqual(clamp_max_chars(9_999_999), 1_000_000)

    def test_public_error_never_leaks_temporary_server_paths(self):
        message = public_error_message('MarkItDown failed at /tmp/jc-document-abc/source.docx')
        self.assertNotIn('/tmp/jc-document-abc/source.docx', message)
        self.assertIn('文档转换失败', message)
        self.assertGreater(MAX_FILE_BYTES, 0)

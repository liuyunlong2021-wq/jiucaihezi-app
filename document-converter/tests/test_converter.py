import unittest
from pathlib import Path

from src.converter import (
    MAX_FILE_BYTES,
    SUPPORTED_EXTENSIONS,
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

    def test_allowlist_matches_the_pinned_anydoc_engine(self):
        # 逐条对齐 anydoc 0.2.3 的 `Format::from_extension`（csv 除外：由前端文本链路
        # 直通处理）。引擎升版必须同步这份清单，否则会出现“UI 让选、服务端 415 拒”。
        self.assertEqual(
            SUPPORTED_EXTENSIONS,
            {
                '.doc', '.docx', '.docm',
                '.ppt', '.pps', '.pot', '.pptx', '.pptm', '.ppsx', '.ppsm',
                '.xls', '.xlsx', '.xlsm', '.xlsb',
                '.odt', '.ods', '.odp',
                '.rtf', '.pdf', '.epub',
            },
        )

    def test_every_allowed_extension_is_one_the_engine_can_convert(self):
        # 回归：.epub 曾在文件选择器里可选，却在这里被 415 拒掉。
        for name in ('book.epub', 'BOOK.EPUB', 'deck.ppsm', 'macro.docm', 'sheet.xlsb'):
            self.assertTrue(is_supported_filename(name), msg=name)
        for name in ('book.mobi', 'book.azw3', 'page.html'):
            self.assertFalse(is_supported_filename(name), msg=name)

    def test_clamps_client_text_limit_to_server_bounds(self):
        self.assertEqual(clamp_max_chars(0), 1)
        self.assertEqual(clamp_max_chars(500_000), 500_000)
        self.assertEqual(clamp_max_chars(9_999_999), 9_999_999)
        self.assertEqual(clamp_max_chars(99_999_999), 20_000_000)

    def test_public_error_never_leaks_temporary_server_paths(self):
        message = public_error_message('MarkItDown failed at /tmp/jc-document-abc/source.docx')
        self.assertNotIn('/tmp/jc-document-abc/source.docx', message)
        self.assertIn('文档转换失败', message)
        self.assertGreater(MAX_FILE_BYTES, 0)

    def test_public_error_never_leaks_python_traceback(self):
        message = public_error_message('Traceback (most recent call last):\\n  File "/app/src/main.py", line 1')
        self.assertNotIn('Traceback', message)
        self.assertNotIn('/app/src/main.py', message)

    def test_requirements_include_anydoc_converter(self):
        requirements = (Path(__file__).resolve().parents[1] / 'requirements.txt').read_text()
        self.assertRegex(
            requirements,
            r'(?m)^firecrawl-anydoc==0\.2\.3$',
            msg='Cloud conversion must use the same pinned AnyDoc version as Desktop',
        )

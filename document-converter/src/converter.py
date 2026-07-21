import re
from pathlib import Path

MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_CHARS = 1_000_000
SUPPORTED_EXTENSIONS = {
    '.doc', '.docx', '.pdf', '.xls', '.xlsx', '.ppt', '.pptx',
    '.odt', '.ods', '.odp', '.rtf',
}


def is_supported_filename(filename: str) -> bool:
    return Path(str(filename or '')).suffix.lower() in SUPPORTED_EXTENSIONS


def clamp_max_chars(value: int | str | None) -> int:
    try:
        raw = 500_000 if value is None or value == '' else int(value)
        return max(1, min(raw, MAX_CHARS))
    except (TypeError, ValueError):
        return 500_000


def markdown_filename(filename: str) -> str:
    name = Path(str(filename or 'document')).name
    stem = Path(name).stem.strip() or 'document'
    safe_stem = re.sub(r'[\\\\/:*?\"<>|]+', '_', stem)
    return f'{safe_stem}.md'


def public_error_message(error: str) -> str:
    message = str(error or '').strip()
    if not message:
        return '文档转换失败。'
    if 'Traceback (most recent call last):' in message:
        return '文档转换失败，请确认文件未损坏后重试。'
    message = re.sub(r'(?:^|\s)/(?:tmp|var|app|opt|root|home|private)/\S+', ' [服务器路径]', message)
    return f"文档转换失败：{message[:400]}"

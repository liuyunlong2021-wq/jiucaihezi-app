import re
from pathlib import Path

MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_CHARS = 20_000_000
# 与 Desktop 端内嵌的同一版本 AnyDoc 保持同一份能力，条目来自 anydoc 0.2.3 的
# `Format::from_extension`。白名单落后于引擎时会出现“文件选择器让选、服务端 415 拒”
# 的矛盾（.epub 就这样漏了很久），所以这里逐条对齐引擎，升 anydoc 时同步复查。
# 不含 .csv：它已由前端文本链路直通处理，再列入这里会多出一条互相竞争的转换路径。
SUPPORTED_EXTENSIONS = {
    # Word
    '.doc', '.docx', '.docm',
    # PowerPoint
    '.ppt', '.pps', '.pot', '.pptx', '.pptm', '.ppsx', '.ppsm',
    # Excel
    '.xls', '.xlsx', '.xlsm', '.xlsb',
    # OpenDocument
    '.odt', '.ods', '.odp',
    # 其他
    '.rtf', '.pdf', '.epub',
}


def is_supported_filename(filename: str) -> bool:
    return Path(str(filename or '')).suffix.lower() in SUPPORTED_EXTENSIONS


def clamp_max_chars(value: int | str | None) -> int:
    try:
        raw = MAX_CHARS if value is None or value == '' else int(value)
        return max(1, min(raw, MAX_CHARS))
    except (TypeError, ValueError):
        return MAX_CHARS


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

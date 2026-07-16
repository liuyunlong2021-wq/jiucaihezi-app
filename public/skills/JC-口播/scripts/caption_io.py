"""字幕数据的唯一读写入口。"""
import json
import re


def srt_time_to_sec(value):
    hours, minutes, seconds = value.replace(',', '.').split(':')
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def parse_srt(path):
    with open(path, 'r', encoding='utf-8') as handle:
        content = handle.read().strip()

    captions = []
    for block in re.split(r'\n\n+', content):
        lines = block.strip().splitlines()
        if len(lines) < 3:
            continue
        match = re.match(
            r'(\d+:\d+:\d+[.,]\d+)\s*-->\s*(\d+:\d+:\d+[.,]\d+)', lines[1]
        )
        if not match:
            continue
        text = ' '.join(lines[2:]).strip()
        if text:
            start = srt_time_to_sec(match.group(1))
            end = srt_time_to_sec(match.group(2))
            captions.append({
                'id': len(captions),
                'start': start,
                'end': end,
                'duration': round(end - start, 3),
                'raw_text': text,
                'corrected_text': text,
                'display_text': text,
                'text': text,
            })
    return captions


def write_json(path, data):
    with open(path, 'w', encoding='utf-8') as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)


def read_json(path):
    with open(path, 'r', encoding='utf-8') as handle:
        return json.load(handle)


def sec_to_srt_time(seconds):
    milliseconds = round(seconds * 1000)
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, milliseconds = divmod(remainder, 1000)
    return f'{hours:02d}:{minutes:02d}:{seconds:02d},{milliseconds:03d}'


def write_srt(path, captions):
    blocks = []
    for index, caption in enumerate(captions, start=1):
        blocks.append(
            f"{index}\n{sec_to_srt_time(caption['start'])} --> "
            f"{sec_to_srt_time(caption['end'])}\n{caption['text']}"
        )
    with open(path, 'w', encoding='utf-8') as handle:
        handle.write('\n\n'.join(blocks) + ('\n' if blocks else ''))

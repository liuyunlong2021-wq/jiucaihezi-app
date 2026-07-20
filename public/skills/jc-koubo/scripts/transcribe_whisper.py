#!/usr/bin/env python3
"""First stage: transcribe a video to SRT with Whisper."""
import argparse
import importlib.util
import sys
from pathlib import Path


def write_srt(path, segments):
    def stamp(seconds):
        millis = round(seconds * 1000)
        hours, rest = divmod(millis, 3_600_000)
        minutes, rest = divmod(rest, 60_000)
        seconds, millis = divmod(rest, 1000)
        return f'{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}'

    with open(path, 'w', encoding='utf-8') as handle:
        for index, segment in enumerate(segments, 1):
            text = segment.get('text', '').strip()
            if not text:
                continue
            handle.write(
                f'{index}\n{stamp(segment["start"])} --> {stamp(segment["end"])}\n{text}\n\n'
            )


def main():
    parser = argparse.ArgumentParser(description='用 OpenAI Whisper 生成原始 SRT')
    parser.add_argument('video')
    parser.add_argument('-o', '--output', default=None)
    parser.add_argument('--model', default='small', choices=['tiny', 'base', 'small', 'medium', 'large'])
    parser.add_argument('--language', default='zh')
    args = parser.parse_args()

    if importlib.util.find_spec('whisper') is None:
        print(
            '未安装 openai-whisper。请在当前 Python 环境安装：\n'
            '  pip install -U openai-whisper\n'
            '然后重新运行本脚本。',
            file=sys.stderr,
        )
        return 2

    import whisper

    video = Path(args.video)
    output = Path(args.output) if args.output else video.with_name('subtitle_raw.srt')
    print(f'加载 Whisper 模型: {args.model}')
    model = whisper.load_model(args.model)
    result = model.transcribe(str(video), language=args.language, fp16=False)
    write_srt(output, result['segments'])
    print(f'✅ Whisper 完成: {output} ({len(result["segments"])} 条)')
    print('下一步：由宿主 AI 校准 subtitle_raw.srt，输出 subtitle_corrected.srt。')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

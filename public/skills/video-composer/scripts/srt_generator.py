#!/usr/bin/env python3
"""
SRT 字幕生成工具
从镜头数据生成 SRT 字幕文件
"""

import json


def format_srt_time(seconds):
    """转换为 SRT 时间格式：00:00:10,500"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def generate_srt_from_shots(shots, output_path):
    """
    从镜头列表生成 SRT 字幕文件

    shots: 镜头列表，每个镜头包含 '台词' 和 '时长' 字段
    output_path: 输出 SRT 文件路径
    """
    lines = []
    time_offset = 0.0
    subtitle_index = 1

    for shot in shots:
        dialogue = shot.get('台词') or shot.get('dialogue')
        duration = shot.get('时长') or shot.get('duration', 3.0)

        if dialogue and dialogue.strip():
            start = time_offset
            end = time_offset + duration

            lines.append(str(subtitle_index))
            lines.append(f"{format_srt_time(start)} --> {format_srt_time(end)}")
            lines.append(dialogue.strip())
            lines.append("")

            subtitle_index += 1

        time_offset += duration

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    print(f"生成字幕文件: {output_path} ({subtitle_index - 1} 条字幕)")


def main():
    import argparse

    parser = argparse.ArgumentParser(description='SRT 字幕生成工具')
    parser.add_argument('--shots', required=True, help='镜头数据文件（JSON 格式）')
    parser.add_argument('--output', required=True, help='输出 SRT 文件路径')

    args = parser.parse_args()

    # 读取镜头数据
    with open(args.shots, 'r', encoding='utf-8') as f:
        shots = json.load(f)

    # 生成 SRT
    generate_srt_from_shots(shots, args.output)


if __name__ == '__main__':
    main()

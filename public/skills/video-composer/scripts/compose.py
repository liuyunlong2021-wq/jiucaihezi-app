#!/usr/bin/env python3
"""
video-composer v1.0
视频合成工具 - 拼接视频并添加字幕
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


def check_ffmpeg():
    """检查 ffmpeg 是否已安装"""
    try:
        subprocess.run(['ffmpeg', '-version'], capture_output=True, check=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


def create_filelist(clips, output_path):
    """创建 ffmpeg concat 所需的文件列表"""
    with open(output_path, 'w') as f:
        for clip in clips:
            # 转换为绝对路径
            abs_path = os.path.abspath(clip)
            f.write(f"file '{abs_path}'\n")


def concat_videos(clips, output_path):
    """拼接视频（无字幕）"""
    filelist = '/tmp/video_composer_filelist.txt'
    create_filelist(clips, filelist)

    cmd = [
        'ffmpeg', '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', filelist,
        '-c', 'copy',
        output_path
    ]

    print(f"拼接 {len(clips)} 个视频片段...")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"错误: {result.stderr}", file=sys.stderr)
        return False

    # 清理临时文件
    os.remove(filelist)
    return True


def add_subtitles(input_video, subtitles_file, output_path):
    """添加字幕（硬字幕）"""
    cmd = [
        'ffmpeg', '-y',
        '-i', input_video,
        '-vf', f"subtitles={subtitles_file}",
        output_path
    ]

    print(f"添加字幕: {subtitles_file}")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"错误: {result.stderr}", file=sys.stderr)
        return False

    return True


def compose(clips, output_path, subtitles_file=None):
    """主合成流程"""
    if not clips:
        print("错误: 没有输入视频", file=sys.stderr)
        return False

    # 检查输入文件是否存在
    for clip in clips:
        if not os.path.exists(clip):
            print(f"错误: 文件不存在: {clip}", file=sys.stderr)
            return False

    # 如果只有一个视频且无字幕，直接复制
    if len(clips) == 1 and not subtitles_file:
        import shutil
        shutil.copy(clips[0], output_path)
        print(f"完成: {output_path}")
        return True

    # 如果有字幕，需要两步处理
    if subtitles_file:
        if not os.path.exists(subtitles_file):
            print(f"错误: 字幕文件不存在: {subtitles_file}", file=sys.stderr)
            return False

        # 先拼接视频
        temp_video = '/tmp/video_composer_temp.mp4'
        if not concat_videos(clips, temp_video):
            return False

        # 再添加字幕
        if not add_subtitles(temp_video, subtitles_file, output_path):
            os.remove(temp_video)
            return False

        # 清理临时文件
        os.remove(temp_video)
    else:
        # 只拼接视频
        if not concat_videos(clips, output_path):
            return False

    print(f"完成: {output_path}")
    return True


def load_config(config_path):
    """加载配置文件"""
    with open(config_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def main():
    parser = argparse.ArgumentParser(description='视频合成工具 v1.0')
    parser.add_argument('--input', nargs='+', help='输入视频文件列表')
    parser.add_argument('--subtitles', help='字幕文件（SRT 格式）')
    parser.add_argument('--output', help='输出文件路径')
    parser.add_argument('--config', help='配置文件路径（JSON 格式）')

    args = parser.parse_args()

    # 检查 ffmpeg
    if not check_ffmpeg():
        print("错误: 未找到 ffmpeg，请先安装", file=sys.stderr)
        sys.exit(1)

    # 从配置文件或命令行参数获取设置
    if args.config:
        config = load_config(args.config)
        clips = config['video']['clips']
        output_path = config['output']
        subtitles_file = config.get('subtitles', {}).get('file')
    else:
        if not args.input or not args.output:
            parser.print_help()
            sys.exit(1)
        clips = args.input
        output_path = args.output
        subtitles_file = args.subtitles

    # 执行合成
    success = compose(clips, output_path, subtitles_file)
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
高光提取引擎——基于抖音算法逻辑，从纠正后的 SRT 中挑选高光时间段。

规则：
1. 开篇高光：第一条落在 0-3s 内的字幕（必有，视频一开始就要炸）
2. 钩子高光：3-7s 内的下一条字幕
3. 结尾高光：最后一条字幕
4. 中段高光：剩余字幕中，每 10 行选 1 行（~10% 密度），跳过已被开篇/钩子/结尾占用的行

输出：JSON 数组，每条 {start, end, text, type}
start/end 直接取该行 SRT 的时间戳——这就是动画应该维持的精确时长。

用法：
    python3 analyze_highlights.py <subtitle_corrected.srt|captions.json> <output.json>
"""
import sys

from pathlib import Path

from caption_io import parse_srt, read_json, write_json
from highlight_rules import MIDDLE_MIN_VIDEO_DURATION, has_clearance, is_highlight_worthy


def pick_highlights(segments, middle_ratio=0.10, video_duration=float('inf')):
    n = len(segments)
    used = set()
    highlights = []

    # 1. 开篇高光：第一条有效信息。开场必须出现，但不渲染无意义填充词。
    for i, seg in enumerate(segments):
        if seg['start'] < 3.0 and is_highlight_worthy(seg):
            highlights.append({**seg, 'type': 'open'})
            used.add(i)
            break

    # 2. 钩子高光：3-7s 内下一条有效信息，且必须与开篇留出呼吸空间。
    for i, seg in enumerate(segments):
        if i in used:
            continue
        if 3.0 <= seg['start'] < 7.0 and is_highlight_worthy(seg) and has_clearance(seg, highlights):
            highlights.append({**seg, 'type': 'hook'})
            used.add(i)
            break

    # 3. 结尾高光：最后一条有效信息，避免贴着前一个卡片。
    for i in range(n - 1, -1, -1):
        if i not in used and is_highlight_worthy(segments[i]) and has_clearance(segments[i], highlights):
            highlights.append({**segments[i], 'type': 'ending'})
            used.add(i)
            break

    # 4. 少于 25 秒的短片只保留开篇/钩子/结尾，避免卡片淹没画面。
    if video_duration < MIDDLE_MIN_VIDEO_DURATION:
        highlights.sort(key=lambda h: h['start'])
        return highlights

    # 中段只选有效信息；不再以碎片字幕兜底补选。
    remaining = [i for i in range(n) if i not in used]
    step = max(1, round(1 / middle_ratio))
    for idx in range(0, len(remaining), step):
        # 在候选窗口内向后找第一条非碎片行，避免选到"我""哎呀"这种
        window = remaining[idx:idx + step]
        pick = None
        for i in window:
            if is_highlight_worthy(segments[i]) and has_clearance(segments[i], highlights):
                pick = i
                break
        if pick is not None:
            highlights.append({**segments[pick], 'type': 'middle'})
            used.add(pick)

    highlights.sort(key=lambda h: h['start'])
    return highlights


def main():
    if len(sys.argv) < 3:
        print("用法: python3 analyze_highlights.py <srt路径|captions.json> <输出json路径> [中段密度=0.10] [视频时长秒]")
        sys.exit(1)

    srt_path = sys.argv[1]
    out_path = sys.argv[2]
    ratio = float(sys.argv[3]) if len(sys.argv) > 3 else 0.10
    video_duration = float(sys.argv[4]) if len(sys.argv) > 4 else float('inf')

    segments = read_json(srt_path) if Path(srt_path).suffix == '.json' else parse_srt(srt_path)
    highlights = pick_highlights(segments, ratio, video_duration)

    write_json(out_path, highlights)

    print(f"✅ 共 {len(segments)} 行字幕 → 提取 {len(highlights)} 个高光点")
    for h in highlights:
        print(f"   [{h['type']:6s}] {h['start']:.2f}s-{h['end']:.2f}s  {h['text'][:20]}")


if __name__ == '__main__':
    main()

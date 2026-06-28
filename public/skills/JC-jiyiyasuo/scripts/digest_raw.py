#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
整理盘点器 (digest_raw.py)

记忆压缩官整理前的第一步：盘点 .raw/ 里有哪些素材、hot.md 是否过期、
档案进度差多少。它不替你提炼内容（那要靠理解，是 skill 的人脑环节），
只给一份"该整理什么"的清单，让增量整理有的放矢。

设计原则：只读不改。盘点而已，整理写入由压缩官按理解来做。

用法：
  python digest_raw.py --vault <库根目录>

退出码：0 正常输出盘点 / 2 用法错误 / 3 库结构异常
"""

import argparse
import os
import re
import sys
import glob
from datetime import datetime

def md_files(d):
    if not d or not os.path.isdir(d):
        return []
    return sorted(glob.glob(os.path.join(d, "**", "*.md"), recursive=True))

def chapter_no(path):
    m = re.search(r"(\d+)", os.path.basename(path))
    return int(m.group(1)) if m else 0

def latest_chapter(vault):
    for name in ("改写稿", "作品", "剧本正文"):
        for base in (os.path.join(vault, "wiki", name), os.path.join(vault, name)):
            if os.path.isdir(base):
                nums = [chapter_no(p) for p in md_files(base)]
                nums = [n for n in nums if 0 < n < 10**8]
                if nums:
                    return max(nums)
    return 0

def hot_updated_chapter(hot_path):
    """从 hot.md 里抓'更新到第X章'。"""
    if not hot_path or not os.path.isfile(hot_path):
        return None
    text = open(hot_path, encoding="utf-8").read()
    m = re.search(r"第\s*(\d+)\s*章", text)
    return int(m.group(1)) if m else None

def find_file(vault, *names):
    for n in names:
        for cand in (os.path.join(vault, n), os.path.join(vault, "wiki", n)):
            if os.path.isfile(cand):
                return cand
    return None

def main():
    ap = argparse.ArgumentParser(description="整理盘点器（只读）")
    ap.add_argument("--vault", required=True)
    args = ap.parse_args()

    if not os.path.isdir(args.vault):
        print(f"❌ 库路径不存在：{args.vault}", file=sys.stderr)
        sys.exit(2)

    raw_dir = None
    for cand in (os.path.join(args.vault, ".raw"), os.path.join(args.vault, "raw")):
        if os.path.isdir(cand):
            raw_dir = cand
            break

    wiki_dir = os.path.join(args.vault, "wiki")
    if not raw_dir and not os.path.isdir(wiki_dir):
        print(f"⚠️  没找到 .raw/ 或 wiki/，确认这是知识库根目录？：{args.vault}", file=sys.stderr)
        sys.exit(3)

    hot = find_file(args.vault, "hot.md")
    latest = latest_chapter(args.vault)
    hot_ch = hot_updated_chapter(hot)

    print("=" * 56)
    print("整理盘点报告")
    print("=" * 56)

    # 1. 写作进度 vs hot.md
    print("\n【进度对照】")
    print(f"  最新章节：第 {latest} 章" if latest else "  最新章节：未识别到带章号的稿件")
    if hot_ch is None:
        print("  hot.md：不存在或未标更新章号 → 建议初始化/补更新标记")
    elif latest and latest > hot_ch:
        print(f"  hot.md：更新到第 {hot_ch} 章 → 落后 {latest - hot_ch} 章，需要刷新")
    elif hot_ch:
        print(f"  hot.md：更新到第 {hot_ch} 章 → 与进度同步")

    # 2. .raw/ 待整理素材
    print("\n【.raw/ 待整理素材】")
    if not raw_dir:
        print("  没有 .raw/ 目录")
    else:
        raws = [p for p in md_files(raw_dir) if not os.path.basename(p).startswith(".")]
        hot_mtime = os.path.getmtime(hot) if hot and os.path.isfile(hot) else 0
        if not raws:
            print("  .raw/ 下没有 .md 素材")
        for p in raws:
            mt = os.path.getmtime(p)
            flag = "🆕 比 hot.md 新（可能未整理）" if mt > hot_mtime else "（早于上次整理）"
            size = os.path.getsize(p)
            print(f"  - {os.path.relpath(p, args.vault)}  [{size}B] {flag}")

    # 3. wiki 档案概览
    print("\n【wiki/ 现有档案】")
    if os.path.isdir(wiki_dir):
        for sub in sorted(os.listdir(wiki_dir)):
            subp = os.path.join(wiki_dir, sub)
            if os.path.isdir(subp):
                print(f"  {sub}/ : {len(md_files(subp))} 篇")
            elif sub.endswith(".md"):
                print(f"  {sub}")
    else:
        print("  没有 wiki/ 目录")

    print("\n" + "-" * 56)
    print("下一步：压缩官按【整理规范.md】从 🆕 素材提炼结论 → 归档 wiki/ →")
    print("        织双链 → 刷新 hot.md。整理完建议跑 JC-yizhixing 巡检复查。")
    sys.exit(0)

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
换皮一致性检查器 (check_consistency.py)

临摹/换皮改写的命脉是"映射一致"。本脚本扫描一章改写稿，抓三类最常见的翻车：
  1. 漏改：范本旧专名残留在改写稿里（换皮第一大忌）
  2. 撞车：多个旧名映射到了同一个新名
  3. 不一致：同一个旧名在映射表里登记了多个新名

它不判断文风或骨架，只做机械的字符串核查——这类核查脚本比肉眼可靠得多。

用法：
  python check_consistency.py --mapping wiki/映射表.md --chapter wiki/改写稿/第3章.md
  python check_consistency.py --mapping map.md --chapter ch3.md --extra-old 灵气 剑气 客栈

映射表解析约定（对应 references/换皮映射表模板.md 的表格）：
  从 markdown 表格里读"范本名|旧名"列与"新名"列。
  脚本按表头自动识别：含"范本/旧"的列为旧名，含"新名/新"的列为新名。
  一行里用 / 、，,、空格 分隔的多个旧名变体都会被登记。
"""

import argparse
import re
import sys


def parse_mapping(path):
    """从映射表 markdown 解析 [(old_variants:list, new_name:str, lineno), ...]"""
    rows = []
    old_col = new_col = None
    with open(path, encoding="utf-8") as f:
        for lineno, line in enumerate(f, 1):
            if "|" not in line:
                continue
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            # 表头行：定位旧名列/新名列
            if any(re.search(r"范本|旧名|原作|原名|原文元素|范本元素", c) for c in cells) and \
               any(re.search(r"新名|新世界|等价", c) for c in cells):
                for i, c in enumerate(cells):
                    if old_col is None and re.search(r"范本|旧名|原作|原名|原文元素|范本元素", c):
                        old_col = i
                    if re.search(r"新名|新世界|等价", c):
                        new_col = i
                continue
            # 分隔行 |---|---|
            if set("".join(cells)) <= set("-: "):
                continue
            if old_col is None or new_col is None:
                continue
            if old_col >= len(cells) or new_col >= len(cells):
                continue
            old_raw, new_raw = cells[old_col], cells[new_col]
            # 跳过模板占位/空行
            if not old_raw or not new_raw:
                continue
            if old_raw.startswith("（") or new_raw.startswith("（"):
                continue
            olds = [o for o in re.split(r"[\/、，,\s]+", old_raw) if o and o not in ("…", "...")]
            new = new_raw.split("（")[0].strip()
            if olds and new:
                rows.append((olds, new, lineno))
    return rows


def main():
    ap = argparse.ArgumentParser(description="换皮一致性检查器")
    ap.add_argument("--mapping", required=True, help="映射表.md 路径")
    ap.add_argument("--chapter", required=True, help="本章改写稿 .md 路径")
    ap.add_argument("--extra-old", nargs="*", default=[],
                    help="额外要扫的旧世界词（如 灵气 剑气 客栈 圣旨），抓时代位移穿帮")
    args = ap.parse_args()

    rows = parse_mapping(args.mapping)
    if not rows:
        print("⚠️  没从映射表里解析到任何映射。检查表头是否含'范本/旧名'与'新名'列，"
              "且占位行（（…））已填真实内容。")
        sys.exit(2)

    with open(args.chapter, encoding="utf-8") as f:
        text = f.read()

    problems = []

    # --- 检查 2：撞车（不同范本元素 → 同一新名）---
    # 按"行"判定：同一行内 张三/三儿 是同一角色的变体，不算撞车；
    # 只有不同行映射到同一新名才是撞车。
    new_to_rows = {}
    for olds, new, _ in rows:
        new_to_rows.setdefault(new, []).append(tuple(olds))
    for new, row_list in new_to_rows.items():
        if len(row_list) > 1:
            groups = "；".join("/".join(r) for r in row_list)
            problems.append(f"🔻 撞车：新名「{new}」被多个不同范本元素共用 → {groups}（请拆成不同新名）")

    # --- 检查 3：不一致（同一旧名 → 多个新名）---
    old_to_news = {}
    for olds, new, ln in rows:
        for o in olds:
            old_to_news.setdefault(o, set()).add(new)
    for old, news in old_to_news.items():
        if len(news) > 1:
            problems.append(f"🔻 不一致：旧名「{old}」对应了多个新名 → {', '.join(sorted(news))}（全篇只能用一个）")

    # --- 检查 1：漏改（旧名残留在改写稿里）---
    leaked = []
    for olds, new, ln in rows:
        for o in olds:
            if len(o) < 1:
                continue
            cnt = text.count(o)
            if cnt > 0:
                leaked.append((o, new, cnt))
    for o, new, cnt in leaked:
        problems.append(f"❌ 漏改：改写稿里仍有范本旧名「{o}」({cnt}处)，应换成「{new}」")

    # --- 时代位移穿帮：额外旧世界词 ---
    for w in args.extra_old:
        cnt = text.count(w)
        if cnt > 0:
            problems.append(f"⚠️  穿帮疑似：改写稿出现旧世界词「{w}」({cnt}处)，确认是否该按背景位移替换")

    # --- 输出 ---
    print(f"映射条目：{len(rows)} 条  |  改写稿字数：{len(text)}")
    print("-" * 50)
    if not problems:
        print("✅ 一致性检查通过：无旧名残留、无撞车、无不一致。")
        sys.exit(0)
    print(f"发现 {len(problems)} 个问题，请修正后再交付：\n")
    for p in problems:
        print("  " + p)
    sys.exit(1)


if __name__ == "__main__":
    main()

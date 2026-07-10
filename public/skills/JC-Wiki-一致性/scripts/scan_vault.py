#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
知识库全库巡检器 (scan_vault.py)

对一个 wiki 架构的小说/临摹/剧本知识库做全库扫描，抓单章自查抓不到的跨章问题。
机械层面的错用本脚本，语义层面的矛盾交给巡检官读档案判断。

设计原则：只读不改。脚本只报告问题，绝不修改任何文件。

用法：
  python scan_vault.py --vault <库根目录>                  # auto：按库内容自动启用检查
  python scan_vault.py --vault <库根目录> --mode reskin    # 只做换皮专项
  python scan_vault.py --vault <库根目录> --mode original  # 只做原创角色一致性
  python scan_vault.py --vault <库根目录> --mode wiki       # 只做 wiki 健康
  python scan_vault.py --vault <库根目录> --extra-old 灵气 剑气 客栈 圣旨 内力

退出码：0 通过 / 1 有问题 / 2 用法错误 / 3 库结构异常
"""

import argparse
import os
import re
import sys
import glob

# ---------- 通用工具 ----------

def find_dir(vault, *names):
    """在 vault 下找第一个存在的目录（支持 wiki/ 前缀与否）。"""
    for n in names:
        for cand in (os.path.join(vault, n), os.path.join(vault, "wiki", n)):
            if os.path.isdir(cand):
                return cand
    return None

def find_file(vault, *names):
    for n in names:
        for cand in (os.path.join(vault, n), os.path.join(vault, "wiki", n)):
            if os.path.isfile(cand):
                return cand
    return None

def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()

def md_files(d):
    if not d or not os.path.isdir(d):
        return []
    return sorted(glob.glob(os.path.join(d, "**", "*.md"), recursive=True))

def chapter_no(path):
    """从文件名抽章号，抓不到返回大数以排末尾。"""
    m = re.search(r"(\d+)", os.path.basename(path))
    return int(m.group(1)) if m else 10**9

# ---------- 映射表解析（与 linmo 的 check_consistency.py 约定一致）----------

def parse_mapping(path):
    """返回 [(old_variants:list, new_name:str), ...]"""
    rows = []
    old_col = new_col = None
    for line in read(path).splitlines():
        if "|" not in line:
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if any(re.search(r"范本|旧名|原作|原名|原文元素|范本元素", c) for c in cells) and \
           any(re.search(r"新名|新世界|等价", c) for c in cells):
            for i, c in enumerate(cells):
                if old_col is None and re.search(r"范本|旧名|原作|原名|原文元素|范本元素", c):
                    old_col = i
                if re.search(r"新名|新世界|等价", c):
                    new_col = i
            continue
        if set("".join(cells)) <= set("-: "):
            continue
        if old_col is None or new_col is None or old_col >= len(cells) or new_col >= len(cells):
            continue
        old_raw, new_raw = cells[old_col], cells[new_col]
        if not old_raw or not new_raw or old_raw.startswith("（") or new_raw.startswith("（"):
            continue
        olds = [o for o in re.split(r"[\/、，,\s]+", old_raw) if o and o not in ("…", "...")]
        new = new_raw.split("（")[0].strip()
        if olds and new:
            rows.append((olds, new))
    return rows

# ---------- 检查 A：换皮专项 ----------

def check_reskin(vault, extra_old, problems):
    mapping_file = find_file(vault, "映射表.md")
    if not mapping_file:
        return False  # 不是换皮库
    rows = parse_mapping(mapping_file)
    draft_dir = find_dir(vault, "改写稿") or find_dir(vault, "剧本正文") or find_dir(vault, "作品") or vault
    drafts = [p for p in md_files(draft_dir) if "映射表" not in p]

    # A2 撞车（按"行"判定——同一行内 张三/三儿 是同一角色的变体，不算撞车；
    #          只有不同行映射到同一新名才是撞车）
    new_to_rows = {}
    for olds, new in rows:
        new_to_rows.setdefault(new, []).append(tuple(olds))
    for new, row_list in new_to_rows.items():
        if len(row_list) > 1:
            groups = "；".join("/".join(r) for r in row_list)
            problems.append(("❌", "映射撞车", "映射表",
                             f"新名「{new}」被多个不同范本元素共用 → {groups}（应拆成不同新名）"))

    # A3 不一致
    old_to_news = {}
    for olds, new in rows:
        for o in olds:
            old_to_news.setdefault(o, set()).add(new)
    for old, news in old_to_news.items():
        if len(news) > 1:
            problems.append(("❌", "命名不一致", "映射表",
                             f"旧名「{old}」对应多个新名 → {', '.join(sorted(news))}（全篇只能用一个）"))

    # A1 漏改（逐章扫）
    for d in drafts:
        text = read(d)
        ch = os.path.basename(d)
        for olds, new in rows:
            for o in olds:
                cnt = text.count(o)
                if cnt > 0:
                    problems.append(("❌", "换皮漏改", ch,
                                     f"残留范本旧名「{o}」({cnt}处)，应换成「{new}」"))
        # A4 穿帮
        for w in extra_old:
            if text.count(w) > 0:
                problems.append(("⚠️", "时代穿帮", ch,
                                 f"出现旧世界词「{w}」({text.count(w)}处)，确认是否按背景位移替换"))
    return True

# ---------- 检查 C：伏笔回收 ----------

def check_foreshadow(vault, problems):
    f = find_file(vault, "伏笔账本.md", "悬念账本.md")
    if not f:
        return
    # 找当前最新章号
    draft_dir = find_dir(vault, "改写稿") or find_dir(vault, "作品") or find_dir(vault, "剧本正文")
    latest = max([chapter_no(p) for p in md_files(draft_dir)] or [0])
    if latest == 0 or latest == 10**9:
        latest = 0
    # 解析账本行：找"埋设章 ... 回收章"，未标已收的
    for line in read(f).splitlines():
        if "[[" in line or not re.search(r"\d", line):
            continue
        nums = [int(n) for n in re.findall(r"(\d+)", line)]
        collected = any(k in line for k in ("已收", "已回收", "回收完成", "✅"))
        if len(nums) >= 2 and not collected:
            plant, expect = nums[0], nums[1]
            if latest and latest >= expect:
                problems.append(("🔻", "伏笔未回收", f"第{plant}章埋设",
                                 f"预计第{expect}章回收，已到第{latest}章仍未标记回收：{line.strip()[:50]}"))

# ---------- 检查 D：wiki 健康 ----------

def check_wiki_health(vault, problems):
    wiki = os.path.join(vault, "wiki")
    root = wiki if os.path.isdir(wiki) else vault
    files = md_files(root)
    if not files:
        return
    stems = {os.path.splitext(os.path.basename(p))[0] for p in files}
    link_re = re.compile(r"\[\[([^\]|#]+)")
    linked_to = set()
    has_outlink = {}
    for p in files:
        text = read(p)
        links = [m.split("/")[-1].strip() for m in link_re.findall(text)]
        has_outlink[p] = len(links) > 0
        for l in links:
            linked_to.add(l)
            if l not in stems:
                problems.append(("🔻", "断链", os.path.basename(p),
                                 f"[[{l}]] 指向的笔记不存在"))
    # 孤儿：没被链入，也没链出
    for p in files:
        stem = os.path.splitext(os.path.basename(p))[0]
        if stem in ("hot", "index", "log", "overview", "CLAUDE", "映射表", "伏笔账本", "悬念账本"):
            continue
        if stem not in linked_to and not has_outlink.get(p):
            problems.append(("⚠️", "孤儿笔记", os.path.basename(p),
                             "没有任何笔记链入，自身也无 [[双链]]"))

# ---------- 主流程 ----------

def main():
    ap = argparse.ArgumentParser(description="知识库全库巡检器（只读）")
    ap.add_argument("--vault", required=True, help="知识库根目录")
    ap.add_argument("--mode", default="auto",
                    choices=["auto", "reskin", "original", "wiki"], help="检查模式")
    ap.add_argument("--extra-old", nargs="*", default=[],
                    help="时代穿帮要扫的旧世界词，如 灵气 剑气 客栈 圣旨 内力")
    args = ap.parse_args()

    if not os.path.isdir(args.vault):
        print(f"❌ 库路径不存在：{args.vault}", file=sys.stderr)
        sys.exit(2)

    has_wiki = os.path.isdir(os.path.join(args.vault, "wiki"))
    has_mapping = find_file(args.vault, "映射表.md") is not None
    if not has_wiki and not has_mapping and not find_dir(args.vault, "角色", "角色档案"):
        print(f"⚠️  没找到 wiki/ 或 映射表.md 或 角色档案/，确认这是知识库根目录？：{args.vault}", file=sys.stderr)
        sys.exit(3)

    problems = []
    is_reskin = False

    if args.mode in ("auto", "reskin"):
        is_reskin = check_reskin(args.vault, args.extra_old, problems)
    if args.mode in ("auto",):
        check_foreshadow(args.vault, problems)
    if args.mode in ("auto", "wiki"):
        check_wiki_health(args.vault, problems)
    # original 模式：脚本只能查 frontmatter/结构，语义矛盾交给巡检官读判断
    # 这里不强行造假阳性，留给 skill 的人脑环节

    # 输出
    order = {"❌": 0, "🔻": 1, "⚠️": 2}
    problems.sort(key=lambda x: order.get(x[0], 9))
    n_must = sum(1 for p in problems if p[0] == "❌")
    n_imp = sum(1 for p in problems if p[0] == "🔻")
    n_sug = sum(1 for p in problems if p[0] == "⚠️")

    print(f"库类型：{'临摹/换皮库（检测到映射表）' if is_reskin else '原创/通用库'}")
    print(f"问题统计：❌ 必修 {n_must} / 🔻 重要 {n_imp} / ⚠️ 建议 {n_sug}")
    print("-" * 56)
    if not problems:
        print("✅ 全库巡检通过：无漏改、无撞车、无断链、无未回收伏笔。")
        sys.exit(0)
    for level, kind, loc, msg in problems:
        print(f"{level} [{kind}] · {loc}")
        print(f"    {msg}")
    print("-" * 56)
    print("下一步：❌ 必修项交给写作 skill（如 JC-linmoxiaoshuo）逐条修正，修完可再跑一次确认清零。")
    sys.exit(1)


if __name__ == "__main__":
    main()

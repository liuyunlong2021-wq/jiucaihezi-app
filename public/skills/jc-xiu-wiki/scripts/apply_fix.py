#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
修正执行器 (apply_fix.py)

修正官的两类活：
  1. 执行修正 —— 字符串替换（漏改/命名统一）、双链补全（断链改指/孤儿笔记补链）
  2. 架构扩展 —— 新建 wiki 分类目录 + 占位文件 + 更新 index.md

语义类问题（设定矛盾怎么改、要不要删孤儿笔记、新分类要不要吃掉旧内容）
不归这个脚本管——那要跟用户确认后手动编辑或转交 jc-raw-wiki，机械脚本
不该替用户决定内容。

设计原则：改动前默认预览，确认后加 --apply 才真正写盘；每次操作都报告
命中文件/新建路径，避免"改了但不知道改了哪"。

用法：
  # 预览：把 wiki/ 下所有文件里的「孙八」换成「钱七」
  python apply_fix.py replace --root wiki --old 孙八 --new 钱七

  # 确认后真正执行
  python apply_fix.py replace --root wiki --old 孙八 --new 钱七 --apply

  # 只改一个文件
  python apply_fix.py replace --file wiki/剧本/第12章.md --old 孙八 --new 钱七 --apply

  # 给某文件补一条双链（比如把断链目标改指到正确文件，或给孤儿笔记补出链）
  python apply_fix.py link --file wiki/角色/张三.md --add 世界观/大结局 --apply

  # 架构扩展：新建一个分类目录 + _index.md，并把条目登记进 wiki/index.md
  python apply_fix.py scaffold --wiki wiki --category 伏笔 --desc "伏笔追踪账本" --apply

退出码：0 成功（含预览）/ 1 未命中任何目标 / 2 用法错误
"""

import argparse
import glob
import os
import sys


def md_files(root):
    if os.path.isfile(root):
        return [root]
    return sorted(glob.glob(os.path.join(root, "**", "*.md"), recursive=True))


def cmd_replace(args):
    target = args.file or args.root
    if not target:
        print("❌ 需要指定 --file 或 --root", file=sys.stderr)
        sys.exit(2)
    if not os.path.exists(target):
        print(f"❌ 路径不存在：{target}", file=sys.stderr)
        sys.exit(2)

    files = md_files(target)
    total_hits = 0
    touched = []
    for p in files:
        with open(p, encoding="utf-8") as f:
            text = f.read()
        cnt = text.count(args.old)
        if cnt == 0:
            continue
        total_hits += cnt
        touched.append((p, cnt))
        if args.apply:
            new_text = text.replace(args.old, args.new)
            with open(p, "w", encoding="utf-8") as f:
                f.write(new_text)

    mode = "已执行" if args.apply else "预览（未写盘，加 --apply 才真正执行）"
    print(f"替换：「{args.old}」→「{args.new}」  模式：{mode}")
    print("-" * 56)
    if not touched:
        print("⚠️  没有任何文件命中，检查关键词或路径是否正确。")
        sys.exit(1)
    for p, cnt in touched:
        print(f"  {p}  ({cnt} 处)")
    print("-" * 56)
    print(f"命中文件 {len(touched)} 个，共 {total_hits} 处。")
    if not args.apply:
        print("这是预览，未写盘。确认无误后加 --apply 重跑。")
    sys.exit(0)


def cmd_link(args):
    if not os.path.isfile(args.file):
        print(f"❌ 文件不存在：{args.file}", file=sys.stderr)
        sys.exit(2)

    with open(args.file, encoding="utf-8") as f:
        text = f.read()

    link = f"[[{args.add}]]"
    if link in text:
        print(f"⚠️  {args.file} 已经包含 {link}，无需重复添加。")
        sys.exit(0)

    mode = "已执行" if args.apply else "预览（未写盘，加 --apply 才真正执行）"
    print(f"补链：{args.file} 追加 {link}  模式：{mode}")
    if args.apply:
        new_text = text.rstrip("\n") + f"\n\n{link}\n"
        with open(args.file, "w", encoding="utf-8") as f:
            f.write(new_text)
        print("✅ 已追加到文件末尾。")
    else:
        print("这是预览，未写盘。确认无误后加 --apply 重跑。")
    sys.exit(0)


def cmd_scaffold(args):
    wiki = args.wiki
    if not os.path.isdir(wiki):
        print(f"❌ wiki 目录不存在：{wiki}", file=sys.stderr)
        sys.exit(2)

    category_dir = os.path.join(wiki, args.category)
    index_path = os.path.join(category_dir, "_index.md")
    root_index = os.path.join(wiki, "index.md")
    mode = "已执行" if args.apply else "预览（未写盘，加 --apply 才真正执行）"

    print(f"架构扩展：新建分类「{args.category}/」  模式：{mode}")
    print("-" * 56)

    if os.path.isdir(category_dir):
        print(f"⚠️  {category_dir} 已存在，不会覆盖。如需扩充内容请直接编辑或转交 jc-raw-wiki。")
        sys.exit(1)

    print(f"  将创建：{category_dir}/")
    print(f"  将创建：{index_path}")
    if os.path.isfile(root_index):
        print(f"  将追加条目到：{root_index}")
    else:
        print(f"  ⚠️  {root_index} 不存在，跳过追加索引（建议手动补一份 index.md）")

    if args.apply:
        os.makedirs(category_dir, exist_ok=True)
        with open(index_path, "w", encoding="utf-8") as f:
            f.write(f"# {args.category}\n\n> {args.desc}\n")
        if os.path.isfile(root_index):
            with open(root_index, "a", encoding="utf-8") as f:
                f.write(f"\n- [[{args.category}/_index|{args.category}]] — {args.desc}\n")
        print("-" * 56)
        print("✅ 已创建。")
        print(f"下一步：如果这个分类需要吃掉已有内容（从别处迁移/重新归档），转交 jc-raw-wiki 处理；")
        print(f"        如果只是从现在开始记录新内容，直接开始往 {args.category}/ 里写就行。")
    else:
        print("-" * 56)
        print("这是预览，未写盘。确认无误后加 --apply 重跑。")
    sys.exit(0)


def main():
    ap = argparse.ArgumentParser(description="修正执行器：机械类问题的字符串替换、双链补全、架构扩展建目录")
    sub = ap.add_subparsers(dest="cmd", required=True)

    rp = sub.add_parser("replace", help="全文替换旧名/旧词为新名/新词")
    rp.add_argument("--root", help="替换范围目录（如 wiki/），与 --file 二选一")
    rp.add_argument("--file", help="只替换单个文件，与 --root 二选一")
    rp.add_argument("--old", required=True, help="要替换掉的旧字符串")
    rp.add_argument("--new", required=True, help="替换成的新字符串")
    rp.add_argument("--apply", action="store_true", help="真正写盘；不加则只预览")
    rp.set_defaults(func=cmd_replace)

    lp = sub.add_parser("link", help="给指定文件追加一条 [[双链]]")
    lp.add_argument("--file", required=True, help="要补链的文件")
    lp.add_argument("--add", required=True, help="要追加的链接目标（不含中括号）")
    lp.add_argument("--apply", action="store_true", help="真正写盘；不加则只预览")
    lp.set_defaults(func=cmd_link)

    sp = sub.add_parser("scaffold", help="新建 wiki 分类目录 + _index.md，登记进 index.md")
    sp.add_argument("--wiki", required=True, help="wiki 根目录路径")
    sp.add_argument("--category", required=True, help="新分类目录名（如 伏笔）")
    sp.add_argument("--desc", required=True, help="一句话说明这个分类放什么内容")
    sp.add_argument("--apply", action="store_true", help="真正写盘；不加则只预览")
    sp.set_defaults(func=cmd_scaffold)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()

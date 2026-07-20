#!/usr/bin/env python3
"""Read-only inspection and validation for Raw-to-Wiki maintenance."""

import argparse
import glob
import os
import re
import sys
from pathlib import Path


def markdown_files(directory: Path) -> list[Path]:
    return sorted(path for path in directory.rglob("*.md") if path.is_file()) if directory.is_dir() else []


def find_wiki(project: Path) -> Path | None:
    for relative in (Path("docs/wiki"), Path("wiki")):
        candidate = project / relative
        if candidate.is_dir():
            return candidate
    return None


def latest_chapter(wiki: Path) -> int:
    latest = 0
    for name in ("改写稿", "作品", "剧本正文"):
        for path in markdown_files(wiki / name):
            match = re.search(r"(\d+)", path.name)
            if match:
                latest = max(latest, int(match.group(1)))
    return latest


def hot_updated_chapter(path: Path) -> int | None:
    if not path.is_file():
        return None
    match = re.search(r"第\s*(\d+)\s*章", path.read_text(encoding="utf-8"))
    return int(match.group(1)) if match else None


def raw_files(project: Path) -> list[Path]:
    raw = project / ".raw"
    if not raw.is_dir():
        return []
    patterns = ("*.jsonl", "*.md", "*.txt")
    return sorted({path for pattern in patterns for path in raw.rglob(pattern) if path.is_file()})


def inspect(project: Path) -> int:
    wiki = find_wiki(project)
    raw = project / ".raw"
    if not wiki and not raw.is_dir():
        print(f"未找到 Wiki 或 .raw：{project}", file=sys.stderr)
        return 3

    print("Raw -> Wiki 盘点报告")
    print(f"项目：{project}")
    print(f"Wiki：{wiki.relative_to(project) if wiki else '未建立'}")
    print(f"Raw：{raw.relative_to(project) if raw.is_dir() else '未建立'}")

    if wiki:
        hot = wiki / "hot.md"
        latest = latest_chapter(wiki)
        updated = hot_updated_chapter(hot)
        print("\n[热缓存]")
        print(f"hot.md：{'存在' if hot.is_file() else '缺失'}")
        if latest:
            print(f"最新章节：第 {latest} 章")
            print(f"hot 更新章节：{f'第 {updated} 章' if updated else '未识别'}")
        print(f"来源索引.md：{'存在' if (wiki / '来源索引.md').is_file() else '缺失'}")

    print("\n[原始证据]")
    files = raw_files(project)
    if not files:
        print("没有发现 .raw 下的 .jsonl/.md/.txt 文件")
    for path in files:
        print(f"- {path.relative_to(project)} [原始材料]")

    return 0


def validate(project: Path) -> int:
    wiki = find_wiki(project)
    if not wiki:
        print("验证失败：未找到 docs/wiki/ 或 wiki/", file=sys.stderr)
        return 3

    missing = [name for name in ("hot.md", "log.md", "来源索引.md") if not (wiki / name).is_file()]
    if missing:
        print(f"验证失败：{wiki.relative_to(project)} 缺少 {', '.join(missing)}", file=sys.stderr)
        return 3

    print(f"验证通过：{wiki.relative_to(project)} 的 hot.md、log.md、来源索引.md 均存在")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Raw -> Wiki 盘点与验证（只读）")
    parser.add_argument("command", nargs="?", choices=("inspect", "validate"), default="inspect")
    parser.add_argument("--project", "--vault", dest="project", required=True, help="项目根目录")
    args = parser.parse_args()

    project = Path(args.project).expanduser().resolve()
    if not project.is_dir():
        print(f"路径不存在：{project}", file=sys.stderr)
        return 2
    return inspect(project) if args.command == "inspect" else validate(project)


if __name__ == "__main__":
    raise SystemExit(main())

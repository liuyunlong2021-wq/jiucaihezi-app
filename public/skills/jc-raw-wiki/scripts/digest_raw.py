#!/usr/bin/env python3
"""Read-only inspection and validation for Raw-to-Wiki maintenance."""

import argparse
import hashlib
import re
import subprocess
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


def short_fingerprint(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:12]


def git_status(project: Path) -> str | None:
    result = subprocess.run(
        ["git", "status", "--short"],
        cwd=project,
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout if result.returncode == 0 else None


def git_diff(project: Path) -> str | None:
    result = subprocess.run(
        ["git", "diff", "--no-ext-diff", "--binary", "HEAD"],
        cwd=project,
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout if result.returncode == 0 else None


def closeout(project: Path, evidence_files: list[str]) -> int:
    wiki = find_wiki(project)
    if not wiki:
        print("收尾失败：未找到 docs/wiki/ 或 wiki/", file=sys.stderr)
        return 3

    status = git_status(project)
    diff = git_diff(project)
    evidence = [Path(item).expanduser().resolve() for item in evidence_files]
    missing = [path for path in evidence if not path.is_file()]
    if missing:
        print(f"证据文件不存在：{missing[0]}", file=sys.stderr)
        return 2

    changed = [line for line in (status or "").splitlines() if line.strip()]
    print("开发阶段收尾编译预览（只读，不写 Wiki）")
    print("[写入预览]")
    print("- 开发结论：根据变更落入现有 开发/、架构/、运维/、排障/ 或 学习/ 页面")
    print("- 来源导航：重要结论登记 来源索引.md")
    print("- 当前状态：仅在状态真实变化时更新 hot.md，并向 log.md 追加事实")
    print(f"- Git 变更：{len(changed)} 项" if status is not None else "- Git 变更：不是 Git 仓库或无法读取")

    evidence_text = "\n".join(
        f"{path.name}\n{path.read_text(encoding='utf-8', errors='replace')}"
        for path in evidence
    ).lower()
    has_test = any(word in evidence_text for word in ("pnpm run test", "test result", "tests passed", "测试"))
    has_build = any(word in evidence_text for word in ("pnpm run build", "vite build", "构建"))
    print("[证据状态]")
    print(f"- Git：{'可用' if status is not None else '缺失'}")
    print(f"- 测试：{'已提供' if has_test else '缺失，不得写成已通过'}")
    print(f"- 构建：{'已提供' if has_build else '缺失，不得写成已通过'}")
    for path in evidence:
        print(f"- 证据文件：{path.name}")

    print("[来源指纹]")
    if status is not None:
        print(f"- git-status sha256:{short_fingerprint(status.encode('utf-8'))}")
    if diff is not None:
        print(f"- git-diff sha256:{short_fingerprint(diff.encode('utf-8'))}")
    for path in evidence:
        print(f"- {path.name} sha256:{short_fingerprint(path.read_bytes())}")

    print("[未验证项]")
    if not evidence:
        print("- 未提供测试或构建证据；本预览只证明文件现状，不证明功能通过。")
    else:
        print("- 证据指纹只证明所读文件未变，不替代模型对输出内容和平台覆盖面的判断。")
    return 0


def entry_links(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    text = re.sub(r"```.*?```|~~~.*?~~~|`[^`\n]*`|<!--.*?-->", "", text, flags=re.DOTALL)
    return [match.strip() for match in re.findall(r"\[\[([^\]|#]+)", text)]


def link_exists(wiki: Path, target: str) -> bool:
    normalized = target.removesuffix(".md")
    if (wiki / f"{normalized}.md").is_file():
        return True
    name = normalized.split("/")[-1]
    return any(path.stem == name for path in markdown_files(wiki))


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

    broken = []
    for name in ("hot.md", "来源索引.md"):
        path = wiki / name
        for target in entry_links(path):
            if not link_exists(wiki, target):
                broken.append((name, target))
    if broken:
        print("验证失败：稳定入口存在断链", file=sys.stderr)
        for name, target in broken:
            print(f"- {name}: [[{target}]]", file=sys.stderr)
        return 3

    print(f"验证通过：{wiki.relative_to(project)} 的稳定入口存在且链接可达")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Raw -> Wiki 盘点与验证（只读）")
    parser.add_argument("command", nargs="?", choices=("inspect", "validate", "closeout"), default="inspect")
    parser.add_argument("--project", "--vault", dest="project", required=True, help="项目根目录")
    parser.add_argument("--evidence-file", action="append", default=[], help="测试或构建输出文件，可重复")
    args = parser.parse_args()

    project = Path(args.project).expanduser().resolve()
    if not project.is_dir():
        print(f"路径不存在：{project}", file=sys.stderr)
        return 2
    if args.command == "inspect":
        return inspect(project)
    if args.command == "validate":
        return validate(project)
    return closeout(project, args.evidence_file)


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Wiki 查询工具 —— 搜索/状态/关系图

用法:
  python wiki_query.py search <wiki_dir> <keyword>    # 搜索 wiki
  python wiki_query.py status <wiki_dir>               # 统计状态
  python wiki_query.py graph <wiki_dir>                # 生成 .canvas
"""

import json
import re
import sys
from pathlib import Path


def search(wiki: Path, keyword: str) -> None:
    """grep wiki 目录，返回匹配文件及行号."""
    for md in sorted(wiki.rglob("*.md")):
        if md.name in ("index.md", "log.md", "hot.md"):
            continue
        for i, line in enumerate(md.read_text(encoding="utf-8").splitlines(), 1):
            if keyword.lower() in line.lower():
                rel = md.relative_to(wiki)
                print(f"{rel}:{i}: {line.strip()[:120]}")


def status_cmd(wiki: Path) -> None:
    """统计 wiki 状态。自动识别 wiki 类型。"""
    # 检测类型
    is_dev = (wiki / "🧩 功能清单").exists() or (wiki / "📋 项目总览").exists()
    is_novel = (wiki / "剧情").exists() or (wiki / "角色").exists()

    if is_dev:
        _status_dev(wiki)
    elif is_novel:
        _status_novel(wiki)
    else:
        _status_generic(wiki)


def _status_dev(wiki: Path) -> None:
    """开发项目状态."""
    total = len(list(wiki.rglob("*.md")))
    log = wiki / "log.md"
    last_op = "无记录"
    if log.exists():
        lines = log.read_text(encoding="utf-8").strip().split("\n")
        for line in reversed(lines):
            if line.startswith("## ["):
                last_op = line.lstrip("# ")
                break
    logs = len(list((wiki / "📝 开发日志").rglob("*.md"))) if (wiki / "📝 开发日志").exists() else 0
    notes = len(list((wiki / "📖 学习笔记").rglob("*.md"))) if (wiki / "📖 学习笔记").exists() else 0
    features = len(list((wiki / "🧩 功能清单").rglob("*.md"))) if (wiki / "🧩 功能清单").exists() else 0
    print(f"📊 类型：开发项目")
    print(f"文件总数：{total}")
    print(f"功能清单：{features} 条")
    print(f"开发日志：{logs} 篇")
    print(f"学习笔记：{notes} 篇")
    print(f"上次操作：{last_op}")


def _status_generic(wiki: Path) -> None:
    total = len(list(wiki.rglob("*.md")))
    print(f"📊 类型：通用 Wiki")
    print(f"文件总数：{total}")


def _status_novel(wiki: Path) -> None:
    # 大纲
    dagang = wiki / "剧情/大纲.md"
    if not dagang.exists():
        dagang = wiki / "剧本/大纲.md"
    dagang_ok = dagang.exists()

    # 壳统计
    shells = []
    for md in wiki.rglob("*.md"):
        text = md.read_text(encoding="utf-8")
        if "> 待摄入" in text:
            shells.append(str(md.relative_to(wiki)))

    # 角色总数
    role_dir = wiki / "角色"
    total_roles = len(list(role_dir.rglob("*.md"))) if role_dir.exists() else 0

    # log 最后一条
    log = wiki / "log.md"
    last_op = "无记录"
    if log.exists():
        lines = log.read_text(encoding="utf-8").strip().split("\n")
        for line in reversed(lines):
            if line.startswith("## ["):
                last_op = line.lstrip("# ")
                break

    print(f"大纲: {'✅' if dagang_ok else '❌ 暂无'}")
    print(f"角色: {total_roles - len(shells)}/{total_roles} 已填充" if total_roles else "角色: 无")
    print(f"待摄入壳: {len(shells)}")
    if shells:
        for s in shells[:10]:
            print(f"  - {s}")
        if len(shells) > 10:
            print(f"  ... 共 {len(shells)} 个")
    print(f"上次操作: {last_op}")


def graph(wiki: Path) -> None:
    """从 wiki 双链生成 .canvas 文件."""
    links = {}  # source -> [targets]
    nodes = {}  # node_id -> label

    for md in sorted(wiki.rglob("*.md")):
        if md.name in ("index.md", "log.md", "hot.md", "_index.md"):
            continue
        text = md.read_text(encoding="utf-8")
        rel = str(md.relative_to(wiki)).replace(".md", "")
        node_id = rel.replace("/", "_")

        targets = re.findall(r"\[\[([^\]|#]+)", text)
        if targets:
            links[node_id] = list(set(targets))
        nodes[node_id] = rel.split("/")[-1] if "/" in rel else rel

    # 构建 canvas JSON
    canvas = {"nodes": [], "edges": []}
    pos = {}
    for i, (nid, label) in enumerate(sorted(nodes.items())):
        x = (i % 5) * 300 + 50
        y = (i // 5) * 150 + 50
        pos[nid] = (x, y)
        canvas["nodes"].append({
            "id": nid, "type": "text", "x": x, "y": y,
            "width": 250, "height": 60, "text": f"**{label}**"
        })

    for src, targets in links.items():
        if src not in pos:
            continue
        for tgt in targets:
            tgt_id = tgt.replace("/", "_")
            # 精确匹配 or 模糊匹配（链接名可能是简写）
            if tgt_id not in pos:
                for nid in pos:
                    if nid.endswith(f"_{tgt}") or nid == tgt:
                        tgt_id = nid
                        break
            if tgt_id in pos:
                canvas["edges"].append({
                    "id": f"{src}_to_{tgt_id}",
                    "fromNode": src, "toNode": tgt_id
                })

    out = wiki / "关系图.canvas"
    out.write_text(json.dumps(canvas, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✅ {out}")
    print(f"   节点: {len(canvas['nodes'])}，边: {len(canvas['edges'])}")


def resolve_wiki(path: Path) -> Path:
    """Accept a Wiki root or a project root with docs/wiki or wiki."""
    if path.is_dir() and path.name == "wiki":
        return path
    for candidate in (path / "docs" / "wiki", path / "wiki"):
        if candidate.is_dir():
            return candidate
    return path


def main() -> None:
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    cmd, wiki_dir = sys.argv[1], Path(sys.argv[2])
    wiki = resolve_wiki(wiki_dir)
    if not wiki.is_dir():
        print(f"Wiki 目录不存在：{wiki}", file=sys.stderr)
        sys.exit(2)

    if cmd == "search" and len(sys.argv) >= 4:
        search(wiki, sys.argv[3])
    elif cmd == "status":
        status_cmd(wiki)
    elif cmd == "graph":
        graph(wiki)
    else:
        print(__doc__)


if __name__ == "__main__":
    main()

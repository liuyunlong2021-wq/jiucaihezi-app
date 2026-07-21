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


def page_priority(relative: Path) -> int:
    if relative.name in ("hot.md", "CLAUDE.md"):
        return 100
    return {
        "架构": 80,
        "开发": 70,
        "运维": 60,
        "排障": 50,
        "学习": 40,
        "巡检报告": 30,
        "归档": 0,
    }.get(relative.parts[0], 20)


def search(wiki: Path, keyword: str, scope: str = "active", limit: int = 20) -> None:
    """按现行优先级返回匹配证据，默认排除归档与流水日志。"""
    results = []
    for md in sorted(wiki.rglob("*.md")):
        relative = md.relative_to(wiki)
        if md.name in ("index.md", "log.md"):
            continue
        if scope == "active" and relative.parts[0] == "归档":
            continue
        matches = []
        for i, line in enumerate(md.read_text(encoding="utf-8").splitlines(), 1):
            if keyword.lower() in line.lower():
                matches.append((i, line.strip()[:120]))
        if matches:
            title_bonus = 50 if keyword.lower() in md.stem.lower() else 0
            results.append((page_priority(relative) + title_bonus + len(matches), relative, matches))

    print(f"查询：{keyword}")
    print(f"范围：{'现行知识（默认排除 归档/ 与 log.md）' if scope == 'active' else '全部知识（包含归档）'}")
    print("[证据候选]")
    if not results:
        print("未找到匹配内容。")
        return
    shown = 0
    for _, relative, matches in sorted(results, key=lambda item: (-item[0], str(item[1]))):
        for line_no, line in matches[:3]:
            print(f"{relative}:{line_no}: {line}")
            shown += 1
            if shown >= limit:
                break
        if shown >= limit:
            break
    remaining = sum(len(item[2]) for item in results) - shown
    if remaining > 0:
        print(f"... 其余 {remaining} 条未展示，可用 --limit 调整。")


def status_cmd(wiki: Path) -> None:
    """统计 wiki 状态。自动识别 wiki 类型。"""
    # 检测类型
    is_dev = any((wiki / name).exists() for name in ("架构", "开发", "运维", "排障"))
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
        for line in lines:
            if line.startswith("## ["):
                last_op = line.lstrip("# ")
                break
    print(f"📊 类型：开发项目")
    print(f"文件总数：{total}")
    for name in ("架构", "开发", "运维", "排障", "学习", "巡检报告", "归档"):
        directory = wiki / name
        if directory.exists():
            print(f"{name}：{len(list(directory.rglob('*.md')))} 篇")
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
        for line in lines:
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
        scope = "active"
        limit = 20
        extra = sys.argv[4:]
        if "--scope" in extra:
            index = extra.index("--scope")
            if index + 1 >= len(extra) or extra[index + 1] not in ("active", "all"):
                print("--scope 仅支持 active 或 all", file=sys.stderr)
                sys.exit(2)
            scope = extra[index + 1]
        if "--limit" in extra:
            index = extra.index("--limit")
            if index + 1 >= len(extra) or not extra[index + 1].isdigit():
                print("--limit 必须是正整数", file=sys.stderr)
                sys.exit(2)
            limit = max(1, int(extra[index + 1]))
        search(wiki, sys.argv[3], scope=scope, limit=limit)
    elif cmd == "status":
        status_cmd(wiki)
    elif cmd == "graph":
        graph(wiki)
    else:
        print(__doc__)


if __name__ == "__main__":
    main()

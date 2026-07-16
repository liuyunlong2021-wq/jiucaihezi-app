#!/usr/bin/env python3
"""Everything 转 Wiki —— 建目录 / 检测 Wiki / 写入索引

用法:
  python everything_to_wiki.py is-wiki <目录>          # 检测是否已是 Wiki
  python everything_to_wiki.py scaffold <类型> <目录>   # 按类型建 wiki 目录结构
  python everything_to_wiki.py types                    # 列出支持的类型

支持的类型: manju, novel, short_story, dialogue, dev_project
"""

import sys
from pathlib import Path
from typing import Optional

# ── 类型 → 目录结构 ──────────────────────────────────────────

STRUCTURES = {
    "manju": {  # 漫剧/短剧
        "角色": [],
        "世界": ["世界观.md", "调性.md"],
        "剧本": ["大纲.md"],
        "场景": [],
        "道具": [],
    },
    "novel": {  # 小说
        "角色": [],
        "世界": ["世界观.md", "设定集.md"],
        "剧情": ["大纲.md", "细纲.md"],
        "伏笔": ["伏笔管理.md"],
    },
    "short_story": {  # 短故事
        "角色": [],
        "世界": ["世界观.md", "文风.md"],
        "剧情": ["核心梗.md", "大纲.md", "正文.md"],
        "参考": [],
    },
    "dialogue": {  # 对话记录
        "对话记录": [],
    },
    "dev_project": {  # 开发项目
        "项目总览": ["开发目标.md"],
        "功能清单": [],
        "开发日志": [],
        "AI对话精华": [],
        "GitHub": ["仓库信息.md", "同步记录.md"],
        "学习笔记": [],
    },
}

INDEX_HEADER = "# 全库目录\n\n"

HOT_MD = """# 记忆小抄

> JC-Wiki-记忆压缩 维护。续写前第一个读的文件。

## 当前进度

## 主要角色状态

## 最近事件

## 活跃悬念

## 下一场钩子
"""


def is_wiki(dir_path: Path) -> bool:
    """检测目录是否已是 Wiki 结构."""
    wiki = dir_path / "wiki" if dir_path.name != "wiki" else dir_path
    if not wiki.exists() or not wiki.is_dir():
        return False

    subdirs = [d for d in wiki.iterdir() if d.is_dir()]
    if len(subdirs) < 2:
        return False

    md_files = list(wiki.rglob("*.md"))
    has_wikilink = False
    for f in md_files[:10]:  # 抽样前 10 个
        try:
            text = f.read_text(encoding="utf-8")
            if "[[" in text or "---" in text:
                has_wikilink = True
                break
        except Exception:
            continue

    return has_wikilink


def scaffold(content_type: str, root: Path) -> None:
    """按类型标准建 wiki 目录结构."""
    structure = STRUCTURES.get(content_type)
    if structure is None:
        print(f"未知类型: {content_type}")
        print(f"支持的类型: {', '.join(STRUCTURES.keys())}")
        sys.exit(1)

    wiki = root / "wiki" if root.name != "wiki" else root
    wiki.mkdir(parents=True, exist_ok=True)

    for folder, files in structure.items():
        (wiki / folder).mkdir(parents=True, exist_ok=True)
        # _index.md
        index_path = wiki / folder / "_index.md"
        if not index_path.exists():
            index_path.write_text(f"# {folder}\n\n", encoding="utf-8")
        # 预置文件
        for f in files:
            fpath = wiki / folder / f
            if not fpath.exists():
                fpath.write_text(f"# {f.replace('.md', '')}\n\n", encoding="utf-8")

    # index.md
    index_md = wiki / "index.md"
    index_md.write_text(INDEX_HEADER, encoding="utf-8")

    # 方向.md
    purpose = wiki / "方向.md"
    if not purpose.exists():
        purpose.write_text(PURPOSE_MD, encoding="utf-8")

    # log.md
    log = wiki / "log.md"
    if not log.exists():
        log.write_text(LOG_MD, encoding="utf-8")

    # hot.md
    hot = wiki / "hot.md"
    if not hot.exists():
        hot.write_text(HOT_MD, encoding="utf-8")

    # .raw/ 目录
    for raw_dir in ["对话记录", "参考资料", "设计稿"]:
        (root / "raw" / raw_dir).mkdir(parents=True, exist_ok=True)

    print(f"✅ 已创建 {content_type} Wiki 结构: {wiki}")
    for folder in structure:
        print(f"   {folder}/")


def list_types() -> None:
    """列出支持的类型."""
    print("支持的类型:")
    for t, s in STRUCTURES.items():
        folders = ", ".join(s.keys())
        print(f"  {t:15s} → {folders}")


LOG_MD = "# Wiki Log\n\n"

PURPOSE_MD = """# 研究方向

- 来源：外部导入
- 待摄入时细化
"""

SHELL_MARKER = "> 待摄入"


def validate_shells(root: Path) -> int:
    """检查 wiki/ 下壳文件格式是否统一。返回不合规数量."""
    wiki = root / "wiki" if root.name != "wiki" else root
    issues = 0

    for md_file in wiki.rglob("*.md"):
        text = md_file.read_text(encoding="utf-8")
        # 壳文件必须有标注
        if text.strip().startswith("#") and len(text.strip().split("\n")) <= 3:
            if SHELL_MARKER not in text:
                print(f"  ⚠ {md_file.relative_to(wiki)}: 疑似壳文件但缺少标准标注")
                issues += 1

    if issues == 0:
        print(f"✅ 壳文件格式统一: {wiki}")
    else:
        print(f"⚠ {issues} 个文件格式不统一")
    return issues


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "types":
        list_types()
    elif cmd == "is-wiki" and len(sys.argv) >= 3:
        result = is_wiki(Path(sys.argv[2]))
        print("true" if result else "false")
        sys.exit(0 if result else 1)
    elif cmd == "scaffold" and len(sys.argv) >= 4:
        scaffold(sys.argv[2], Path(sys.argv[3]))
    elif cmd == "validate" and len(sys.argv) >= 3:
        issues = validate_shells(Path(sys.argv[2]))
        sys.exit(min(issues, 1))
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()

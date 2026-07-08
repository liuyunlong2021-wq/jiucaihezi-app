#!/usr/bin/env python3
"""一键创建短剧项目 Wiki 目录结构

用法: python scaffold_wiki.py <项目根目录>
"""

import sys
from pathlib import Path


WIKI_STRUCTURE = {
    "剧本": [],
    "角色": [],
    "场景": [],
    "道具": [],
    "世界": ["设定.md", "关系.md"],
    "剧情": ["悬念.md", "时间线.md", "大纲.md"],
}

HOT_MD = """# 记忆小抄

> JC-jiyiyasuo 维护。续写前第一个读的文件。

## 当前进度

## 主要角色状态

## 最近事件

## 活跃悬念

## 下一场钩子
"""

INDEX_MD = """# 全库目录

> JC-jiyiyasuo 维护。全库条目一览。

## 剧本

## 角色

## 场景

## 道具

## 世界

## 剧情
"""

CLAUDE_BLOCK = """## [创作] JC-duanju-shijiemoxing
- 最新: 待开始
- 主角: 待定
- 配角: 待定
- 世界: [[wiki/世界/设定]] [[wiki/世界/关系]]
- 悬念: [[wiki/剧情/悬念]]（已埋0, 待收0）
"""


def scaffold(root: Path) -> None:
    wiki = root / "wiki"
    wiki.mkdir(parents=True, exist_ok=True)

    for folder, files in WIKI_STRUCTURE.items():
        (wiki / folder).mkdir(parents=True, exist_ok=True)
        for f in files:
            (wiki / folder / f).touch()

    (wiki / "hot.md").write_text(HOT_MD, encoding="utf-8")
    (wiki / "index.md").write_text(INDEX_MD, encoding="utf-8")
    (wiki / "巡检报告").mkdir(parents=True, exist_ok=True)

    claude = root / "CLAUDE.md"
    if not claude.exists():
        claude.write_text(CLAUDE_BLOCK, encoding="utf-8")

    (root / ".raw" / "参考资料").mkdir(parents=True, exist_ok=True)
    (root / ".raw" / "对话记录").mkdir(parents=True, exist_ok=True)
    (root / ".raw" / "灵感笔记").mkdir(parents=True, exist_ok=True)

    print(f"✅ 已创建 Wiki 骨架: {wiki}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python scaffold_wiki.py <项目根目录>")
        sys.exit(1)
    scaffold(Path(sys.argv[1]))

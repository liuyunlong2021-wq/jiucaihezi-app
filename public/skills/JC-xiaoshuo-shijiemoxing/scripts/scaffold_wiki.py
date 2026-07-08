#!/usr/bin/env python3
"""一键创建小说项目 Wiki 目录结构

用法: python scaffold_wiki.py <项目根目录>
"""

import sys
from pathlib import Path


WIKI_STRUCTURE = {
    "剧本": [],
    "角色": [],
    "世界": ["设定.md", "关系.md"],
    "剧情": ["悬念.md", "时间线.md", "大纲.md", "章纲.md", "核心梗.md", "市场分析.md"],
    "文案包装": [],
}

HOT_MD = """# 记忆小抄

> JC-jiyiyasuo 维护。续写前第一个读的文件。

## 当前进度

## 主要角色状态

## 最近事件

## 活跃伏笔

## 下一章钩子
"""

INDEX_MD = """# 全库目录

> JC-jiyiyasuo 维护。全库条目一览。

## 剧本

## 角色

## 世界

## 剧情
"""

CLAUDE_BLOCK = """## [创作] JC-xiaoshuo-shijiemoxing
- 当前: 阶段1 灵感策划
- 核心梗: 待定
- 主角: 待定
- 世界: 待定
- 悬念: 待定
"""


def scaffold(root: Path) -> None:
    wiki = root / "wiki"
    wiki.mkdir(parents=True, exist_ok=True)

    for folder, files in WIKI_STRUCTURE.items():
        (wiki / folder).mkdir(parents=True, exist_ok=True)
        for f in files:
            (wiki / folder / f).touch()

    # 种子文件
    (wiki / "hot.md").write_text(HOT_MD, encoding="utf-8")
    (wiki / "index.md").write_text(INDEX_MD, encoding="utf-8")

    # CLAUDE.md 初始区块
    claude = root / "CLAUDE.md"
    if not claude.exists():
        claude.write_text(CLAUDE_BLOCK, encoding="utf-8")

    # 原始素材
    (root / ".raw" / "参考资料").mkdir(parents=True, exist_ok=True)
    (root / ".raw" / "对话记录").mkdir(parents=True, exist_ok=True)
    (root / ".raw" / "灵感笔记").mkdir(parents=True, exist_ok=True)

    print(f"✅ 已创建 Wiki 骨架: {wiki}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python scaffold_wiki.py <项目根目录>")
        sys.exit(1)
    scaffold(Path(sys.argv[1]))

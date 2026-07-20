#!/usr/bin/env python3
"""Create, inspect, and complete Wiki structures with source indexes.

Usage:
  python everything_to_wiki.py inspect <project-root>
  python everything_to_wiki.py is-wiki <project-root>
  python everything_to_wiki.py scaffold <type> <project-root>
  python everything_to_wiki.py locate-vscode <project-root>
  python everything_to_wiki.py validate <project-root> [type]
  python everything_to_wiki.py types
"""

import json
import os
import sys
from pathlib import Path
from typing import Optional
from urllib.parse import unquote, urlparse


NOVEL_STRUCTURE = {
    "作品": [],
    "作品/正文": [],
    "作品/正文/卷": [],
    "作品/大纲": ["核心梗.md", "总纲.md"],
    "作品/大纲/卷纲": [],
    "作品/大纲/章纲": [],
    "作品/文案包装": ["书名与卖点.md", "简介与标签.md"],
    "作品/文案包装/宣传文案": [],
    "角色": ["关系网.md", "状态追踪.md"],
    "世界": [],
    "世界/设定": ["世界观.md", "历史与时代.md"],
    "世界/规则": [],
    "世界/势力": [],
    "世界/地点": [],
    "世界/关系": [],
    "剧情": ["冲突与目标.md", "主题与表达.md", "时间线.md"],
    "剧情/主线": [],
    "剧情/支线": [],
    "场景": [],
    "道具": [],
    "伏笔": ["伏笔管理.md"],
}

MANJU_STRUCTURE = {
    "作品": [],
    "作品/正文": [],
    "作品/大纲": ["核心梗.md", "总纲.md"],
    "作品/大纲/集纲": [],
    "作品/文案包装": ["书名与卖点.md", "简介与标签.md"],
    "作品/文案包装/宣传文案": [],
    "角色": ["关系网.md", "状态追踪.md"],
    "世界": [],
    "世界/设定": ["世界观.md", "历史与时代.md"],
    "世界/规则": [],
    "世界/势力": [],
    "世界/地点": [],
    "世界/关系": [],
    "剧情": ["冲突与目标.md", "主题与表达.md", "时间线.md"],
    "剧情/主线": [],
    "剧情/支线": [],
    "场景": [],
    "道具": [],
    "伏笔": ["伏笔管理.md"],
}

SHORT_STORY_STRUCTURE = {
    "作品": [],
    "作品/正文": [],
    "作品/大纲": [],
    "作品/改稿": [],
    "作品/文案包装": [],
    "角色": ["关系网.md"],
    "世界": [],
    "世界/设定": [],
    "世界/地点": [],
    "剧情": ["时间线.md"],
    "场景": [],
    "道具": [],
    "伏笔": ["伏笔管理.md"],
}

FILM_STRUCTURE = {
    "作品": [],
    "作品/正文": [],
    "作品/正文/卷": [],
    "作品/大纲": ["核心梗.md", "总纲.md"],
    "作品/大纲/卷纲": [],
    "作品/大纲/场纲": [],
    "作品/文案包装": [],
    "角色": ["关系网.md", "状态追踪.md"],
    "世界": [],
    "世界/设定": ["世界观.md"],
    "世界/地点": [],
    "剧情": ["时间线.md"],
    "剧情/主线": [],
    "剧情/支线": [],
    "场景": [],
    "道具": [],
    "伏笔": ["伏笔管理.md"],
}

TV_SERIES_STRUCTURE = {
    "作品": [],
    "作品/正文": [],
    "作品/大纲": ["核心梗.md", "总纲.md"],
    "作品/大纲/集纲": [],
    "作品/文案包装": [],
    "角色": ["关系网.md", "状态追踪.md"],
    "世界": [],
    "世界/设定": ["世界观.md"],
    "世界/规则": [],
    "世界/势力": [],
    "世界/地点": [],
    "剧情": ["时间线.md"],
    "剧情/主线": [],
    "剧情/支线": [],
    "场景": [],
    "道具": [],
    "伏笔": ["伏笔管理.md"],
}

ADVERTISEMENT_STRUCTURE = {
    "品牌": [],
    "产品": [],
    "受众": [],
    "创意": [],
    "脚本": [],
    "分镜": [],
    "场景": [],
    "道具": [],
}

STRUCTURES = {
    "novel": NOVEL_STRUCTURE,
    "manju": MANJU_STRUCTURE,
    "short_story": SHORT_STORY_STRUCTURE,
    "film": FILM_STRUCTURE,
    "tv_series": TV_SERIES_STRUCTURE,
    "advertisement": ADVERTISEMENT_STRUCTURE,
    "generic": {"资料": [], "主题": [], "参考": []},
    "dev_project": {
        "开发": [],
        "架构": [],
        "巡检报告": [],
        "运维": [],
        "排障": [],
        "学习": [],
        "归档": [],
    },
}

INDEX_HEADER = "# 全库目录\n\n"
LOG_MD = "# Wiki Log\n\n"
PURPOSE_MD = "# 知识库说明\n\n- 来源：用户指定内容\n- 范围：待补充\n"
HOT_MD = "# 热缓存\n\n> 当前最需要优先读取的结论与入口。\n"
DEV_CLAUDE_MD = """# 项目 Wiki\n\n> 项目架构、SDD、排障与历史的总入口。\n\n## 索引\n\n- [[开发]]\n- [[架构]]\n- [[巡检报告]]\n- [[hot]]\n"""
SOURCE_INDEX_MD = """# 来源索引\n\n> Wiki 保存结论与导航；原始记录保留在原位置，不复制。\n\n## 原始记录位置\n\n| 来源 | 位置 | 读取规则 |\n|---|---|---|\n| Studio 创模式 | `.raw/sessions/jcses_<会话ID>.jsonl` | 当前项目内直接读取 |\n| Studio 文/武模式 | OpenCode 项目会话 `ses_<会话ID>` | 按 `projectDir` 查询 OpenCode 会话数据库 |\n| VS Code Chat | 当前项目对应工作区的 `chatSessions/<会话ID>.jsonl` | 用 `locate-vscode` 按项目路径定位后只读 |\n| 外部原文/文件 | 用户提供的原始路径 | 不复制，记录原路径 |\n\n## Wiki 文档与原始记录对应表\n\n| Wiki 文档 | 原始记录 | 说明 |\n|---|---|---|\n| 待补充 | 待补充 | 填写 `jcses_*`、`ses_*`、VS Code 路径或原始文件路径 |\n"""
def existing_wiki(root: Path) -> Optional[Path]:
    """Return an existing Wiki path without requiring a finished schema."""
    root = root.resolve()
    candidates = []
    if root.name == "wiki":
        candidates.append(root)
    candidates.extend([root / "docs" / "wiki", root / "wiki"])
    for candidate in candidates:
        if candidate.is_dir():
            return candidate
    return None


def wiki_path(content_type: str, root: Path) -> Path:
    """Use an existing Wiki when present; development projects default to docs/wiki."""
    found = existing_wiki(root)
    if found is not None:
        return found
    if content_type == "dev_project":
        return root / "docs" / "wiki"
    return root / "wiki"


def raw_path(root: Path) -> Path:
    """Use the hidden raw store, falling back to a legacy raw directory."""
    root = root.resolve()
    hidden_raw = root / ".raw"
    legacy_raw = root / "raw"
    if hidden_raw.is_dir():
        return hidden_raw
    if legacy_raw.is_dir():
        return legacy_raw
    return hidden_raw


def ensure_raw_structure(root: Path, content_type: str) -> Path:
    raw = raw_path(root)
    (raw / "sessions").mkdir(parents=True, exist_ok=True)
    if content_type in {"novel", "manju", "short_story", "film", "tv_series", "advertisement"}:
        (raw / "参考资料").mkdir(parents=True, exist_ok=True)
        (raw / "创作笔记").mkdir(parents=True, exist_ok=True)
    return raw


def ensure_file(path: Path, content: str) -> bool:
    if path.exists():
        return False
    path.write_text(content, encoding="utf-8")
    return True


def vscode_user_data_dir() -> Path:
    configured = os.environ.get("VSCODE_USER_DATA_DIR")
    if configured:
        return Path(configured)
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "Code" / "User"
    if sys.platform == "win32":
        return Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")) / "Code" / "User"
    return Path.home() / ".config" / "Code" / "User"


def file_uri_path(value: object) -> Optional[Path]:
    if not isinstance(value, str) or not value.startswith("file:"):
        return None
    parsed = urlparse(value)
    return Path(unquote(parsed.path)).resolve()


def vscode_chat_session_dirs(root: Path, user_data_dir: Optional[Path] = None) -> list[Path]:
    project = root.resolve()
    storage = (user_data_dir or vscode_user_data_dir()) / "workspaceStorage"
    if not storage.is_dir():
        return []

    matches = []
    for workspace_file in storage.glob("*/workspace.json"):
        try:
            workspace = json.loads(workspace_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        workspace_path = file_uri_path(workspace.get("folder"))
        if workspace_path != project:
            continue
        chat_sessions = workspace_file.parent / "chatSessions"
        if chat_sessions.is_dir():
            matches.append(chat_sessions)
    return matches


def locate_vscode(root: Path) -> int:
    matches = vscode_chat_session_dirs(root)
    if not matches:
        print("vscode-state: absent")
        return 1
    print("vscode-state: found")
    for chat_sessions in matches:
        print(f"chat-sessions: {chat_sessions}")
    return 0


def inspect(root: Path) -> int:
    wiki = existing_wiki(root)
    raw = raw_path(root)
    if wiki is None:
        print("state: absent")
        print("path: none")
        print(f"raw-state: {'existing' if raw.exists() else 'absent'}")
        return 1

    print("state: existing")
    print(f"path: {wiki.relative_to(root.resolve())}")
    print(f"raw-state: {'existing' if raw.exists() else 'absent'}")
    if raw.exists():
        print(f"raw-path: {raw.relative_to(root.resolve())}")
    return 0


def scaffold(content_type: str, root: Path) -> None:
    """Create or complete a known Wiki schema without overwriting files."""
    structure = STRUCTURES.get(content_type)
    if structure is None:
        print(f"未知类型: {content_type}")
        print(f"支持的类型: {', '.join(STRUCTURES)}")
        sys.exit(1)

    wiki = wiki_path(content_type, root)
    wiki.mkdir(parents=True, exist_ok=True)
    ensure_raw_structure(root, content_type)

    for folder, files in structure.items():
        folder_path = wiki / folder
        folder_path.mkdir(parents=True, exist_ok=True)
        if content_type != "dev_project":
            ensure_file(folder_path / "_index.md", f"# {folder}\n\n")
        for filename in files:
            ensure_file(folder_path / filename, f"# {filename.removesuffix('.md')}\n\n")

    if content_type == "dev_project":
        ensure_file(wiki / "CLAUDE.md", DEV_CLAUDE_MD)
        ensure_file(wiki / "hot.md", HOT_MD)
        ensure_file(wiki / "log.md", LOG_MD)
    else:
        ensure_file(wiki / "index.md", INDEX_HEADER)
        ensure_file(wiki / "方向.md", PURPOSE_MD)
        ensure_file(wiki / "log.md", LOG_MD)
        ensure_file(wiki / "hot.md", HOT_MD)
    ensure_file(wiki / "来源索引.md", SOURCE_INDEX_MD)
    print(f"created-or-completed: {wiki}")
    print(f"type: {content_type}")


def list_types() -> None:
    print("支持的类型:")
    for content_type, structure in STRUCTURES.items():
        print(f"  {content_type:15s} -> {', '.join(structure)}")


def validate(root: Path, content_type: Optional[str]) -> int:
    wiki = existing_wiki(root)
    if wiki is None:
        print("缺少 Wiki 目录")
        return 1

    if content_type == "dev_project" or (wiki / "CLAUDE.md").exists():
        raw = raw_path(root)
        required = [
            "CLAUDE.md", "hot.md", "log.md", "来源索引.md",
            "开发", "架构", "运维", "排障", "学习", "巡检报告", "归档",
        ]
        missing = [name for name in required if not (wiki / name).exists()]
        raw_missing = [name for name in ["sessions"] if not (raw / name).exists()]
        if missing:
            print(f"缺少开发项目入口: {', '.join(missing)}")
            return 1
        if raw_missing:
            print(f"缺少原始材料入口: {', '.join(raw_missing)}")
            return 1
        print(f"开发项目 Wiki 结构完整: {wiki}")
        return 0

    structure = STRUCTURES.get(content_type or "generic", STRUCTURES["generic"])
    required = ["index.md", "方向.md", "hot.md", "log.md", "来源索引.md", *structure]
    missing = [name for name in required if not (wiki / name).exists()]
    if missing:
        print(f"缺少 Wiki 基础结构: {', '.join(missing)}")
        return 1
    print(f"Wiki 基础结构完整: {wiki}")
    return 0


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    command = sys.argv[1]
    if command == "types":
        list_types()
    elif command == "inspect" and len(sys.argv) >= 3:
        sys.exit(inspect(Path(sys.argv[2])))
    elif command == "is-wiki" and len(sys.argv) >= 3:
        found = existing_wiki(Path(sys.argv[2])) is not None
        print("true" if found else "false")
        sys.exit(0 if found else 1)
    elif command == "scaffold" and len(sys.argv) >= 4:
        scaffold(sys.argv[2], Path(sys.argv[3]))
    elif command == "locate-vscode" and len(sys.argv) >= 3:
        sys.exit(locate_vscode(Path(sys.argv[2])))
    elif command == "validate" and len(sys.argv) >= 3:
        content_type = sys.argv[3] if len(sys.argv) >= 4 else None
        sys.exit(validate(Path(sys.argv[2]), content_type))
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()

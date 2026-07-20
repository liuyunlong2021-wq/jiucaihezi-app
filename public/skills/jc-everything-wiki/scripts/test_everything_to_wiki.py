"""Regression tests for the development-project Wiki scaffold."""

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("everything_to_wiki.py")


class DevelopmentWikiScaffoldTests(unittest.TestCase):
    def run_scaffold(self, root: Path) -> None:
        subprocess.run(
            ["python3", str(SCRIPT), "scaffold", "dev_project", str(root)],
            check=True,
            capture_output=True,
            text=True,
        )

    def run_command(self, *arguments: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["python3", str(SCRIPT), *arguments],
            capture_output=True,
            text=True,
            env=env,
        )

    def test_new_development_project_uses_docs_wiki(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            self.run_scaffold(root)

            wiki = root / "docs" / "wiki"
            self.assertTrue((wiki / "CLAUDE.md").is_file())
            for directory_name in ("开发", "架构", "运维", "排障", "学习", "巡检报告", "归档"):
                self.assertTrue((wiki / directory_name).is_dir(), directory_name)
            self.assertTrue((wiki / "来源索引.md").is_file())
            self.assertTrue((root / ".raw" / "sessions").is_dir())
            self.assertFalse((root / ".raw" / "imports").exists())
            self.assertFalse((root / "wiki").exists())

            source_index = (wiki / "来源索引.md").read_text(encoding="utf-8")
            self.assertIn("Studio 创模式", source_index)
            self.assertIn("Studio 文/武模式", source_index)
            self.assertIn("VS Code Chat", source_index)

    def test_existing_development_wiki_is_completed_without_overwrite(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            wiki = root / "docs" / "wiki"
            wiki.mkdir(parents=True)
            claude = wiki / "CLAUDE.md"
            claude.write_text("# Existing entry\n", encoding="utf-8")

            self.run_scaffold(root)

            self.assertEqual(claude.read_text(encoding="utf-8"), "# Existing entry\n")
            self.assertTrue((wiki / "hot.md").is_file())
            self.assertTrue((wiki / "log.md").is_file())
            self.assertTrue((wiki / "开发").is_dir())
            self.assertTrue((wiki / "来源索引.md").is_file())
            self.assertTrue((root / ".raw" / "sessions").is_dir())
            self.assertFalse((root / ".raw" / "imports").exists())
            self.assertFalse((root / "wiki").exists())

    def test_generic_wiki_validates_after_scaffolding(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            self.run_command("scaffold", "generic", str(root))
            result = self.run_command("validate", str(root), "generic")

            self.assertEqual(result.returncode, 0, result.stdout)

    def test_media_scaffolds_use_their_own_structures(self) -> None:
        structures = {
            "novel": ("作品/正文/卷", "作品/大纲/卷纲", "作品/大纲/章纲", "角色", "伏笔"),
            "manju": ("作品/正文", "作品/大纲/集纲", "角色", "场景", "道具", "伏笔"),
            "short_story": ("作品/正文", "作品/大纲", "角色", "剧情"),
            "film": ("作品/正文/卷", "作品/大纲/卷纲", "作品/大纲/场纲", "角色", "场景", "伏笔"),
            "tv_series": ("作品/正文", "作品/大纲/集纲", "角色", "剧情", "伏笔"),
            "advertisement": ("品牌", "产品", "受众", "创意", "脚本", "分镜", "场景", "道具"),
        }
        for content_type, expected_paths in structures.items():
            with self.subTest(content_type=content_type), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.run_command("scaffold", content_type, str(root))

                wiki = root / "wiki"
                for relative_path in expected_paths:
                    self.assertTrue((wiki / relative_path).is_dir(), relative_path)
                if content_type == "manju":
                    for obsolete_path in ("作品/分季", "作品/分集", "作品/分镜"):
                        self.assertFalse((wiki / obsolete_path).exists(), obsolete_path)
                self.assertTrue((root / ".raw" / "sessions").is_dir())
                self.assertTrue((root / ".raw" / "参考资料").is_dir())
                self.assertTrue((root / ".raw" / "创作笔记").is_dir())
                result = self.run_command("validate", str(root), content_type)
                self.assertEqual(result.returncode, 0, result.stdout)

    def test_dialogue_is_not_a_wiki_project_type(self) -> None:
        result = self.run_command("types")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertNotIn("dialogue", result.stdout)
        self.assertNotIn("  story           ->", result.stdout)
        for content_type in ("novel", "manju", "short_story", "film", "tv_series", "advertisement"):
            self.assertIn(content_type, result.stdout)

    def test_locate_vscode_finds_current_project_chat_sessions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "project"
            root.mkdir()
            user_data = Path(directory) / "Code" / "User"
            workspace = user_data / "workspaceStorage" / "workspace-id"
            workspace.mkdir(parents=True)
            (workspace / "workspace.json").write_text(
                json.dumps({"folder": root.as_uri()}), encoding="utf-8"
            )
            chat_sessions = workspace / "chatSessions"
            chat_sessions.mkdir()
            (chat_sessions / "session-id.jsonl").write_text("{}\n", encoding="utf-8")

            environment = {**os.environ, "VSCODE_USER_DATA_DIR": str(user_data)}
            result = self.run_command("locate-vscode", str(root), env=environment)

            self.assertEqual(result.returncode, 0, result.stdout)
            self.assertIn(str(chat_sessions), result.stdout)


if __name__ == "__main__":
    unittest.main()

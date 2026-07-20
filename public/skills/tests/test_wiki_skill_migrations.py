"""Contract tests for the query, repair, and audit Wiki Skills."""

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class WikiSkillMigrationTests(unittest.TestCase):
    def read_skill(self, name: str) -> str:
        return (ROOT / name / "SKILL.md").read_text(encoding="utf-8")

    def test_new_names_folders_and_registry_match(self) -> None:
        index = json.loads((ROOT / "index.json").read_text(encoding="utf-8"))
        for name in ("jc-cha-wiki", "jc-xiu-wiki", "jc-jian-wiki"):
            self.assertTrue((ROOT / name).is_dir(), name)
            self.assertIn(f"name: {name}", self.read_skill(name))
            entry = next(item for item in index if item["id"] == name)
            self.assertEqual(entry["name"], name)

    def test_old_skill_directories_and_registry_entries_are_gone(self) -> None:
        for name in ("JC-Wiki-查询", "JC-Wiki-修正", "JC-Wiki-一致性"):
            self.assertFalse((ROOT / name).exists(), name)
        index = json.loads((ROOT / "index.json").read_text(encoding="utf-8"))
        ids = {item["id"] for item in index}
        self.assertFalse({"JC-Wiki-查询", "JC-Wiki-修正", "JC-Wiki-一致性"} & ids)

    def test_main_skills_are_model_led_without_startup_menus(self) -> None:
        for name in ("jc-cha-wiki", "jc-xiu-wiki", "jc-jian-wiki"):
            text = self.read_skill(name)
            self.assertIn("用户只表达目标", text)
            self.assertIn("模型自主判断", text)
            self.assertNotIn("启动闸门", text)
            self.assertNotIn("等用户选择", text)

    def test_query_is_read_only_except_optional_derived_output(self) -> None:
        text = self.read_skill("jc-cha-wiki")
        self.assertIn("docs/wiki/", text)
        self.assertIn("wiki/", text)
        self.assertIn("不追加", text)
        self.assertIn("log.md", text)
        self.assertIn("衍生产物", text)

    def test_audit_only_reports_and_hands_repairs_to_repair_skill(self) -> None:
        text = self.read_skill("jc-jian-wiki")
        self.assertIn("只查不改", text)
        self.assertIn("jc-xiu-wiki", text)
        self.assertNotIn("auto-fix", text)

    def test_repair_owns_mechanical_fixes_but_not_raw_or_semantic_migration(self) -> None:
        text = self.read_skill("jc-xiu-wiki")
        self.assertIn("机械", text)
        self.assertIn("语义", text)
        self.assertIn("jc-raw-wiki", text)
        self.assertIn("不复制", text)
        self.assertIn("不移动", text)
        self.assertIn("不删除", text)

    def test_query_and_audit_scripts_accept_a_project_with_docs_wiki(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            wiki = project / "docs" / "wiki"
            wiki.mkdir(parents=True)
            (wiki / "角色.md").write_text("# 张三\n\n已确认事实\n", encoding="utf-8")

            query = subprocess.run(
                ["python3", str(ROOT / "jc-cha-wiki/scripts/wiki_query.py"), "search", str(project), "张三"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(query.returncode, 0, query.stderr)
            self.assertIn("角色.md:1", query.stdout)

            audit = subprocess.run(
                ["python3", str(ROOT / "jc-jian-wiki/scripts/scan_vault.py"), "--vault", str(project)],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertIn(audit.returncode, (0, 1), audit.stderr)
            self.assertIn("问题统计", audit.stdout)


if __name__ == "__main__":
    unittest.main()

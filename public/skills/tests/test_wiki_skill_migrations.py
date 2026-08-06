"""Contract tests for the query, repair, and audit Wiki Skills."""

import json
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
        for name in ("jc-xiu-wiki",):
            text = self.read_skill(name)
            self.assertIn("只执行已经确认答案", text)
            self.assertNotIn("启动闸门", text)
            self.assertNotIn("等用户选择", text)

    def test_wiki_skills_keep_native_tool_contracts_and_everything_is_a_planner(self) -> None:
        expected_actions = {
            "jc-xiu-wiki": ("replace",),
        }
        for name, actions in expected_actions.items():
            text = self.read_skill(name)
            self.assertIn("App 原生 `wiki` 工具", text, name)
            self.assertNotIn("link`", text, name)
            self.assertNotIn("extend`", text, name)
            for action in actions:
                self.assertIn(f"`{action}`", text, name)

        audit = self.read_skill("jc-jian-wiki")
        self.assertIn("App 原生 `wiki audit`", audit)
        self.assertFalse((ROOT / "jc-jian-wiki" / "scripts").exists())

        everything = self.read_skill("jc-everything-wiki")
        self.assertLessEqual(len(everything.splitlines()), 50)
        for term in ("目录", "子目录", "父目录", "用途", "放什么", "不放什么", "用户确认", "现有 Wiki 根目录", "index.md", "_index.md"):
            self.assertIn(term, everything)
        for internal_action in ("`extend`", "`link`", "`validate`"):
            self.assertNotIn(internal_action, everything)
        self.assertNotIn("与其他 Wiki Skill 的边界", everything)
        self.assertNotIn("安全边界", everything)
        self.assertNotIn("scripts/", everything)
        self.assertFalse((ROOT / "jc-everything-wiki" / "references").exists())

    def test_new_user_guide_matches_the_minimal_memory_wiki(self) -> None:
        guide = self.read_skill("jc-new-user-guide")
        wiki_guide = (ROOT / "jc-new-user-guide" / "references" / "1-Wiki使用.md").read_text(encoding="utf-8")
        for name in ("index.md", "hot.md", "log.md", "来源索引.md"):
            self.assertIn(name, guide)
            self.assertIn(name, wiki_guide)
        self.assertNotIn("wiki/README.md", guide + wiki_guide)
        self.assertNotIn("wiki/CLAUDE.md", guide + wiki_guide)
        self.assertIn("没有每轮自动读取", guide + wiki_guide)

    def test_query_is_read_only_except_optional_derived_output(self) -> None:
        text = self.read_skill("jc-cha-wiki")
        for term in ("docs/wiki/", "wiki/", "默认只读", "不追加 `log.md`", "真实 Wiki 页面"):
            self.assertIn(term, text)
        for term in ("Markdown 派生报告", "局部 `.canvas`", "用户明确要求"):
            self.assertIn(term, text)

    def test_audit_only_reports_and_hands_repairs_to_repair_skill(self) -> None:
        text = self.read_skill("jc-jian-wiki")
        self.assertIn("默认只读", text)
        self.assertIn("jc-xiu-wiki", text)
        self.assertNotIn("auto-fix", text)

    def test_repair_owns_mechanical_fixes_but_not_raw_or_semantic_migration(self) -> None:
        text = self.read_skill("jc-xiu-wiki")
        self.assertIn("机械", text)
        self.assertIn("精确", text)
        self.assertIn("jc-raw-wiki", text)
        self.assertIn("不复制", text)
        self.assertIn("不移动", text)
        self.assertIn("不删除", text)

    def test_xiu_package_is_single_file_and_has_no_legacy_repair_exports(self) -> None:
        self.assertEqual(
            sorted(path.relative_to(ROOT / "jc-xiu-wiki").as_posix() for path in (ROOT / "jc-xiu-wiki").rglob("*") if path.is_file()),
            ["SKILL.md"],
        )

if __name__ == "__main__":
    unittest.main()

"""Precision contract for the read-only Jian Wiki audit Skill."""

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
PACKAGE = ROOT / "jc-jian-wiki"


class JianWikiPrecisionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.skill = (PACKAGE / "SKILL.md").read_text(encoding="utf-8")
        cls.frontmatter = cls.skill.split("---", 2)[1]
        cls.guide = (ROOT / "jc-new-user-guide/references/1-Wiki使用.md").read_text(encoding="utf-8")

    def test_package_is_one_standard_skill_file(self) -> None:
        files = sorted(path.relative_to(PACKAGE).as_posix() for path in PACKAGE.rglob("*") if path.is_file())
        self.assertEqual(files, ["SKILL.md"])
        self.assertEqual(set(line.split(":", 1)[0] for line in self.frontmatter.splitlines() if ":" in line), {"name", "description"})
        self.assertLessEqual(len(self.skill.splitlines()), 50)

    def test_description_targets_audit_not_query_write_or_repair(self) -> None:
        for term in ("Wiki health", "consistency", "broken links", "contradictions", "recheck"):
            self.assertIn(term, self.frontmatter)
        for term in ("查询Wiki", "更新知识库", "修正Wiki"):
            self.assertNotIn(term, self.frontmatter)

    def test_skill_separates_mechanical_and_scoped_semantic_checks(self) -> None:
        for term in ("机械巡检", "指定主题", "语义一致性", "明确风险", "待确认候选", "历史卫生"):
            self.assertIn(term, self.skill)

    def test_skill_is_read_only_and_chat_only_by_default(self) -> None:
        for term in ("默认只读", "默认在对话中报告", "用户明确要求保存", "不扫描 Raw", "不自动修复"):
            self.assertIn(term, self.skill)

    def test_skill_rejects_personal_rules_and_duplicate_runtimes(self) -> None:
        for term in ("换皮", "映射撞车", "时代穿帮", "伏笔", "Python", "Node", "Reference", "扫描模式"):
            self.assertNotIn(term, self.skill)

    def test_candidates_and_non_rules_are_explicit(self) -> None:
        for term in ("普通未解析链接", "孤儿页", "候选", "目录文件数"):
            self.assertIn(term, self.skill)
        self.assertIn("不用于", self.skill)

    def test_source_freshness_is_read_only_and_does_not_decide_truth(self) -> None:
        for term in ("来源状态", "当前一致", "来源已变化", "来源不存在", "无法验证", "登记不完整"):
            self.assertIn(term, self.skill)
        for term in ("变化只表示待复查", "不自动回填指纹", "不自行裁决"):
            self.assertIn(term, self.skill)

    def test_index_bundles_only_the_skill_file(self) -> None:
        index = json.loads((ROOT / "index.json").read_text(encoding="utf-8"))
        entry = next(item for item in index if item["id"] == "jc-jian-wiki")
        self.assertEqual(entry["files"], ["SKILL.md"])

    def test_guide_and_build_have_no_old_personal_audit_path(self) -> None:
        for term in ("换皮漏改", "映射撞车", "时代穿帮", "伏笔没收", "scan_vault.py"):
            self.assertNotIn(term, self.guide)
        build = (REPO / "scripts/build-skills-index.mjs").read_text(encoding="utf-8")
        self.assertNotIn("wiki-extract-wikilinks-source", build)
        self.assertNotIn("extract_wikilinks.mjs", build)
        self.assertFalse((REPO / "scripts/wiki-extract-wikilinks-source.mjs").exists())
        self.assertFalse((REPO / "src/data/kbCommandPresets.ts").exists())


if __name__ == "__main__":
    unittest.main()

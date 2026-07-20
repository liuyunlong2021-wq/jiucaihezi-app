"""Contract checks for the reusable Wiki Skill standard."""

import json
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
SKILLS_ROOT = SKILL_ROOT.parent
PROJECT_ROOT = SKILLS_ROOT.parents[1]
WIKI_SKILL_STANDARD = PROJECT_ROOT / "docs" / "wiki" / "学习" / "Wiki-Skill改造规范.md"


class WikiSkillContractTests(unittest.TestCase):
    def test_name_matches_lowercase_hyphenated_folder_and_registry(self) -> None:
        expected_name = "jc-everything-wiki"
        self.assertEqual(SKILL_ROOT.name, expected_name)

        skill_text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn(f"name: {expected_name}", skill_text)

        index = json.loads((SKILLS_ROOT / "index.json").read_text(encoding="utf-8"))
        entry = next(item for item in index if item["id"] == expected_name)
        self.assertEqual(entry["name"], expected_name)
        for relative in (
            "references/项目语境/开发项目.md",
            "references/项目语境/小说项目.md",
            "references/项目语境/漫剧项目.md",
            "references/项目语境/短故事项目.md",
            "references/项目语境/电影项目.md",
            "references/项目语境/电视剧项目.md",
            "references/项目语境/广告项目.md",
            "references/项目语境/通用资料.md",
        ):
            self.assertIn(relative, entry["files"])
        self.assertNotIn("references/项目语境/故事项目.md", entry["files"])

    def test_reusable_wiki_skill_standard_exists(self) -> None:
        standard = WIKI_SKILL_STANDARD
        self.assertTrue(standard.is_file())
        text = standard.read_text(encoding="utf-8")
        self.assertIn("名称与目录", text)
        self.assertIn("输入", text)
        self.assertIn("输出", text)
        self.assertIn("验证", text)

    def test_skill_and_development_standard_define_raw_evidence_boundary(self) -> None:
        skill_text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
        development_standard = (SKILL_ROOT / "references" / "项目语境" / "开发项目.md").read_text(
            encoding="utf-8"
        )

        self.assertIn("来源索引", skill_text)
        self.assertIn(".raw/", skill_text)
        self.assertIn("原始材料", development_standard)
        self.assertIn("不复制", development_standard)

    def test_skill_uses_compact_autonomous_flow_and_two_reference_layers(self) -> None:
        skill_text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("用户只表达目标", skill_text)
        self.assertIn("模型自主判断", skill_text)
        self.assertIn("## 执行流程", skill_text)
        self.assertIn("项目语境", skill_text)
        self.assertIn("能力标准", skill_text)
        self.assertIn("类型 -> Reference", skill_text)
        self.assertIn("双链", skill_text)
        self.assertIn("jc-raw-wiki", skill_text)

        for relative in (
            "references/项目语境/开发项目.md",
            "references/项目语境/小说项目.md",
            "references/项目语境/漫剧项目.md",
            "references/项目语境/短故事项目.md",
            "references/项目语境/电影项目.md",
            "references/项目语境/电视剧项目.md",
            "references/项目语境/广告项目.md",
            "references/项目语境/通用资料.md",
            "references/能力标准/建库与接管.md",
            "references/能力标准/Raw与来源索引.md",
            "references/能力标准/对话原始材料.md",
        ):
            self.assertTrue((SKILL_ROOT / relative).is_file(), relative)

        for obsolete in ("小说-Wiki标准.md", "漫剧-Wiki标准.md", "短故事-Wiki标准.md"):
            self.assertFalse((SKILL_ROOT / "references" / obsolete).exists(), obsolete)
        self.assertFalse((SKILL_ROOT / "references/项目语境/对话记录.md").exists())

    def test_media_standards_define_distinct_project_models(self) -> None:
        expected_terms = {
            "小说项目.md": ("卷纲", "章纲", "人物弧光"),
            "漫剧项目.md": ("集纲", "人物弧光", "尺寸与体量"),
            "短故事项目.md": ("短故事名", "故事纲", "正文"),
            "电影项目.md": ("卷纲", "场纲", "人物弧光"),
            "电视剧项目.md": ("集名", "集纲", "正文"),
            "广告项目.md": ("品牌", "产品", "受众", "创意"),
        }
        for filename, terms in expected_terms.items():
            standard = (SKILL_ROOT / "references" / "项目语境" / filename).read_text(encoding="utf-8")
            for term in terms:
                self.assertIn(term, standard)
        self.assertFalse((SKILL_ROOT / "references/项目语境/故事项目.md").exists())

    def test_novel_context_is_the_single_source_for_build_and_raw_fill(self) -> None:
        novel = (SKILL_ROOT / "references/项目语境/小说项目.md").read_text(encoding="utf-8")
        self.assertIn("## 建库与增长规则", novel)
        self.assertIn("## Raw 填充标准", novel)
        self.assertIn("完整会话", novel)


if __name__ == "__main__":
    unittest.main()

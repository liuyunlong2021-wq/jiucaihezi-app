"""Target contract for the focused Wiki query Skill."""

import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = ROOT / "jc-cha-wiki"
SKILL_PATH = SKILL_ROOT / "SKILL.md"


class ChaWikiPrecisionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.text = SKILL_PATH.read_text(encoding="utf-8")

    def test_package_contains_only_a_standard_skill_file(self) -> None:
        files = sorted(
            str(path.relative_to(SKILL_ROOT))
            for path in SKILL_ROOT.rglob("*")
            if path.is_file() and path.name != ".DS_Store" and "__pycache__" not in path.parts
        )
        self.assertEqual(files, ["SKILL.md"])
        frontmatter = self.text.split("---", 2)[1]
        self.assertEqual(set(re.findall(r"^([a-z-]+):", frontmatter, re.MULTILINE)), {"name", "description"})
        self.assertLessEqual(len(self.text.splitlines()), 50)

    def test_description_targets_project_wiki_questions(self) -> None:
        description = next(line for line in self.text.splitlines() if line.startswith("description:"))
        for term in ("project Wiki", "facts", "current status", "counts", "relationship graph", "查询Wiki"):
            self.assertIn(term, description)
        for broad_term in ("web search", "general knowledge"):
            self.assertIn(broad_term, description)

    def test_retrieval_reads_sources_without_fixed_pages_or_modes(self) -> None:
        for term in ("1-3", "短词", "一次提交", "同一工具轮", "读取原页面", "一层", "查到足够证据就停止", "真实 Wiki 页面"):
            self.assertIn(term, self.text)
        self.assertNotIn("分别检索", self.text)
        for old_term in ("Quick", "Standard", "Deep", "hot.md、CLAUDE.md", "架构/", "结论、证据、风险、下一步"):
            self.assertNotIn(old_term, self.text)

    def test_gaps_conflicts_and_read_only_boundary_are_explicit(self) -> None:
        for term in (
            "冲突", "未记录", "训练知识", "默认只读", "不扫描 Raw", "不更新 `hot.md`",
            "不追加 `log.md`", "用户明确要求保存", "Markdown", "用户明确要求关系图", "`.base`",
        ):
            self.assertIn(term, self.text)

    def test_project_answers_show_wiki_and_original_evidence(self) -> None:
        for term in ("Wiki 章节", "原始来源", "已处理范围", "原始来源未登记或登记不完整"):
            self.assertIn(term, self.text)
        for term in ("来源记录不等于权威结论", "不自行裁决", "不为回答补写来源索引"):
            self.assertIn(term, self.text)

    def test_index_and_current_docs_drop_the_old_query_package(self) -> None:
        index = json.loads((ROOT / "index.json").read_text(encoding="utf-8"))
        entry = next(item for item in index if item["id"] == "jc-cha-wiki")
        self.assertEqual(entry["files"], ["SKILL.md"])
        for term in ("scripts/wiki_query.py", "references/能力标准", "Python", "Node"):
            self.assertNotIn(term, self.text)

    def test_retrieval_acceptance_fixture_covers_evidence_boundaries(self) -> None:
        cases = json.loads((ROOT / "tests/fixtures/wiki_retrieval_cases.json").read_text(encoding="utf-8"))
        self.assertEqual({case["id"] for case in cases}, {
            "single-page-with-source", "synonym-recall", "conflict", "wiki-only", "missing",
        })
        self.assertTrue(all(set(case) == {
            "id", "question", "answerable", "expectedWikiPaths", "expectedSourcePaths",
        } for case in cases))


if __name__ == "__main__":
    unittest.main()

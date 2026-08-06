"""Target contract for the focused Raw-to-Wiki Skill."""

import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = ROOT / "jc-raw-wiki"
SKILL_PATH = SKILL_ROOT / "SKILL.md"


class RawWikiPrecisionTests(unittest.TestCase):
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

    def test_triggers_only_on_explicit_wiki_writes(self) -> None:
        description = next(line for line in self.text.splitlines() if line.startswith("description:"))
        for term in ("填充Wiki", "更新Wiki", "写入Wiki", "沉淀到Wiki"):
            self.assertIn(term, description)
        for broad_term in ("我刚写完", "开发收尾", "续写前整理", "刷新热缓存"):
            self.assertNotIn(broad_term, description)

    def test_scope_and_incremental_write_contract_are_explicit(self) -> None:
        for term in (
            "用户指定", "当前对话", "不得默认扫描", "现有 Wiki 根目录", "增量",
            "不整篇覆盖", "重复", "冲突", "来源索引.md", "_index.md", "jc-everything-wiki",
        ):
            self.assertIn(term, self.text)
        for term in ("Raw 不复制", "不移动", "不删除", "hot.md", "log.md", "CLAUDE"):
            self.assertIn(term, self.text)

    def test_important_conclusions_register_the_shared_evidence_contract(self) -> None:
        for term in (
            "Wiki 章节", "来源角色", "真实来源", "已处理范围", "写入时指纹", "记录时间",
            "wiki evidence", "正文写入成功后", "原件", "可读副本", "未计算",
        ):
            self.assertIn(term, self.text)
        self.assertIn("模型生成文本不能冒充事实来源", self.text)

    def test_old_templates_tools_and_derived_views_are_absent(self) -> None:
        for term in (
            "类型 -> Reference", "dev_project", "novel", "manju", "Canvas", "Bases",
            "closeout", "digest_raw.py", "scripts/", "references/", "inspect", "validate",
        ):
            self.assertNotIn(term, self.text)

    def test_index_and_other_wiki_skills_use_the_new_boundary(self) -> None:
        index = json.loads((ROOT / "index.json").read_text(encoding="utf-8"))
        entry = next(item for item in index if item["id"] == "jc-raw-wiki")
        self.assertEqual(entry["files"], ["SKILL.md"])
        linked = "\n".join(
            (ROOT / name / "SKILL.md").read_text(encoding="utf-8")
            for name in ("jc-jian-wiki", "jc-xiu-wiki")
        )
        self.assertNotIn("jc-raw-wiki/references", linked)
        query = (ROOT / "jc-cha-wiki" / "SKILL.md").read_text(encoding="utf-8")
        for term in ("统计", "局部 `.canvas`", "Markdown 派生报告", "当前不生成 `.base`"):
            self.assertIn(term, query)


if __name__ == "__main__":
    unittest.main()

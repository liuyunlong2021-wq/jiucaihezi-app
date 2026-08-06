import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "jc-xiu-wiki"


class XiuWikiPrecisionTests(unittest.TestCase):
    def test_package_is_single_self_contained_skill(self) -> None:
        files = sorted(path.relative_to(SKILL).as_posix() for path in SKILL.rglob("*") if path.is_file())
        self.assertEqual(files, ["SKILL.md"])

    def test_skill_contract_is_precise_and_does_not_claim_other_roles(self) -> None:
        text = (SKILL / "SKILL.md").read_text(encoding="utf-8")
        frontmatter, body = text.split("---", 2)[1:]
        fields = [line.split(":", 1)[0] for line in frontmatter.splitlines() if line.strip()]
        self.assertEqual(fields, ["name", "description"])
        self.assertLessEqual(len(text.splitlines()), 50)
        self.assertIn("一个明确 Markdown 文件", text)
        self.assertIn("唯一旧值", text)
        self.assertIn("唯一新值", text)
        self.assertIn("依据", text)
        self.assertIn("jc-everything-wiki", text)
        self.assertIn("jc-raw-wiki", text)
        self.assertIn("jc-jian-wiki", text)
        self.assertNotIn("link`", body)
        self.assertNotIn("extend`", body)
        self.assertNotIn("scripts/", body)
        self.assertNotIn("references/", body)
        for personal_term in ("换皮", "映射撞车", "伏笔", "命运走向"):
            self.assertNotIn(personal_term, text)

    def test_description_excludes_adjacent_wiki_jobs(self) -> None:
        description = (SKILL / "SKILL.md").read_text(encoding="utf-8").splitlines()[2]
        for trigger in ("修正Wiki", "执行已确认修正", "修复确定性断链", "改错"):
            self.assertIn(trigger, description)
        for non_trigger in ("查询Wiki", "巡检Wiki", "更新知识库", "规划Wiki", "新建分类"):
            self.assertNotIn(non_trigger, description)

    def test_new_user_guide_assigns_category_creation_to_everything(self) -> None:
        guide = (ROOT / "jc-new-user-guide" / "references" / "1-Wiki使用.md").read_text(encoding="utf-8")
        section = guide.split("## 项目做大了：加分类", 1)[1].split("## 速查表", 1)[0]
        self.assertIn("jc-everything-wiki", section)
        self.assertNotIn("jc-xiu-wiki", section)

    def test_registry_lists_only_skill_file(self) -> None:
        index = json.loads((ROOT / "index.json").read_text(encoding="utf-8"))
        entry = next(item for item in index if item["id"] == "jc-xiu-wiki")
        self.assertEqual(entry["files"], ["SKILL.md"])


if __name__ == "__main__":
    unittest.main()

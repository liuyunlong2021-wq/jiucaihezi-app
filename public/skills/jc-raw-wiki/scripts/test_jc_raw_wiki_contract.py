"""Contract tests for the Raw-to-Wiki maintenance Skill."""

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


OLD_ROOT = Path(__file__).resolve().parents[1]
NEW_ROOT = OLD_ROOT.parent / "jc-raw-wiki"
SKILLS_ROOT = OLD_ROOT.parent
PROJECT_ROOT = SKILLS_ROOT.parents[1]
WIKI_SKILL_STANDARD = PROJECT_ROOT / "docs" / "wiki" / "学习" / "Wiki-Skill改造规范.md"


class JcRawWikiContractTests(unittest.TestCase):
    def test_skill_is_renamed_and_registered(self) -> None:
        self.assertTrue(NEW_ROOT.is_dir())
        text = (NEW_ROOT / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("name: jc-raw-wiki", text)
        self.assertIn("description: Use when", text)
        self.assertNotIn("启动闸门", text)

        index = json.loads((SKILLS_ROOT / "index.json").read_text(encoding="utf-8"))
        entry = next(item for item in index if item["id"] == "jc-raw-wiki")
        self.assertEqual(entry["name"], "jc-raw-wiki")
        self.assertNotIn("references/能力标准/小说项目填充.md", entry["files"])
        self.assertNotIn("references/项目语境/开发项目.md", entry["files"])
        self.assertNotIn("references/项目语境/通用资料.md", entry["files"])

    def test_development_closeout_contract_is_present(self) -> None:
        text = (NEW_ROOT / "references/能力标准/开发阶段收尾.md").read_text(encoding="utf-8")
        for section in (
            "本阶段最终架构",
            "已完成能力与唯一事实源",
            "提交范围和验证证据",
            "已知问题、未验证平台",
            "下一次开发从哪里进入",
        ):
            self.assertIn(section, text)

    def test_project_philosophy_and_skill_standard_require_model_led_routing(self) -> None:
        agents = (PROJECT_ROOT / "AGENTS.md").read_text(encoding="utf-8")
        standard = WIKI_SKILL_STANDARD.read_text(encoding="utf-8")
        self.assertIn("模型优先", agents)
        self.assertIn("用户提目标，模型定方法", agents)
        self.assertIn("模型自主决策", standard)
        self.assertIn("项目语境/", standard)
        self.assertIn("能力标准/", standard)

    def test_skill_uses_autonomous_routing_with_two_reference_layers(self) -> None:
        text = (NEW_ROOT / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("用户只表达目标", text)
        self.assertIn("模型自主判断", text)
        self.assertIn("项目语境", text)
        self.assertIn("能力标准", text)

        for relative in (
            "references/能力标准/内容填充.md",
            "references/能力标准/双链与Obsidian.md",
            "references/能力标准/Canvas关系图.md",
            "references/能力标准/Bases统计表.md",
            "references/能力标准/催化提取.md",
            "references/能力标准/开发阶段收尾.md",
        ):
            self.assertTrue((NEW_ROOT / relative).is_file(), relative)
        for filename in ("小说项目.md", "漫剧项目.md", "短故事项目.md", "电影项目.md", "电视剧项目.md", "广告项目.md"):
            self.assertIn(filename, text)
        self.assertIn("开发项目.md", text)
        self.assertFalse((NEW_ROOT / "references/项目语境/故事项目.md").exists())
        self.assertFalse((NEW_ROOT / "references/项目语境/开发项目.md").exists())
        self.assertFalse((NEW_ROOT / "references/项目语境/通用资料.md").exists())

    def test_novel_fill_standard_routes_facts_without_copying_raw(self) -> None:
        standard = (
            NEW_ROOT.parent / "jc-everything-wiki" / "references/项目语境/小说项目.md"
        ).read_text(encoding="utf-8")
        for item in (
            "角色/{角色名}", "作品/大纲/卷纲", "作品/大纲/章纲", "作品/正文/卷",
            "场景/{场景名}", "道具/{道具名}", "伏笔/{伏笔名}", "双链", "来源索引",
            "不复制", "完整会话", "原文",
        ):
            self.assertIn(item, standard)
        self.assertIn("## Raw 填充标准", standard)
        self.assertFalse((NEW_ROOT / "references/能力标准/小说项目填充.md").exists())

    def test_manju_fill_standard_routes_facts_without_copying_raw(self) -> None:
        standard = (
            NEW_ROOT.parent / "jc-everything-wiki" / "references/项目语境/漫剧项目.md"
        ).read_text(encoding="utf-8")
        for item in (
            "作品/大纲/集纲", "作品/正文/{集名}", "角色/{角色名}", "场景/{场景名}",
            "道具/{道具名}", "伏笔/{伏笔名}", "双链", "来源索引", "不复制", "完整会话",
        ):
            self.assertIn(item, standard)
        self.assertIn("## Raw 填充标准", standard)

        skill = (NEW_ROOT / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("漫剧项目.md` 的“Raw 填充标准”", skill)

    def test_remaining_project_contexts_define_raw_fill_standards(self) -> None:
        expected = {
            "短故事项目.md": ("作品/大纲/故事纲", "作品/正文/{短故事名}"),
            "电影项目.md": ("作品/大纲/场纲", "作品/正文/卷"),
            "电视剧项目.md": ("作品/大纲/集纲", "作品/正文/{集名}"),
            "广告项目.md": ("品牌", "产品", "脚本"),
        }
        skill = (NEW_ROOT / "SKILL.md").read_text(encoding="utf-8")
        for filename, terms in expected.items():
            standard = (
                NEW_ROOT.parent / "jc-everything-wiki" / "references/项目语境" / filename
            ).read_text(encoding="utf-8")
            self.assertIn("## Raw 填充标准", standard)
            for term in (*terms, "完整会话", "来源索引", "不复制"):
                self.assertIn(term, standard)
            self.assertIn(f"{filename}` 的“Raw 填充标准”", skill)

    def test_every_remaining_context_has_the_same_executable_fill_contract(self) -> None:
        contexts = {
            "短故事项目.md": ("故事纲", "短故事名", "角色/{角色名}"),
            "电影项目.md": ("卷纲", "场纲", "场景/{场景名}"),
            "电视剧项目.md": ("集纲", "集名", "伏笔/{伏笔名}"),
            "广告项目.md": ("品牌", "脚本", "分镜"),
            "通用资料.md": ("资料/", "主题/", "来源索引"),
        }
        for filename, terms in contexts.items():
            text = (
                NEW_ROOT.parent / "jc-everything-wiki" / "references/项目语境" / filename
            ).read_text(encoding="utf-8")
            for section in ("### 绝对边界", "### 输入与增量", "### 落位标准", "### 写入顺序"):
                self.assertIn(section, text, f"{filename}: {section}")
            for term in (*terms, "双链", "回链", "已处理范围", "不复制", "不移动", "不删除"):
                self.assertIn(term, text, f"{filename}: {term}")

    def test_generic_context_is_shared_for_build_and_raw_fill(self) -> None:
        standard = (
            NEW_ROOT.parent / "jc-everything-wiki" / "references/项目语境/通用资料.md"
        ).read_text(encoding="utf-8")
        for item in ("## Raw 填充标准", "资料/", "主题/", "来源索引", "完整会话", "不复制"):
            self.assertIn(item, standard)

        skill = (NEW_ROOT / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("通用资料.md` 的“Raw 填充标准”", skill)

    def test_development_reference_handoff_is_present(self) -> None:
        development = (
            NEW_ROOT.parent / "jc-everything-wiki" / "references/项目语境/开发项目.md"
        ).read_text(encoding="utf-8")
        skill = (NEW_ROOT / "SKILL.md").read_text(encoding="utf-8")

        for item in ("架构/", "开发/", "运维/", "排障/", "学习/", "巡检报告/", "归档/", "来源索引.md", "hot.md", "log.md"):
            self.assertIn(item, development)
        self.assertIn("类型 -> Reference", skill)
        self.assertIn("双链/回链", skill)
        self.assertIn("## Raw 填充标准", development)
        self.assertIn("完整会话", development)

    def test_main_skill_has_a_compact_execution_flow(self) -> None:
        text = (NEW_ROOT / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("## 执行流程", text)
        for step in ("盘点", "判断", "写入", "验证"):
            self.assertIn(step, text)
        self.assertIn("输出标准", text)

    def test_optional_capability_references_define_ai_decision_and_output_standard(self) -> None:
        for relative in (
            "references/能力标准/Canvas关系图.md",
            "references/能力标准/Bases统计表.md",
            "references/能力标准/催化提取.md",
        ):
            text = (NEW_ROOT / relative).read_text(encoding="utf-8")
            self.assertIn("模型", text)
            self.assertIn("输出标准", text)

    def test_raw_is_referenced_in_place_not_copied(self) -> None:
        text = (NEW_ROOT / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("来源索引.md", text)
        self.assertIn("不复制", text)
        self.assertIn("不移动", text)
        self.assertIn("不删除", text)
        source_standard = (NEW_ROOT / "references/能力标准/Raw与来源索引.md").read_text(encoding="utf-8")
        self.assertIn("已处理范围", source_standard)
        self.assertIn("不复制", source_standard)
        self.assertIn("完整会话", source_standard)

    def test_active_skill_references_do_not_point_to_the_old_skill_name(self) -> None:
        old_references = []
        for path in SKILLS_ROOT.rglob("*"):
            if path == Path(__file__).resolve():
                continue
            if not path.is_file() or path.suffix not in {".md", ".json", ".py"}:
                continue
            text = path.read_text(encoding="utf-8")
            if "JC-Wiki-记忆压缩" in text or "JC-jiyiyasuo" in text:
                old_references.append(str(path.relative_to(SKILLS_ROOT)))
        self.assertEqual(old_references, [])

    def test_digest_supports_docs_wiki_and_user_provided_raw_materials(self) -> None:
        script = NEW_ROOT / "scripts" / "digest_raw.py"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            wiki = root / "docs" / "wiki"
            wiki.mkdir(parents=True)
            (wiki / "hot.md").write_text("# 热缓存\n", encoding="utf-8")
            raw = root / ".raw" / "资料"
            raw.mkdir(parents=True)
            (raw / "conversation.jsonl").write_text('{"type":"user"}\n', encoding="utf-8")

            result = subprocess.run(
                ["python3", str(script), "inspect", "--project", str(root)],
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("docs/wiki", result.stdout)
            self.assertIn("conversation.jsonl", result.stdout)


if __name__ == "__main__":
    unittest.main()

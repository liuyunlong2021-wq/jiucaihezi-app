"""Contract tests for grounded creation with the Obsidian-compatible Wiki Skill."""

import unittest
from pathlib import Path


SKILL = Path(__file__).resolve().parents[1] / "wiki-memory" / "SKILL.md"
STORY_RULES = SKILL.parent / "references" / "故事资料沉淀规则.md"
PRODUCT_CONTRACT = (
    Path(__file__).resolve().parents[3]
    / "docs"
    / "wiki"
    / "开发"
    / "通用记忆工作台故事拆分与语义沉淀TDD-2026-09-09.md"
)


class WikiMemoryGroundingContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.skill = SKILL.read_text(encoding="utf-8")
        cls.story_rules = STORY_RULES.read_text(encoding="utf-8")
        cls.product_contract = PRODUCT_CONTRACT.read_text(encoding="utf-8")
        cls.description = cls.skill.split("---", 2)[1]

    def test_description_covers_wiki_grounded_answers_and_creation(self) -> None:
        self.assertIn("answer or creation grounded in project Wiki knowledge", self.description)

    def test_contract_separates_facts_relationships_navigation_and_execution(self) -> None:
        for term in ("结构化事实", "双链表达关系", "Index 负责导航", "Skill 规定取证顺序"):
            self.assertIn(term, self.skill)

    def test_internal_navigation_uses_wikilinks(self) -> None:
        self.assertIn("[[<相对路径>|<显示名称>]]", self.skill)
        self.assertIn("内部页面统一使用双链", self.skill)

    def test_grounded_output_reads_direct_relationships_before_generation(self) -> None:
        for term in ("任务锚点", "Properties", "直接关系", "回答或创作"):
            self.assertIn(term, self.skill)
        self.assertIn("不得只根据 Index 摘要、双链名称或模型已有知识推测目标正文", self.skill)

    def test_missing_or_ambiguous_links_are_not_guessed(self) -> None:
        self.assertIn("目标不存在或不能唯一解析", self.skill)
        self.assertIn("不得替用户选择或补成 Wiki 事实", self.skill)

    def test_description_and_entrypoint_route_story_distillation(self) -> None:
        for term in ("split", "distill", "资料沉淀", "拆小说"):
            self.assertIn(term, self.description)
        self.assertIn("references/故事资料沉淀规则.md", self.skill)

    def test_story_distillation_separates_lossless_structure_from_semantics(self) -> None:
        self.assertIn("无损拆出来源结构树", self.skill)
        self.assertIn("规范实体", self.skill)
        self.assertIn("不总结、不改写、不清洗事实", self.story_rules)
        self.assertIn("原文明确事实", self.story_rules)
        self.assertIn("模型归纳不得写成用户已确认事实", self.story_rules)

    def test_batch_size_does_not_change_storage_granularity(self) -> None:
        self.assertIn("批次只决定一次处理多少节点，不改变最终存储粒度", self.skill)
        self.assertIn("每个章节建立独立分析页", self.story_rules)
        self.assertIn("每章都形成独立分析页", self.story_rules)

    def test_story_workflow_is_resumable_and_does_not_guess_empty_assets(self) -> None:
        for status in ("complete", "needs_review"):
            self.assertIn(status, self.story_rules)
        self.assertIn("分析页不存在不能解释成", self.story_rules)
        self.assertIn("分析页不存在或非 `complete`", self.story_rules)

    def test_story_structural_split_is_a_native_product_operation(self) -> None:
        for term in ("故事拆分", "文件树顶部", "模型不得负责机械拆分", "Runtime"):
            self.assertIn(term, self.product_contract)
        self.assertIn("不得用多次 `write` 代替批量拆分", self.story_rules)

    def test_story_nodes_keep_runtime_order_separate_from_source_labels(self) -> None:
        for term in ("order", "source_label", "source_hash", "0001.md"):
            self.assertIn(term, self.product_contract)

    def test_story_split_builds_the_minimum_navigable_wiki(self) -> None:
        for term in ("原始材料", "来源.md", "原文.md", "原文节点", "直属父 `index.md`"):
            self.assertIn(term, self.product_contract)

    def test_semantic_state_and_file_commit_are_runtime_owned(self) -> None:
        self.assertIn("分析页是分析状态的唯一真源", self.product_contract)
        self.assertIn("模型只返回结构化语义结果", self.product_contract)
        self.assertIn("完成标记最后写入", self.product_contract)
        self.assertNotIn("analysis_status: pending", self.story_rules)

    def test_story_semantic_batch_uses_guarded_runtime_write(self) -> None:
        self.assertIn("模型只返回", self.story_rules)
        self.assertIn("Runtime 校验", self.story_rules)
        self.assertIn("模型不得决定路径、提交顺序", self.story_rules)
        self.assertIn("Runtime 不替模型总结原文", self.story_rules)

    def test_story_semantic_handoff_has_two_runtime_operations(self) -> None:
        for operation in ("prepare_story_analysis", "commit_story_analysis"):
            self.assertIn(operation, self.product_contract)
            self.assertIn(operation, self.story_rules)

    def test_story_semantic_result_is_structured_and_path_free(self) -> None:
        for field in (
            "node_id",
            "source_hash",
            "summary",
            "scenes",
            "characters",
            "props",
            "relations",
            "evidence",
            "needs_review",
        ):
            self.assertIn(field, self.product_contract)
        self.assertIn("不得接收模型提供的写入路径", self.product_contract)

    def test_story_semantic_receipt_supports_reliable_continuation(self) -> None:
        for term in ("committed", "skipped", "needs_review", "conflicts", "affected_paths"):
            self.assertIn(term, self.product_contract)
        self.assertIn("继续分析", self.product_contract)

    def test_story_semantic_commit_preserves_user_canonical_assets(self) -> None:
        self.assertIn("只建立链接，不自动改写其正文", self.product_contract)
        self.assertIn("只链接，不自动改写正文", self.story_rules)


if __name__ == "__main__":
    unittest.main()

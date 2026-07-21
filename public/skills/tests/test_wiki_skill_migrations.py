"""Contract tests for the query, repair, and audit Wiki Skills."""

import json
import shutil
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
        for section in ("结论", "证据", "风险", "下一步"):
            self.assertIn(section, text)

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

    def test_audit_ignores_code_examples_and_accepts_markdown_suffix_names(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            wiki = project / "docs" / "wiki"
            notes = wiki / "开发"
            notes.mkdir(parents=True)
            (notes / "历史方案.md (archive)").write_text("# 历史方案\n", encoding="utf-8")
            (wiki / "CLAUDE.md").write_text(
                "[[开发/历史方案.md (archive)]]\n\n`[[also-not-a-link]]`\n\n```text\n[[not-a-link]]\n```\n",
                encoding="utf-8",
            )

            audit = subprocess.run(
                ["python3", str(ROOT / "jc-jian-wiki/scripts/scan_vault.py"), "--vault", str(project), "--mode", "wiki"],
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertNotIn("[断链]", audit.stdout, audit.stdout)

    def test_query_defaults_to_active_pages_and_can_include_archive(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            wiki = project / "docs" / "wiki"
            active = wiki / "开发"
            archive = wiki / "归档"
            active.mkdir(parents=True)
            archive.mkdir(parents=True)
            (active / "现行方案.md").write_text("# 发布边界\n\n正式发布必须通过门禁。\n", encoding="utf-8")
            (archive / "旧方案.md").write_text("# 旧发布\n\n发布 发布 发布。\n", encoding="utf-8")
            script = ROOT / "jc-cha-wiki/scripts/wiki_query.py"

            active_result = subprocess.run(
                ["python3", str(script), "search", str(project), "发布"],
                capture_output=True,
                text=True,
                check=False,
            )
            all_result = subprocess.run(
                ["python3", str(script), "search", str(project), "发布", "--scope", "all"],
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(active_result.returncode, 0, active_result.stderr)
            self.assertIn("范围：现行知识", active_result.stdout)
            self.assertIn("现行方案.md", active_result.stdout)
            self.assertNotIn("旧方案.md", active_result.stdout)
            self.assertIn("旧方案.md", all_result.stdout)

    def test_query_status_recognizes_current_development_wiki_structure(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            wiki = project / "docs" / "wiki"
            for name in ("架构", "开发", "运维", "学习"):
                (wiki / name).mkdir(parents=True)
                (wiki / name / "页面.md").write_text(f"# {name}\n", encoding="utf-8")
            (wiki / "log.md").write_text(
                "## [2026-07-20] 最近操作\n\n## [2026-07-18] 更早操作\n",
                encoding="utf-8",
            )

            result = subprocess.run(
                ["python3", str(ROOT / "jc-cha-wiki/scripts/wiki_query.py"), "status", str(project)],
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("类型：开发项目", result.stdout)
            self.assertIn("架构：1 篇", result.stdout)
            self.assertIn("开发：1 篇", result.stdout)
            self.assertIn("运维：1 篇", result.stdout)
            self.assertIn("上次操作：[2026-07-20] 最近操作", result.stdout)

    def test_query_search_limits_each_page_to_keep_evidence_diverse(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            wiki = project / "docs" / "wiki" / "开发"
            wiki.mkdir(parents=True)
            (wiki / "高频.md").write_text("\n".join(["发布"] * 10), encoding="utf-8")
            (wiki / "另一证据.md").write_text("发布门禁\n", encoding="utf-8")

            result = subprocess.run(
                [
                    "python3", str(ROOT / "jc-cha-wiki/scripts/wiki_query.py"),
                    "search", str(project), "发布", "--limit", "4",
                ],
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("高频.md", result.stdout)
            self.assertIn("另一证据.md", result.stdout)

    def test_audit_separates_active_risks_from_archive_hygiene(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            wiki = project / "docs" / "wiki"
            active = wiki / "开发"
            archive = wiki / "归档"
            active.mkdir(parents=True)
            archive.mkdir(parents=True)
            (wiki / "CLAUDE.md").write_text("# 入口\n\n[[开发/当前页]]\n", encoding="utf-8")
            (active / "当前页.md").write_text("# 当前页\n\n[[不存在的现行页]]\n", encoding="utf-8")
            (archive / "旧页.md").write_text("# 旧页\n\n[[不存在的历史页]]\n", encoding="utf-8")

            audit = subprocess.run(
                ["python3", str(ROOT / "jc-jian-wiki/scripts/scan_vault.py"), "--vault", str(project), "--mode", "wiki"],
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(audit.returncode, 1, audit.stdout)
            self.assertIn("现行风险", audit.stdout)
            self.assertIn("归档卫生", audit.stdout)
            self.assertIn("不存在的现行页", audit.stdout)
            self.assertIn("不存在的历史页", audit.stdout)

            (active / "不存在的现行页.md").write_text("# 已补现行页\n", encoding="utf-8")
            clean_active = subprocess.run(
                ["python3", str(ROOT / "jc-jian-wiki/scripts/scan_vault.py"), "--vault", str(project), "--mode", "wiki"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(clean_active.returncode, 0, clean_active.stdout)
            self.assertIn("归档卫生", clean_active.stdout)

    def test_repair_preview_shows_diff_and_apply_prints_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            note = Path(directory) / "note.md"
            note.write_text("# 方案\n\n旧链路\n", encoding="utf-8")
            script = ROOT / "jc-xiu-wiki/scripts/apply_fix.py"
            base = [
                "python3", str(script), "replace", "--file", str(note),
                "--old", "旧链路", "--new", "新链路",
                "--reason", "现行事实过时", "--basis", "[[开发/现行SDD]]",
            ]

            preview = subprocess.run(base, capture_output=True, text=True, check=False)
            applied = subprocess.run([*base, "--apply"], capture_output=True, text=True, check=False)

            self.assertEqual(preview.returncode, 0, preview.stderr)
            self.assertIn("[修前预览]", preview.stdout)
            self.assertIn("现行事实过时", preview.stdout)
            self.assertIn("-旧链路", preview.stdout)
            self.assertIn("+新链路", preview.stdout)
            self.assertIn("[修复回执]", applied.stdout)
            self.assertIn("旧值剩余：0", applied.stdout)

    def test_link_and_scaffold_apply_print_receipts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            wiki = root / "wiki"
            wiki.mkdir()
            note = wiki / "入口.md"
            note.write_text("# 入口\n", encoding="utf-8")
            (wiki / "index.md").write_text("# 索引\n", encoding="utf-8")
            script = ROOT / "jc-xiu-wiki/scripts/apply_fix.py"

            link = subprocess.run(
                [
                    "python3", str(script), "link", "--file", str(note), "--add", "学习/手册",
                    "--reason", "补长期入口", "--basis", "巡检报告", "--apply",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            scaffold = subprocess.run(
                [
                    "python3", str(script), "scaffold", "--wiki", str(wiki), "--category", "学习",
                    "--desc", "长期知识", "--reason", "结构扩展", "--basis", "用户确认", "--apply",
                ],
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(link.returncode, 0, link.stderr)
            self.assertIn("[修前预览]", link.stdout)
            self.assertIn("[修复回执]", link.stdout)
            self.assertIn("链接存在：是", link.stdout)
            self.assertEqual(scaffold.returncode, 0, scaffold.stderr)
            self.assertIn("[修前预览]", scaffold.stdout)
            self.assertIn("[修复回执]", scaffold.stdout)
            self.assertIn("分类存在：是", scaffold.stdout)

    def test_audit_ignores_html_comments_and_escaped_wikilinks(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            wiki = project / "docs" / "wiki"
            wiki.mkdir(parents=True)
            (wiki / "CLAUDE.md").write_text(
                "# 入口\n\n<!-- [[comment-only]] -->\n\n\\[[escaped-only]]\n\n- 列表里的 `[[list-code-only]]`\n",
                encoding="utf-8",
            )

            audit = subprocess.run(
                ["python3", str(ROOT / "jc-jian-wiki/scripts/scan_vault.py"), "--vault", str(project), "--mode", "wiki"],
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(audit.returncode, 0, audit.stdout)
            self.assertNotIn("comment-only", audit.stdout)
            self.assertNotIn("escaped-only", audit.stdout)
            self.assertNotIn("list-code-only", audit.stdout)

    def test_markdown_link_parser_runs_without_project_node_modules(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            isolated = Path(directory)
            helper = isolated / "extract_wikilinks.mjs"
            note = isolated / "note.md"
            shutil.copy2(ROOT / "jc-jian-wiki/scripts/extract_wikilinks.mjs", helper)
            note.write_text("真实 [[开发/页面]]；`[[code-only]]`\n", encoding="utf-8")

            result = subprocess.run(
                ["node", str(helper)],
                input=json.dumps([str(note)], ensure_ascii=False),
                capture_output=True,
                text=True,
                check=False,
                cwd=isolated,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)[str(note)], ["开发/页面"])

    def test_skill_index_build_bundles_the_standalone_markdown_parser(self) -> None:
        build_script = (ROOT.parents[1] / "scripts" / "build-skills-index.mjs").read_text(encoding="utf-8")
        self.assertIn("wiki-extract-wikilinks-source.mjs", build_script)
        self.assertIn("extract_wikilinks.mjs", build_script)


if __name__ == "__main__":
    unittest.main()

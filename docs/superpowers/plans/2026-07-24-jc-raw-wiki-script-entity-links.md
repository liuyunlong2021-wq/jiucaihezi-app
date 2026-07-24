# JC Raw Wiki Script Entity Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Raw Wiki double-link standard use fixed scene header fields as the only entity source and add one episode backlink per referenced entity.

**Architecture:** Keep the behavior as a documentation contract. Add one focused contract test, then extend the existing double-link reference with structured-script rules while preserving its generic Obsidian link rules.

**Tech Stack:** Markdown Skill references, Python `unittest`

---

### Task 1: Fixed-format script entity backlink contract

**Files:**
- Modify: `public/skills/jc-raw-wiki/scripts/test_jc_raw_wiki_contract.py`
- Modify: `public/skills/jc-raw-wiki/references/能力标准/双链与Obsidian.md`

- [ ] **Step 1: Write the failing contract test**

Add this method to `JcRawWikiContractTests`:

```python
def test_structured_script_entities_use_scene_headers_and_episode_backlinks(self) -> None:
    text = (NEW_ROOT / "references/能力标准/双链与Obsidian.md").read_text(encoding="utf-8")
    for item in (
        "场景：", "人物：", "道具：", "唯一识别依据", "## 出现集数",
        "同一集只保留一条回链", "不扫描台词", "正文已有链接路径",
    ):
        self.assertIn(item, text)
    self.assertIn("明确空值", text)
    self.assertIn("不得覆盖或重排", text)
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
python3 -m unittest \
  public.skills.jc-raw-wiki.scripts.test_jc_raw_wiki_contract.JcRawWikiContractTests.test_structured_script_entities_use_scene_headers_and_episode_backlinks
```

Expected: `FAIL`; the existing reference does not contain `唯一识别依据` and the fixed-format backlink contract.

- [ ] **Step 3: Add the minimal structured-script rules**

Insert this section before the existing `## 输出标准` section in `双链与Obsidian.md`:

````markdown
## 固定格式剧本

剧本使用固定场次头时，只从以下三行识别本场实体：

```text
场景：[[wiki/场景/顾家客厅]]
人物：[[wiki/角色/林风]] [[wiki/角色/顾晚]]
道具：[[wiki/道具/离婚协议]]
```

- 场景、人物、道具三行是实体的唯一识别依据；`道具：无` 等明确空值不创建实体或链接。
- 不扫描台词中的角色名、动作描写或其它正文自然语言补链接。
- 保留场次头的现有链接；正文已有链接路径是实体目标的事实源，不猜测 Wiki 采用扁平文件还是多级目录。
- 链接目标不存在时，只根据已确认信息创建最小实体档案。
- 每个被引用实体档案必须在已有合适章节中追加本集链接；没有合适章节时创建 `## 出现集数`。
- 同一实体在同一集只保留一条回链；出现在多场时不得重复追加。
- 只增量追加本集回链，不得覆盖或重排实体档案的其它内容。

回链示例：

```markdown
## 出现集数

- [[wiki/剧本/第1集]]
```
````

Append these checks to `## 输出标准`:

```markdown
- 固定格式剧本完成后，逐项核对场次头中的实体链接、链接目标和实体档案中的本集回链。
- 确认同一实体的本集回链没有重复，并确认台词、动作描写和非场次头正文未被改写。
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
python3 -m unittest \
  public.skills.jc-raw-wiki.scripts.test_jc_raw_wiki_contract.JcRawWikiContractTests.test_structured_script_entities_use_scene_headers_and_episode_backlinks
```

Expected: `OK`; one test passes.

- [ ] **Step 5: Run the Raw Wiki contract suite**

Run:

```bash
python3 -m unittest public.skills.jc-raw-wiki.scripts.test_jc_raw_wiki_contract
```

Expected: all `JcRawWikiContractTests` pass.

- [ ] **Step 6: Run repository Wiki Skill tests and diff validation**

Run:

```bash
python3 -m unittest discover -s public/skills/tests -p 'test_*.py'
git diff --check
```

Expected: all discovered Wiki Skill tests pass and `git diff --check` exits `0`.

- [ ] **Step 7: Commit the implementation**

```bash
git add \
  public/skills/jc-raw-wiki/scripts/test_jc_raw_wiki_contract.py \
  public/skills/jc-raw-wiki/references/能力标准/双链与Obsidian.md \
  docs/superpowers/plans/2026-07-24-jc-raw-wiki-script-entity-links.md
git commit -m "feat: enforce script entity backlinks"
```

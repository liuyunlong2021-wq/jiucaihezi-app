# 已退役五个 Wiki Skill 备份

## 备份说明

- 备份时间：2026-08-31
- 删除提交：`f9e8c9cc3795de8aff6c5363f9ebf4e2552875d6`
- 删除时间：2026-08-27 00:37:42（+08:00）
- 删除提交说明：`feat: simplify wiki creation flow and finalize MCP queries`
- 恢复来源：删除提交的父版本 `f9e8c9cc^`
- 说明：本文件只保存原始 `SKILL.md` 文本，不自动重新注册为内置 Skill。

## 1. jc-cha-wiki

```markdown
---
name: jc-cha-wiki
description: Use when a Jiucaihezi user asks to answer questions from an existing project Wiki about project facts, company rules, current status, history, counts, comparisons, or an explicit relationship graph. Trigger on 查询Wiki, 查角色, 查设定, 项目现在怎么样, 统计Wiki, or 关系图. Do not use for general web search or general knowledge outside the Wiki.
---

# JC Cha Wiki

从已有 Wiki 找到可信答案；默认只读。

1. 定位当前项目唯一的 Wiki；同时存在 `wiki/` 与 `docs/wiki/` 时请用户确认，不读取固定必读页。
2. 从问题提取实体、事项、属性和时间，先选 1-3 个辨识度高的短词，在一次 Wiki 搜索中一次提交；不足时再补同义词、旧称、文件名或路径词。
3. 搜索结果只是候选。互不依赖的候选页、来源索引和指定文档在同一工具轮读取；读取原页面中支持答案的段落，只有引用页或反向引用会改变答案时才继续读取一层相关页面。
4. 查到足够证据就停止。用户要求全面盘点时才扩大范围，并说明实际读取边界。
5. 直接回答问题并标出真实 Wiki 页面，重要结论精确到 Wiki 章节。公司或项目专属的重要结论还要查询 `来源索引.md` 的相关行：有映射时附原始来源和已处理范围；没有时标明“原始来源未登记或登记不完整”。来源记录不等于权威结论。
6. 当前与历史按页面语义判断；多页冲突时并列证据，不自行裁决；没有依据时明确说 Wiki 未记录。
7. 公司或项目专属问题不得用训练知识补成项目事实；通用知识有帮助时，与 Wiki 记录分开说明。

- 默认只读：不扫描 Raw、附件、项目全部文件、历史会话或互联网，不更新 `hot.md`，不追加 `log.md`，不补链或修改事实页。
- 不为回答补写来源索引；默认简洁引用，用户追问时再展开来源范围和指纹。
- 统计依据实际页面内容和明确口径；只有用户明确要求保存时才写 Markdown 派生报告。
- 只有用户明确要求关系图且存在稳定关系时才生成局部 `.canvas`；使用真实文件节点和内部链接，不生成全库图，不静默覆盖已有布局。
- 当前不生成 `.base`；需要沉淀、规划、巡检或修正时，分别交给对应 Wiki Skill。
```

## 2. jc-everything-wiki

```markdown
---
name: jc-everything-wiki
description: Use when a user wants help designing or creating a precise Wiki folder structure for an existing Jiucaihezi memory space. Trigger on 规划Wiki, 创建Wiki目录, 完善Wiki架构, 我不知道Wiki该建什么, 根据我的需求设计Wiki, or 把这个项目整理成Wiki.
---

# JC Everything Wiki

1. 读取用户目标和现有 Wiki 目录；沿用现有 Wiki 根目录。信息不足以确定结构时，只问会改变目录设计的问题。
2. 识别需要长期保存和反复检索的知识，确定目录、子目录及其归属关系。
3. 先给方案，不写入；用户确认后再创建并复查实际结构。

目录设计必须满足：

- 每个目录有唯一用途；用途相同的合并。
- 子目录内容必须属于父目录；同级目录保持相同粒度。
- 单篇内容用文件，持续增加的同类内容才用目录。
- 只创建当前需求需要的结构，不建空模板。
- 保留已有内容，不覆盖。
- `index.md` 只导航顶层目录；每个目录的 `_index.md` 说明本目录用途并导航直属子目录。

方案固定输出：

```text
[现有 Wiki 根目录]/
├── [目录]/
│   ├── _index.md
│   └── [子目录]/
└── [页面].md
```

| 路径 | 用途 | 放什么 | 不放什么 | 为什么归属该父目录 |
|---|---|---|---|---|
| `[Wiki 根目录]/...` | ... | ... | ... | ... |

最后列出本次不创建的目录及原因，并请用户确认。
```

## 3. jc-jian-wiki

```markdown
---
name: jc-jian-wiki
description: Use when a user asks to inspect an existing project Wiki for Wiki health, consistency, broken links, contradictions, omissions, or a recheck after repairs. Trigger on 巡检Wiki, 知识库体检, 一致性检查, 查断链, 查矛盾, 查漏改, or 复检.
---

# JC Jian Wiki

只读巡检已有 Wiki，并用真实页面证据报告问题。

## 执行

1. 定位唯一的 `docs/wiki/` 或 `wiki/`；两者并存时请用户确认，不存在时停止。
2. 机械巡检使用 App 原生 `wiki audit`，同时读取其来源状态：当前一致、来源已变化、来源不存在、无法验证和登记不完整。变化只表示待复查，不代表结论错误。
3. 用户指定页面或目录时传 `evidencePaths`；否则才检查全 Wiki Markdown 和来源索引明确登记的项目文件，不遍历 Raw、附件或全部项目文件。
4. 语义一致性只检查用户指定主题。读取相关现行页面；只有来源或反向引用影响判断时再扩一层。相关重要结论缺少来源映射时只列待确认候选。
5. 默认在对话中报告实际范围、明确风险、待确认候选、历史卫生和未执行项，每项附真实页面与原因。
6. 复检时逐项标明已解决、仍存在或新发现，不改原报告，不自动回填指纹。

## 判定

- 机械巡检检查导航断链、歧义链接、孤儿候选及现行/历史分层；忽略代码、注释和转义示例中的伪链接。
- 当前导航页断链是明确风险；普通未解析链接与孤儿页只列待确认候选，不建议自动删除。
- `归档/`、`log.md` 及标为历史、已归档或已替代的页面只列历史卫生。
- 同名目标不唯一时报告歧义链接，不替用户任选页面。
- 只有同一对象、属性和时间范围的结论不兼容才算语义冲突；报告双方原话，不自行裁决。
- 目录文件数、页面长度、命名风格或缺少 frontmatter 不用于判错，除非当前 Wiki 有明确合同。

## 边界

- 默认只读、默认在对话中报告；只有用户明确要求保存时，才写入已有巡检目录中的 Markdown 派生报告。
- 不扫描 Raw、附件、历史会话、项目外文件或互联网，除非用户明确要求扩大证据范围。
- 不自动修复、移动、改名、删除、补链，不更新 `hot.md`、`log.md`、CLAUDE、Canvas、Bases 或看板。
- 确定性机械修复交给 `jc-xiu-wiki`；需要确认或补写事实时交给 `jc-raw-wiki`。
```

## 4. jc-raw-wiki

```markdown
---
name: jc-raw-wiki
description: Use when a Jiucaihezi user explicitly asks to write confirmed information from specified files, pages, URLs, or the current conversation into an existing project Wiki. Trigger on 填充Wiki, 更新Wiki, 写入Wiki, 沉淀到Wiki, 把本轮结论写进Wiki, or 用这些文件更新知识库.
---

# JC Raw Wiki

把用户指定范围内新增的、已确认且后续会复用的信息，增量沉淀进已有 Wiki。

1. 确定来源：使用用户指定的文件、页面、URL 或对话范围；用户明确说“本轮”时只使用当前对话。范围会改变结果时先问一个问题，不得默认扫描全部 Raw、项目文件或历史对话。
2. 定位现有 Wiki 根目录，沿用实际目录结构；读取指定来源、相关目标页、直接父目录 `_index.md` 和 `来源索引.md`，不读取固定必读页。
3. 将候选信息分为新增、更新、重复、冲突和过程信息；只写新增或用户已确认的更新。
4. 优先增量更新已有页面，不整篇覆盖。分类明确但页面缺失时可创建最小页面并更新直接父目录 `_index.md`；缺少合适分类时先交给 `jc-everything-wiki` 规划。
5. 每个重要结论定位到真实 Wiki 章节，并登记来源角色、真实来源、已处理范围、写入时指纹和记录时间。项目内来源先用 App 原生 `wiki evidence` 按原始字节取得完整 SHA-256；无法计算时写 `未计算（原因）`。原件和 Markdown 可读副本分行登记，模型生成文本不能冒充事实来源。
6. 正文写入成功后，才向 `来源索引.md` 增量增加对应行；重复映射不重复写。当前状态确实变化时才更新 `hot.md`，发生实际写入时才向 `log.md` 追加事实，不修改 CLAUDE。
7. 写后重新读取受影响文件和来源索引，报告实际写入、来源、冲突和未处理项。

- Raw 不复制、不移动、不删除；不复制完整会话、原文或附件内容。
- 不编造事实，不把参考资料写成项目已确认事实，不创建平行 Wiki。
- 事实冲突、正式稿无法判断或需要移动、合并、删除时，停止并请用户决定。
```

## 5. jc-xiu-wiki

```markdown
---
name: jc-xiu-wiki
description: Use when a user asks to precisely repair an already confirmed Wiki error in one existing Markdown file, such as a typo, name, value, or wrong Wiki target. Trigger on 修正Wiki, 执行已确认修正, 修复确定性断链, or 改错. Do not use for querying, inspection, new facts, structure planning, or page lifecycle changes.
---

# JC Xiu Wiki

只执行已经确认答案的机械精确修正，不替用户判断哪个事实正确。

## 输入合同

每项修正必须同时有：

- 一个明确 Markdown 文件路径（必须位于现有 Wiki 内）
- 唯一旧值和唯一新值
- `reason`（为什么错）和 `basis`（依据：用户决定或可靠证据）

缺少任一项，或需要重写/创作自然语言，停止并转交：结构规划给 `jc-everything-wiki`，新事实给 `jc-raw-wiki`，问题发现和复检给 `jc-jian-wiki`。

## 执行合同

1. 用 App 原生 `wiki` 工具的 `replace`，先 `apply: false` 预览目标文件、行号、命中数、旧值和新值。
2. 目标必须是当前 Wiki 内的 Markdown 文件；禁止省略路径、跨 Wiki 或修改 Canvas/Bases/日志等衍生产物。
3. 单文件多处命中默认停止；只有用户明确确认全部命中都要改时才传 `replaceAll: true`。
4. 用户批准预览后才传 `apply: true`，一次只写一个文件。
5. 写后重新读取同一文件，确认新值存在、旧值按合同消失，并回报修前/修后指纹和验证结果。

不复制 Raw，不扫描 Raw、不填充新事实、不规划目录、不移动、不重命名、不删除、不合并页面，也不要默认修改 `hot.md`、`log.md`、巡检报告或来源索引。
```

## 恢复命令

如需恢复为独立内置 Skill，可从删除提交的父版本取回：

```bash
git restore --source=f9e8c9cc^ -- public/skills/jc-cha-wiki/SKILL.md public/skills/jc-everything-wiki/SKILL.md public/skills/jc-jian-wiki/SKILL.md public/skills/jc-raw-wiki/SKILL.md public/skills/jc-xiu-wiki/SKILL.md
```

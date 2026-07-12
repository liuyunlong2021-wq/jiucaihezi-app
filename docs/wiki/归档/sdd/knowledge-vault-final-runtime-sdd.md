# Knowledge Vault Final Runtime SDD

> 日期: 2026-06-03
> 状态: 最终目标方案，待逐项执行
> 目标: 让用户创建、添加、修改知识库资料时，稳定得到真实可用的 Wiki 知识结构，并在对话中按 Wiki 结构精确召回当前任务需要的证据。
> 产品约束: 知识库只接受用户主动上传、整理、确认或明确触发的内容；AI 不得把普通对话输出自动写入正式 Wiki。

---

## 1. 用户最终想要的实际效果

用户点击创建知识库后，上传资料不能只是“存文件”或“生成几个空目录”。系统必须把资料真实变成知识库：

```text
上传资料
→ 原文件进入 raw/原始文件/
→ 转换后的 Markdown 进入 raw/转换后的MD/
→ 系统拆解资料内容
→ 生成有正文、有来源、有结构的 wiki 页面
→ 用户在对话中选择该知识库
→ 系统判断本轮真正需要哪些知识
→ 沿 Wiki 结构召回相关实体、事件、关系、模板和必要 raw 原文
→ LLM 基于这些证据回复
```

这套系统面向真实重资料场景，而不是演示级文件夹：

- 小说：几十万到上百万字，几百章，包含人物、关系、事件、章节、场景、道具、世界观和连续写作状态。
- 律师：大量历史案件、成功/失败案例、案由、事实经过、证据、诉状模板、办理策略、结果复盘。
- 通用专业资料：文件原文、可复用方法、流程、模板、案例和领域术语。

---

## 2. 当前代码状态判断

当前已有可复用底座：

- `src/stores/vaultStore.ts`：创建 Vault 元数据和三层目录骨架。
- `src/composables/useFileStore.ts`：知识文件统一写入 `documents` store，并在桌面端同步到磁盘。
- `src/utils/documentMarkdown.ts`：单一 ToMD 主链路，文本文件直读，非文本文件走 Tauri `document_to_markdown_file`。
- `src/utils/vaultIngestion.ts`：可以生成 raw 原文件、转换 Markdown、meta 和导入报告计划。
- `src/composables/useVaultCompiler.ts`：已有 `compileRawToWiki()`，能读取 raw 并生成 wiki create/update actions。
- `src/composables/useBrain.ts` + `src/utils/vaultRetrieval.ts`：已有 wiki 优先、raw 兜底的本地召回。
- `src/runtime/connection/knowledgeConnection.ts`：Knowledge 作为 user-side evidence 注入，不进入 system prompt。

但当前不能稳定达到最终目标：

1. `VaultWizard` 的“添加现有知识库内容”路径只用 `file.text()`，没有走 `convertDocumentToMarkdown()`，对 PDF/DOCX/XLSX 不稳定。
2. 文件树知识库上传入口没有形成统一的“上传到当前 Vault raw → ToMD → 整理 wiki”主链路。
3. 初次创建知识库时，上传资料会保存 raw 和首版 seed pages，但不保证全量 raw 都被结构化编译成有内容的 wiki。
4. `compileRawToWiki()` 让 LLM 直接输出大 JSON actions，缺少 chunk、实体、关系、事件、来源锚点等中间结构，稳定性不足。
5. 召回主要靠关键词/BM25/路径/summary/tags，不是真正沿 Wiki 结构、实体关系和来源锚点取证。
6. `distillHistoryToWiki()` 仍是旧结构，写入方式不完全符合 `raw/wiki/_reports` 协议。

---

## 3. 最终架构定案

知识库必须拆成五层：

```text
raw source layer
  原始文件、转换 Markdown、对话记录、导入报告

corpus index layer
  sourceHash、chunk、anchor、章节、段落、表格、案例片段

wiki knowledge layer
  人物、关系、事件、章节索引、案由、案例、模板、策略等结构化页面

retrieval planning layer
  识别本轮意图，选择 wiki 页面、结构关系、必要 raw chunk

runtime evidence layer
  拼装 Knowledge Evidence Pack，交给 LLM
```

不新增用户可见的“向量库”“Provider”“自动 Agent”。这些都只是知识库内部实现。

---

## 4. 核心数据协议

### 4.1 raw 文件

所有上传资料必须至少产生一个 raw Markdown 条目：

```ts
interface VaultRawDocument {
  category: 'knowledge'
  vaultId: string
  kind: 'raw'
  indexed: false
  mimeType: 'text/markdown'
  metadata: {
    vaultFolder: 'raw'
    kind: 'converted-markdown'
    folderPath: 'raw/转换后的MD'
    originalName: string
    sourceHash: string
    conversionEngine: string
    convertedAt: number
  }
}
```

原文件如可保存，写入 `raw/原始文件/`，metadata 使用 `kind: 'original-file'`。

### 4.2 chunk 索引

新增本地纯函数模块：

```text
src/utils/vaultChunking.ts
```

职责：

- 将 Markdown 按标题、章节、段落、表格和长度切成 chunk。
- 为每个 chunk 生成稳定 `chunkId` 和 `chunkHash`。
- 保留 `sourcePath`、`anchor`、`headingPath`、`charStart`、`charEnd`。
- 为小说识别章节号；为法律资料识别案件编号、案由、文书类型。

目标类型：

```ts
interface VaultSourceChunk {
  id: string
  rawId: string
  vaultId: string
  sourcePath: string
  anchor: string
  headingPath: string[]
  title: string
  text: string
  chunkHash: string
  charStart: number
  charEnd: number
  metadata: Record<string, unknown>
}
```

### 4.3 wiki 页面

Wiki 页面必须包含来源，不能只写泛泛摘要：

```markdown
---
pageType: character | relationship | eventline | chapter | case | template | strategy | concept | source
status: active
confidence: high | medium | low
tags: []
sources:
  - raw/转换后的MD/第050章.md#山洞
sourceChunks:
  - chunk_xxx
updatedAt: 1780000000000
---

# 页面标题

## 摘要

## 关键事实

## 时间线 / 处理流程

## 当前状态

## 相关页面

## 来源
```

---

## 5. 创建知识库主链路

所有创建入口统一走：

```text
VaultWizard
→ convertDocumentToMarkdown()
→ buildVaultIngestionPlan()
→ vaultStore.createVault()
→ write raw original + converted markdown + meta
→ buildVaultChunks()
→ buildInitialWikiDraft()
→ write wiki pages
→ write _reports/整理记录/首次创建报告
→ vault stats update
```

验收标准：

- 上传 10 个资料文件后，`raw/原始文件/` 和 `raw/转换后的MD/` 有对应文件。
- `wiki/` 下至少生成可读页面，不允许只有 `index.md/overview.md/hot.md/log.md`。
- 每个生成的 wiki 页面都有正文、summary、sources 或 sourceChunks。
- 生成失败时必须写入报告，并清楚告诉用户哪些文件失败。

---

## 6. 添加新资料主链路

所有新增资料入口统一走：

```text
FileTree / VaultWizard addToVault
→ 当前 Vault 校验
→ convertDocumentToMarkdown()
→ raw 写入
→ chunk 写入/更新
→ incremental organize
→ wiki create/update
→ conflict/report
→ refresh file tree
```

不允许存在另一条只做 `file.text()` 的路径。

验收标准：

- 用户添加 PDF/DOCX/XLSX/TXT/MD 时都走同一条 ToMD 主链路。
- 新资料必须产生 raw Markdown。
- 新资料中的可复用知识必须进入 wiki 或进入待确认报告。
- 已有 wiki 不得被无来源覆盖。

---

## 7. Wiki 组织策略

### 7.1 小说知识库

默认结构：

```text
wiki/
  人物/
  关系/
  事件线/
  章节索引/
  场景/
  道具/
  世界观/
  写作状态/
```

重点页面：

- `人物/男主.md`：性格、目标、弱点、秘密、当前状态、出场章节。
- `人物/女主.md`：同上。
- `关系/男主-女主.md`：关系阶段、关键事件、冲突、未解决问题、最近状态。
- `事件线/感情线.md`：按章节排列的感情进展。
- `章节索引/第050章.md`：章节摘要、出场人物、关键事件、来源 raw anchor。

### 7.2 律师知识库

默认结构：

```text
wiki/
  案由/
  案件/
  事实结构/
  证据/
  文书模板/
  办案策略/
  结果复盘/
```

重点页面：

- `案由/故意伤害.md`：构成要件、证据要点、常见策略、相关案例。
- `案件/案件编号.md`：事实、诉求、证据、文书、策略、结果。
- `文书模板/起诉状.md`：格式、段落结构、可复用表达、来源案例。

---

## 8. 对话召回主链路

用户选择知识库后，每轮对话必须先做 retrieval planning：

```text
用户输入
→ identifyVaultIntent()
→ extract domain query entities
→ search wiki index
→ expand by related pages
→ fetch source chunks when needed
→ build Evidence Pack
→ LLM
```

### 8.1 小说例子

用户说：“继续写男主和女主的爱情故事。”

召回应包含：

1. `人物/男主.md`
2. `人物/女主.md`
3. `关系/男主-女主.md`
4. `事件线/感情线.md`
5. 最近章节状态
6. 重要历史事件源片段，例如 `第050章.md#山洞吃饼干`

### 8.2 律师例子

用户说：“有没有和这个故意伤害案类似的案子？”

召回应包含：

1. `案由/故意伤害.md`
2. 相似 `案件/*.md`
3. 相关事实结构
4. 历史处理策略
5. 结果复盘

用户继续说：“参照之前案子写起诉状。”

召回应追加：

1. `文书模板/起诉状.md`
2. 被选中的历史案件文书来源
3. 当前案件事实输入

---

## 9. 需要修改的文件

### 新增

- `src/utils/vaultChunking.ts`：raw Markdown chunk 生成。
- `src/utils/vaultDomainSchema.ts`：小说、法律、通用知识库 schema 和默认目录。
- `src/utils/vaultWikiPlanner.ts`：根据 chunks 生成 wiki 写入计划。
- `src/utils/vaultEvidencePlanner.ts`：根据用户输入和 wiki/chunk 生成 Evidence Pack。
- `src/utils/__tests__/vaultChunking.test.ts`
- `src/utils/__tests__/vaultWikiPlanner.test.ts`
- `src/utils/__tests__/vaultEvidencePlanner.test.ts`

### 修改

- `src/components/vault/VaultWizard.vue`：创建和 addToVault 都走统一 ingestion + organize。
- `src/components/filetree/FileTreePanel.vue`：知识库上传入口写入 raw 并触发整理。
- `src/composables/useVaultCompiler.ts`：从一次性 actions 改成 chunk-aware incremental organize。
- `src/composables/useBrain.ts`：召回接入 Evidence Planner。
- `src/utils/vaultRetrieval.ts`：保留基础检索，但作为 Evidence Planner 的底层 scoring。
- `src/utils/vaultRuntime.ts`：Evidence Pack 输出格式升级。
- `src/utils/vaultHealth.ts`：增加 chunk/source/wiki 覆盖率检查。
- `CLAUDE.md`：记录最终形态硬性要求。

---

## 10. 执行任务拆分

### Task 1: 统一导入协议

目标：所有创建/添加资料入口都走 `convertDocumentToMarkdown()` 和 `buildVaultIngestionPlan()`。

验收：

- `VaultWizard` addToVault 不再使用裸 `file.text()`。
- 知识库 FileTree 上传能写入当前 Vault 的 raw。
- PDF/DOCX/XLSX/TXT/MD 入口行为一致。

### Task 2: raw chunk 索引

目标：为每个 converted Markdown 生成可追溯 chunk。

验收：

- chunk 有稳定 hash、sourcePath、anchor、headingPath。
- 小说章节可以识别“第 N 章”。
- 法律资料可以识别案号、案由、文书类型关键词。

### Task 3: 首次创建必须生成真实 Wiki

目标：新建知识库上传资料后，立即生成有正文的 wiki 页面。

验收：

- 不是只有骨架页。
- 每页有 sources/sourceChunks。
- 失败写报告，不静默成功。

### Task 4: 增量 raw → wiki 整理

目标：新资料添加后，只处理新增 raw/chunk，并合并到现有 wiki。

验收：

- 不重复整理已处理 chunk。
- 不破坏性覆盖现有 wiki。
- 冲突进入 `_reports/冲突报告`。

### Task 5: 领域 Wiki Schema

目标：小说、律师、通用三类知识库有稳定默认结构。

验收：

- 小说资料能生成人物、关系、事件线、章节索引。
- 律师资料能生成案由、案件、文书模板、策略。
- 用户自定义目录仍可覆盖默认结构。

### Task 6: 结构化 Evidence Planner

目标：对话召回从“关键词列表”升级为“意图 + Wiki 结构 + raw chunk”。

验收：

- 小说爱情线请求能召回人物、关系、事件线、关键章节片段。
- 律师相似案件请求能召回案由、相似案件、策略、模板。
- Evidence Pack 有预算控制和来源路径。

### Task 7: 健康检查升级

目标：检查 raw 是否已 chunk、chunk 是否入 wiki、wiki 是否有 sources。

验收：

- 能报告未整理 raw、无来源 wiki、孤立页面、冲突内容、重复页面。
- 报告写入 `_reports/健康检查`。

### Task 8: 端到端验收用例

目标：用小说和律师两个真实场景验证。

验收：

- 小说样例：上传多章文本，生成角色/关系/章节 Wiki，对话召回关键历史事件。
- 律师样例：上传案例和文书，生成案由/案件/模板 Wiki，对话能找相似案件并参照模板输出。

---

## 11. 第一阶段立即执行顺序

先执行最影响实际效果的三项：

1. Task 1：统一导入协议。
2. Task 2：raw chunk 索引。
3. Task 3：首次创建必须生成真实 Wiki。

这三项完成后，创建知识库和添加新资料才会从“能保存资料”升级为“能稳定生成可用 Wiki”。

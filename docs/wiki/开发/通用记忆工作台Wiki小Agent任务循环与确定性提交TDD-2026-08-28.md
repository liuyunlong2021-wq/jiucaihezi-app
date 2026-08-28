# 通用记忆工作台 Wiki 小 Agent 任务循环与确定性提交 TDD

> 日期：2026-08-28
> 状态：已实施（自动门禁通过，真实模型/平台待验收）
> 范围：用户显式选择 `@Wiki` 后的查询、创作、写入、建库、巡检、修正、移动、整理和移除
> 核心决定：`@Wiki` 是独立领域 Agent，拥有自己的任务状态、Wiki 工具策略和完成条件；模型请求、流式输出、重试、取消、审批和平台工具执行继续复用现有 DirectEngine
> 前置：[[通用记忆工作台原生Wiki能力与五Skill退役TDD-2026-08-26]]、[[通用记忆工作台非Agent固定任务流重构TDD-2026-08-27]]、[[通用记忆工作台索引优先Wiki查询与确认写入TDD-2026-08-27]]

## 0. 合同优先级

本 TDD 只替代下列旧合同：

1. [[通用记忆工作台索引优先Wiki查询与确认写入TDD-2026-08-27]] 中“`wiki_context` 最多调用一次”“Wiki 查询最多两次模型请求”和“模型不能继续选择 Wiki 资料”的限制。
2. [[通用记忆工作台非Agent固定任务流重构TDD-2026-08-27]] 中“`@Wiki` 只走固定资料选择阶段”“所有渐进任务统一最多六轮”的 Wiki 专用部分。
3. 当前 `memoryChat.ts` 中用 `@Wiki ? 5 : 3`、请求上限强制收尾和提示词要求模型分别写正文、再维护入口的临时实现。

下列合同继续有效：

- Skill-first 与显式能力连接：用户选什么，当前任务才获得什么。
- Wiki 是事实树，Skill 是方法树；不恢复五个 Wiki Skill。
- 新任务不读取 Raw 对话补记忆，不携带旧任务工具结果。
- “写入 Wiki”按钮保存已经展示并确认的回答时，仍由程序零模型请求直接写入。
- 普通文件、MCP、媒体、3D 和 Terminal 保持现有独立能力与审批边界。
- `wiki/index.md -> 分区入口 -> 具体事实页` 继续是长期外部记忆的渐进式披露结构。

历史 TDD 不删除、不改写；出现 `@Wiki` 运行时冲突时，以本 TDD 为准。

## 1. 产品决定

产品不是通用聊天 Agent。只有用户显式选择 `@Wiki` 时，当前任务才启动一个受限 Wiki 小 Agent：

```text
用户消息 + @Wiki
  -> 程序读取当前 Wiki 短入口或用户明确指定页面
  -> 模型根据任务选择 Wiki 资料或 Wiki 操作
  -> 程序执行并返回真实观察
  -> 模型继续选择、回答或提交变更
  -> 程序依据任务完成条件结束
```

这里的“独立”指领域职责独立，不是复制底层 Runtime：

```text
MemoryWorkbench
  -> Explicit Connections
       - @Wiki
       - selected Skills
       - selected MCP tools
       - selected files / attachments
       - media / 3D / Terminal
  -> Wiki Agent（本 TDD）
       - Wiki 入口预检
       - 证据工作集
       - Wiki 工具白名单
       - 检索去重与停滞判断
       - Wiki 变更提交与验证
       - 任务完成判断
  -> Existing DirectEngine
       - Provider / HTTP / stream
       - tool call protocol
       - retry / cancel / metrics
       - approval callbacks
  -> Existing Capability Kernel
       - ProjectFileService / platform adapters
       - wikiRuntime
       - Skill / MCP / media / 3D / Terminal
```

不得复制第二套 Provider、SSE、消息格式、重试器、审批器、文件服务或平台适配器。首版最多新增一个薄 `wikiAgent.ts` 控制器及其测试。

## 2. 当前根因

### 2.1 请求上限代替了完成条件

当前 `memoryChat.ts` 对 `@Wiki` 使用固定五次模型请求和五轮工具上限。它只能回答“最多跑多久”，不能回答：

- 用户要求的资料是否已经读够；
- 正文是否已经写入；
- 新页面是否已经登记入口；
- 写后验证是否通过；
- 巡检发现的问题是否已经修复并复检。

因此，增加到六轮、十二轮或六十四轮都不是根因修复。轮数只能是失控熔断，不能是成功判定。

### 2.2 当前 `wiki_context` 不是渐进式披露

当前 `buildWikiContext()` 先读取入口，然后遍历 Wiki 内全部 Markdown，并逐个完整读取正文后计算关键词分数。百万字项目每次任务都可能扫描整库；模型虽然只看到少量结果，程序仍然支付了全库读取成本。

正确顺序应是：

```text
短入口
  -> 模型选择分区入口或明确页面
  -> 程序并发读取所选页面
  -> 入口不足时才做一次精准搜索
  -> 必要时沿已发现链接继续一跳
```

### 2.3 “开放全部 Wiki 工具”不等于具备完整 Wiki 能力

当前原生 `wiki` action 已有：

```text
inspect / scaffold / search / context / status / graph
validate / audit / evidence / closeout / replace / extend
```

但缺少一个完整操作闭环：

```text
创建、更新、移动、整理或移除 Wiki 页面/目录
  + 自动维护最近的 _index.md/index.md
  + 更新受影响的精确入链和来源登记
  + 按现有 Wiki 合同维护当前状态、hot.md 和 log.md
  + 并发指纹保护、失败恢复和写后验证
```

所以模型可能成功写正文，却漏掉入口、状态或来源；移动页面后也可能留下旧导航和断链。工具白名单只是入口，缺的是完整的 Wiki 生命周期操作、维护合同和任务完成判断。

### 2.4 通用 Runtime 无法理解 Wiki 成功

DirectEngine 只知道模型返回正文、工具成功/失败和请求是否到达上限。它不应该理解 Wiki 索引、双链、页面状态和创作资料覆盖度。把这些规则继续塞进通用 Engine 会让其他 Skill、MCP、媒体和 3D 任务被 Wiki 语义污染。

因此，Wiki 成功条件必须由薄 Wiki Agent 持有，底层 Engine 只负责执行。

## 3. 三个参考项目的直接采用与拒绝

研究固定到以下提交，避免后续主分支变化导致设计依据漂移：

- [SamurAIGPT/llm-wiki-agent `6dd55a7`](https://github.com/SamurAIGPT/llm-wiki-agent/tree/6dd55a74f9e85e3de717c3a6c8e9c0970578870f)
- [nashsu/llm_wiki `e808211`](https://github.com/nashsu/llm_wiki/tree/e8082119649e6a8e1cf85eaf289adcabfdf39d4e)
- [sdyckjq-lab/llm-wiki-skill `efa2294`](https://github.com/sdyckjq-lab/llm-wiki-skill/tree/efa2294dd7c00479f7d8463fef88812d2fd5d1bc)

本 TDD 搬运经过验证的工作流和边界，不直接复制整套源码或依赖。

### 3.1 从 `llm-wiki-agent` 采用

| 来源 | 采用方式 |
| --- | --- |
| [wiki-query](https://github.com/SamurAIGPT/llm-wiki-agent/blob/6dd55a74f9e85e3de717c3a6c8e9c0970578870f/.claude/commands/wiki-query.md) | 查询先读 `index.md`，再读相关页面；回答列真实来源 |
| [wiki-ingest](https://github.com/SamurAIGPT/llm-wiki-agent/blob/6dd55a74f9e85e3de717c3a6c8e9c0970578870f/.claude/commands/wiki-ingest.md) | 一次语义计划包含正文、入口和日志变更，程序统一落盘 |
| [health.py](https://github.com/SamurAIGPT/llm-wiki-agent/blob/6dd55a74f9e85e3de717c3a6c8e9c0970578870f/tools/health.py) | 高频结构检查零模型调用；内容质量巡检才使用模型 |
| [build_graph.py](https://github.com/SamurAIGPT/llm-wiki-agent/blob/6dd55a74f9e85e3de717c3a6c8e9c0970578870f/tools/build_graph.py) | 明确 WikiLink 由程序确定性解析，语义关系是可选增强 |

不采用：每次 ingest 自动拆实体/概念页、自动重写全局 overview、默认扫描并改写大范围 Wiki。创作 Wiki 必须保持用户指定范围和可预测入口。

### 3.2 从 `llm_wiki` 采用

| 来源 | 采用方式 |
| --- | --- |
| [runtime.rs](https://github.com/nashsu/llm_wiki/blob/e8082119649e6a8e1cf85eaf289adcabfdf39d4e/src-tauri/src/agent/runtime.rs) | 每次模型输出只做“调用工具”或“最终回答”；工具观察返回后再决定下一步 |
| 同一文件的 retrieval signature | 同工具、同参数、同范围的重复检索不再执行 |
| 同一文件的 evidence gain | 连续两次检索没有增加证据时结束检索，基于已有证据回答 |
| [router.rs](https://github.com/nashsu/llm_wiki/blob/e8082119649e6a8e1cf85eaf289adcabfdf39d4e/src-tauri/src/agent/router.rs) | 路由只提供显式能力和提示，不根据问号、长度等文字形状强行触发 Wiki |
| [context.rs](https://github.com/nashsu/llm_wiki/blob/e8082119649e6a8e1cf85eaf289adcabfdf39d4e/src-tauri/src/agent/context.rs) | 模型上下文包含真实路径、片段、链接和版本信息；不声称读取未执行的资料 |

不采用：完整 Rust Agent Runtime、Embedding/向量检索、Deep Research、Shell、Session 持久化和通用工作区 Agent。现有 DirectEngine 和项目工具已经覆盖底层能力。

### 3.3 从 `llm-wiki-skill` 采用

| 来源 | 采用方式 |
| --- | --- |
| [ADR-0007](https://github.com/sdyckjq-lab/llm-wiki-skill/blob/efa2294dd7c00479f7d8463fef88812d2fd5d1bc/docs/adr/0007-kb-context-via-extension-not-prompt.md) | 当前 Wiki 状态由程序提供；不在固定系统提示词里拼整库内容 |
| [ADR-0028](https://github.com/sdyckjq-lab/llm-wiki-skill/blob/efa2294dd7c00479f7d8463fef88812d2fd5d1bc/docs/adr/0028-skill-and-workbench-capability-boundary.md) | Skill 保存方法，工作台保存当前库、页面、写入和 UI 状态；不复制同一能力 |
| [ADR-0029](https://github.com/sdyckjq-lab/llm-wiki-skill/blob/efa2294dd7c00479f7d8463fef88812d2fd5d1bc/docs/adr/0029-graph-is-a-view-of-wiki-structure.md) | 图谱和反向链接是 Wiki Markdown 的派生视图，不是第二事实源 |
| [ADR-0030](https://github.com/sdyckjq-lab/llm-wiki-skill/blob/efa2294dd7c00479f7d8463fef88812d2fd5d1bc/docs/adr/0030-local-first-data-boundaries.md) | 只把当前任务需要的最小 Wiki 资料发送给模型，项目内容和应用状态分离 |

不采用：pi-agent 全套嵌入、服务端会话、自动黑名单检索、工作台鉴权、独立 Graph UI 和长对话持久化。

### 3.4 从已退役五个 Wiki Skill 内化

五个 Skill 不恢复分发、不重新加载到模型，也不各自拥有 Runtime。设计依据固定为退役前提交 `73d0c30` 中的五个 `SKILL.md` 与当前 `public/skills/tests/test_*_wiki_precision.py` 契约测试，只把已经验证的行为合同收进一个 Wiki Agent：

| 退役 Skill | 内化合同 | 不内化内容 |
| --- | --- | --- |
| `jc-cha-wiki` | 唯一 Wiki、短词检索、候选原页、最多一层相关链接、真实页面与章节、来源范围、当前/历史/冲突分开、默认只读 | 固定回答格式、固定必读页、全库关系图 |
| `jc-raw-wiki` | 用户指定来源范围；新增/更新/重复/冲突分类；增量写入；来源路径、角色、范围、指纹和时间；正文成功后登记来源；状态变化才改 `hot.md`；实际写入才记 `log.md` | 自动扫描 Raw、复制原文、按项目类型维护重复模板 |
| `jc-jian-wiki` | 机械巡检与语义巡检分离；范围优先；断链、歧义、孤儿候选、来源状态；当前问题与历史卫生分开；默认只读；复检标记结果 | 自动修复、以文件大小/frontmatter/文风判错、开放式全库语义审判 |
| `jc-xiu-wiki` | 唯一目标、唯一旧值/新值、`reason/basis`、dry-run、写后指纹和复检；无唯一答案时停止 | 单文件限制作为全局限制；禁止用户明确要求的页面生命周期操作 |
| `jc-everything-wiki` | 一个项目一个 Wiki；目录用途唯一；父子归属清楚；同层粒度一致；只创建当前需要的结构；根入口和必要分区入口；保留既有内容 | 固定项目类型骨架、空模板、Raw 管理、五 Skill 之间的转交编排 |

当前 `wiki-creator` 继续只负责“首次建库/明确重构时给出最小结构计划”。它的 `wiki/index.md + 必要分区入口 + 已确认页面` 规则是 `scaffold` 的输入合同，不成为普通查询、创作或更新任务的额外 Skill 依赖。

## 4. Wiki Agent 的唯一职责

### 4.1 Wiki Agent 自己负责

- 识别并加载当前唯一 Wiki 根目录和入口。
- 持有本任务的 Wiki 证据工作集、已执行检索签名和完成状态。
- 只向模型暴露 `@Wiki` 与用户显式连接能力的最小工具集合。
- 让模型在入口、分区入口、具体页面和精准搜索之间渐进选择。
- 过滤重复检索，判断检索是否新增有效证据。
- 持有当前任务是否要求副作用、是否仍有未完成副作用和最后一次提交/验证结果。
- 执行 Wiki 页面与目录的创建、更新、移动、整理和移除，维护派生导航与链接并做写后验证。
- 根据查询、写入、建库、巡检或修正目标判断任务是否完成。
- 任务结束后销毁状态；不形成跨任务记忆。

### 4.2 继续由 DirectEngine 负责

- Chat Completions 请求、流式解析和模型工具调用协议。
- 网络错误重试、输出中断续传、取消和耗时指标。
- 同一模型回复中互不依赖只读工具的并发执行。
- 写入、Terminal、付费工具和项目外操作的审批回调。
- 工具结果按原工具调用顺序回填。

### 4.3 继续由 Wiki Runtime 负责

- 路径规范化和 Wiki 根目录限制。
- 复用现有 `inspect/scaffold/search/context/status/graph/validate/audit/evidence/closeout/replace/extend` 实现。
- 对模型只暴露两个 Wiki 工具：只读 `wiki_context` 与管理 `wiki`；旧 action 作为内部实现复用，不平铺成同义工具。
- Wiki 目录树、批量确定性提交、导航/链接维护、并发指纹、恢复和写后验证。
- Desktop/Web/Mobile 统一语义，各平台只替换现有文件适配器。

## 5. 显式能力组合

`@Wiki` 是本任务的 Wiki Agent 激活信号，不是自然语言关键词。用户没有选择 `@Wiki` 时，不启动 Wiki Agent，也不自动读取 Wiki。

| 用户选择 | Wiki Agent 获得的能力 |
| --- | --- |
| `@Wiki` | `wiki_context`、`wiki` |
| `@Wiki + @Skill` | 上述 Wiki 能力 + 已选 Skill 正文和它按需请求的资源 |
| `@Wiki + @MCP` | 上述 Wiki 能力 + 用户选中的具体 MCP 工具 |
| `@Wiki + @Skill + @MCP` | Skill 规定方法，MCP 提供外部结果，Wiki 提供事实和落盘 |
| `@Wiki + @文件` | Wiki 能力 + 用户明确选中的 Wiki 外文件；不开放项目全盘扫描 |
| `@Wiki + @媒体/@3D/@Terminal` | 只增加用户显式选择的对应能力；沿用现有审批和面板合同 |

约束：

- `@Skill` 本身不是可选项，必须是具体 Skill。
- `@MCP` 本身不是可选项，必须是具体 MCP 工具或服务器下的明确工具集合。
- Skill 声明需要某能力但用户未连接时，Wiki Agent提示用户补选，不自动扩权。
- `@Wiki` 本身已经拥有全部原生 Wiki 能力，不要求再选 `@文件` 才能修改 Wiki 内页面。
- 默认不读取 `.raw/对话记录`。用户明确给出项目内 Raw 文件路径并要求读取时，可把该路径作为只读证据；不得自主扫描 Raw，也不得通过 `@Wiki` 写 Raw。

## 6. 小 Agent 循环

### 6.1 零模型预检

用户发送 `@Wiki` 任务后，程序先执行：

1. 确定当前项目和唯一 Wiki 根目录；`wiki/` 与 `docs/wiki/` 同时成立时停止并请用户选择。
2. 用户给出 Wiki 内精确页面时直接读取该页；不为单文件总结强制多读入口。
3. 普通查询、创作和未指定目标的写入读取 `wiki/index.md`；开发项目兼容 `docs/wiki/CLAUDE.md`。
4. 记录已读文件的路径与指纹；只把“用户任务 + 必要入口/明确页面 + 已选 Skill/MCP 摘要”交给第一次模型请求。
5. 建库任务允许目标为空目录或缺少入口，由 `scaffold` 创建入口；修复/整理任务允许先读目录树，再重建入口。

精确页面不存在时返回真实错误。普通查询或创作缺少入口时停止并提示先建/修入口，不偷偷扫描全库；只有用户明确要求建库、接管、修复或整理时才能通过目录树继续。

### 6.2 每次模型只做一个决定

沿用现有原生 Function Calling，不创建新的 JSON/YAML 工作流 DSL。模型每次可以：

```text
1. 调用一个或一组互不依赖的只读 Wiki 工具
2. 调用一个需要顺序执行的 Wiki 写入/管理工具
3. 调用用户显式连接的 Skill/MCP/文件/媒体/3D/Terminal 能力
4. 返回最终回答
```

同一回复中的多个独立页面读取或搜索可并发；写入、审批及依赖上一步结果的调用必须串行。

### 6.3 任务内状态

首版只需要一个内存对象，不持久化、不做通用状态机框架，也不维护会漏掉新任务类型的固定 `taskKind` 枚举：

```ts
interface WikiAgentState {
  wikiRoot: string
  entryPath?: string
  requiresMutation: boolean
  evidence: Array<{ path: string; fingerprint: string }>
  retrievalSignatures: string[]
  failedSignatures: string[]
  noGainRetrievals: number
  pendingPlan?: WikiApplyInput
  applyResult?: WikiApplyResult
  validationResult?: WikiValidationResult
}
```

`requiresMutation` 只由用户的显式写入/创建/更新/移动/整理/删除、保存报告、生成关系图要求或后续确认设置，不按语气猜测。状态只记录路径、指纹、签名和提交结果，不复制页面正文、模型 reasoning、旧聊天或 API 凭据。任务是否完成由“有没有未完成副作用”判断，任务结束立即释放。

### 6.4 证据循环

1. 模型优先从入口选择具体页面。
2. 程序并发读取模型选择的页面，返回路径、标题、相关章节和正文。
3. 只有入口不足时才允许 `wiki_context(action='search')`；搜索结果只返回命中片段、行号和真实路径。
4. 首轮不足时，模型可补充同义词、旧称、文件名或路径词；新查询必须改变召回意图，不能把原词换序后重试。
5. 模型可根据已发现路径再读取一次具体页面或一跳链接。
6. 公司或项目专属的重要结论还要读取 `来源索引.md` 的相关记录：有映射时附原始来源和已处理范围；没有时明确“原始来源未登记或登记不完整”。来源记录只证明可追溯，不自动成为权威结论。
7. 与既有 `tool + normalized arguments + scope` 相同的检索签名直接拒绝，不重复读取。
8. 检索后 `evidence` 没有增加新路径或新指纹，记一次 no-gain；连续两次 no-gain 后关闭只读检索，只允许基于已有证据回答或明确说明资料不足。
9. 模型已经拥有足够证据时必须回答，不为了可选背景继续搜索。回答标出真实 Wiki 页面和相关章节，并说明实际读取范围；当前事实、历史记录和冲突证据分开表达，不用训练知识补项目事实。

### 6.5 写入循环

用户在消息中明确要求写入、创建、更新、填充、移动、整理、删除或修正 Wiki 时：

1. 该消息本身就是当前任务普通 Wiki 写入授权；程序设置 `requiresMutation`。
2. 模型读取必要的目标、入口、来源和受影响页面，生成一次包含全部语义变化的提交。续写归档不能只提交新正文，还必须在同一计划中提交确实变化的当前进度、角色、场景、道具、伏笔或 `hot.md` 内容。
3. 程序补齐机械变化并做整批 dry-run：展开目录、直属导航、根导航、精确入链、来源登记和日志，返回将创建/修改/移动/回收的真实路径；同时校验旧值命中数、行号、指纹和冲突。dry-run 不落盘，是每次写入的内部必经阶段。
4. dry-run 证明范围与用户指令完全一致时，普通创建、增量追加和唯一值替换直接执行；删除/移入回收站、完整覆盖、批量移动、多处命中、歧义目标或扩大用户范围才把预览交给用户二次确认。
5. 程序串行执行整份事务；失败时恢复写前快照，不保留“正文成功但入口失败”的半完成状态。
6. 程序重读全部目标和派生文件，运行结构与链接检查；通过后直接生成确定性回执。
7. 失败观察可返回模型修正。相同失败签名禁止重试；计划或证据有真实变化时可继续修正，直到完成、无进展或触发硬熔断，不用“只准修一次”代替完成条件。

成功写入后不依赖模型再说“成功”。最终回执由程序生成，避免文件已写入却因最后一次模型请求失败而显示整个任务失败。

当 `requiresMutation=true` 时，模型只返回正文不能结束任务；程序必须继续请求模型提交变更，或以“未写入”明确失败。查询和纯创作任务没有待完成副作用时，模型正文可以直接结束。

## 7. 工具合同

### 7.1 `wiki_context`：唯一只读入口

保留一个模型可见的只读工具，把现有 `context/search/inspect` 和文件读取实现收在 action 后面；不再同时暴露同义的 `wiki_search`。

```ts
interface WikiContextRequest {
  action: 'entry' | 'tree' | 'read' | 'search' | 'links'
  paths?: string[]
  query?: string[]
  scope?: 'active' | 'all'
  maxPages?: number
  maxTokens?: number
}
```

合同：

- `entry` 返回唯一根入口、指纹和一级导航；入口预检已完成时直接复用观察。
- `tree` 只返回 Wiki 相对路径、类型和指纹，不读取正文；只在建库、修复、整理、巡检或用户明确要求目录树时提供。
- `read` 只读取 `paths` 指定页面，最多 `12` 个，去重后并发；返回真实路径、标题、相关章节、正文和指纹。
- `search` 一次接收 `1-3` 个高信号短词，返回真实相对路径、行号和短片段；它是入口不足时的兜底，不返回整库正文。
- `links` 用现有 Markdown 解析器返回指定页面的一跳出链、入链、歧义和未解析目标；不递归遍历全库。
- 续写任务由模型沿入口选择规范、当前进度、总纲、当前分卷/分集大纲、上一章/集结尾和涉及的角色/场景/道具/伏笔；程序只批量读取选择结果，不写死小说骨架。
- 入口缺少必要路由时返回 `missingRoutes`，不静默读取全库；普通查询可用精准搜索补一次，创作缺少关键事实则如实停止。
- 默认排除 `log.md`、`归档/` 和 Raw；用户明确要求历史或给出 Raw 精确路径时才读取相应范围。
- 相同 Wiki 快照和相同输入返回稳定顺序。
- 统计必须基于实际读取页面和明确口径，不能用搜索结果数量冒充事实数量。
- 查询默认只读：不更新 `hot.md/log.md/来源索引.md`，不补链。只有用户明确要求保存时，才用 `apply` 写入现有位置的 Markdown 派生报告；只有用户明确要求关系图且存在稳定关系时才调用局部 `graph`，不生成全库图，不静默覆盖已有 `.canvas`，首版不生成 `.base`。

必须删除当前“对每个 Wiki Markdown 完整 `read()` 后再选择候选”的实现。旧 `wiki_search` 仅在迁移期作为 `wiki_context(action='search')` 的内部兼容调用；所有保留调用者迁移后删除模型 schema。

### 7.2 `wiki action=apply`：完整而最小的 Wiki 操作闭包

模型只生成语义内容和明确操作，程序执行一次确定性提交；不恢复通用 `write/edit/mkdir` 给 `@Wiki`。

```ts
type WikiOperation =
  | { kind: 'mkdir'; path: string; purpose: string }
  | { kind: 'create'; path: string; content: string; title: string; summary?: string }
  | { kind: 'replace'; path: string; oldText: string; newText: string; replaceAll?: boolean }
  | { kind: 'append'; path: string; content: string; idempotencyKey: string }
  | { kind: 'move'; path: string; destination: string }
  | { kind: 'trash'; path: string }

interface WikiSourceRecord {
  wikiPath: string
  wikiSection?: string
  sourceRole: string
  sourcePath: string
  processedScope: string
}

interface WikiApplyInput {
  action: 'apply'
  reason: string
  basis: string[]
  operations: WikiOperation[]
  sources?: WikiSourceRecord[]
  confirmedPlanId?: string
}
```

这是产品所需的操作闭包，不再为每种 Wiki 任务新增 action：

- `mkdir` 创建用户确实需要且用途明确的目录；目录本身是可导航分区时用 `purpose` 生成最小 `_index.md`，只是其他操作的父目录时不单独生成空业务树。
- `create/replace/append` 覆盖新页面、增量更新和精确修正；`create` 不覆盖，`replace` 必须唯一命中，`append` 必须幂等。
- `move` 同时支持文件和目录；禁止跨 Wiki，目标冲突时停止。
- `trash` 将文件或目录移入应用可恢复回收区，不做永久删除；递归范围必须在预览中完整列出。
- 文件夹整理由 `tree + 一份包含多个 move/mkdir/trash 的 apply` 完成，不增加“organize”工作流 DSL。

模型职责：

- 依据真实证据生成正文、标题、摘要和必要正向 WikiLink。
- 来源型写入只使用用户指定的文件、页面、URL 或对话范围；“本轮”只指当前任务对话。范围变化会改变结论时先问一个问题，不默认扫描 Raw、项目文件或历史对话。
- 将候选材料分为新增、更新、重复、冲突和过程信息；只写新增、用户已确认的更新及用户明确要求保留的过程结论，重复项不重复落盘，冲突未裁决时停止。
- 把会改变事实的页面全部放入同一计划。续写并归档时，必须判断并更新确实变化的当前进度、角色、场景、道具、伏笔和 `hot.md`；没有变化的页面不碰。
- 对来源型写入提供 `sources`；同一事实存在原件和 Markdown 可读副本时，提交两条具有不同 `sourceRole` 的记录。模型生成文字不能冒充原始事实来源，创作正文的来源是其实际使用的大纲/设定/用户材料。
- 事实冲突、正式稿不明或目标归属不唯一时停止并请求用户决定，不借提交工具自行裁决。

程序职责：

- 规范化并校验所有路径；除回收区外，目标必须位于当前唯一 Wiki 根目录。普通内容文件必须是 Markdown，目录操作只作用于 Wiki 内目录。
- Wiki Agent 从实际读取观察注入基线指纹，模型不填写或猜测指纹。在任何写入前执行完整 dry-run，展开全部显式与派生影响，校验重复路径、碰撞、旧值命中数与行号、入链和目录递归范围；任一失败则零写入。`replaceAll` 只有在用户明确确认全部命中都应修改后才能执行。
- 对现有文件和所有派生受影响文件记录并在落盘前再次核对指纹；用户或外部编辑器已改动时整批拒绝，让模型基于新内容重算，不静默覆盖。
- 创建写前恢复清单和最小内容快照，串行执行；任一步失败立即反向恢复。恢复失败时保留应用数据目录中的恢复清单并返回 `recovery-required`，不得宣称完成。
- 新页面登记最近的直属 `_index.md` 或分区 `index.md`；新顶层分区再登记根入口。移动时删除旧导航、增加新导航；移除时删除对应导航。程序只编辑导航列表，不让模型自由重写完整入口。
- 开发 Wiki 的稳定入口可能是 `docs/wiki/CLAUDE.md`：普通正文填充不得修改它；只有新增、移动或移除顶层分区确实改变导航时，程序才可精确编辑其导航列表，不能重写其他说明。
- 移动前解析全部精确入链并在同一事务内重写目标；移除前扫描入链，除导航外仍有现行入链且计划未处理时拒绝。反向链接平时实时计算，不写第二份重复关系。
- 来源型写入正文成功后，才按 `sources` 去重登记现有 `来源索引.md`，包含 Wiki 章节、来源角色、真实来源、已处理范围、指纹和记录时间。项目内来源指纹由程序复用 `wiki evidence` 读取原始字节计算并核对，模型不能提供可信指纹；无法计算时记录 `未计算（原因）`。当前 Wiki 未配置来源索引时不擅自创建，只在回执说明未登记。
- 有实际变更且当前 Wiki 已配置 `log.md` 时，由程序根据最终回执追加一条事实记录；没有 `log.md` 时不强制创建。
- 程序不猜 `hot.md` 或业务状态内容；模型只在当前状态确实变化时提交对应增量修改。未配置 `hot.md` 的 Wiki 不强制创建。
- 完成后重读所有显式和派生文件，重新检查入口可达性、精确入链、未解析链接、目标内容和指纹；精确修正回执必须含目标、修前/修后指纹、命中数和验证结果。只返回 `succeeded/failed/recovery-required`，不把半完成当成功。

### 7.3 导航、状态、来源、日志与双链维护矩阵

这些文件不是所有 Wiki 的固定骨架。是否存在和如何使用由当前 `index.md`、写作规范及现有结构决定；`validate` 必须校验当前 Wiki 声明的合同，不能硬编码每个库都必须有 `hot.md/log.md/来源索引.md`。

| 变更 | 程序必做 | 模型按语义决定 | 禁止 |
| --- | --- | --- | --- |
| 新建页面 | 创建父目录；更新直属分区入口；必要时更新根入口；检查链接 | 正文、正向链接；状态变化时同时改进度/资产/`hot.md`；有来源时给 `sources` | 创建孤儿页、空模板树、整篇重写入口 |
| 更新页面 | 校验旧值和指纹；有实际变化时记现有 `log.md`；重读验证 | 增量正文；来源变化时给 `sources`；状态变化时更新相关事实页 | 覆盖无关段落、重复来源行、无变化刷 `hot.md` |
| 移动/重命名 | 旧导航删除、新导航增加；精确 WikiLink 与来源中的 Wiki 目标同步；全量受影响链接复检 | 只有移动同时改变语义时才改正文 | 只移动文件留下旧入口或断链 |
| 移入回收区 | 列出递归范围；移除导航；扫描现行入链；来源登记保留并标记原 Wiki 目标已回收；保留恢复清单和历史日志 | 用户决定仍被引用页面的替代目标或是否一并处理 | 永久删除、静默删除来源历史、带活动入链强删 |
| 建库/扩展目录 | 保留短根入口；只建必要分区入口；写后验证可达 | 目录用途、放什么/不放什么、父子归属、已确认初始页面和本次不创建项 | 固定小说/开发骨架、猜测性目录、覆盖已有入口 |
| 巡检/复检 | 机械检查断链、歧义、孤儿候选、来源状态；区分现行与历史 | 用户指定主题的语义一致性 | 默认自动修复、把候选当确定错误 |

`index.md/_index.md` 负责路由，业务页负责事实，标准 WikiLink 负责正向关系，反向引用由 Markdown 图实时计算，`来源索引.md` 负责证据，`hot.md` 只负责当前必要状态，`log.md` 只追加已发生事实。任何一项都不能替代另一项。

### 7.4 其余模型可见管理 action

`wiki` 对模型只暴露 `apply/scaffold/validate/audit/status/graph`：

- `scaffold`：复用 `wiki-creator` 的 `WikiCreatePlan` 校验，允许空目录或无入口旧库；计划落盘、根入口存在且结构验证通过才完成。
- `validate`：检查当前 Wiki 实际声明的入口、导航与链接合同，不要求不存在的可选骨架文件。
- `audit`：机械巡检默认只读；用户同时要求修复时，报告只是证据，不能结束任务。
- `status`：返回结构和事实状态的只读汇总，不写 `hot.md`。
- `graph`：图谱是 Markdown 链接派生结果，不允许视觉状态成为事实源。

现有 `evidence/closeout/replace/extend/inspect/context/search` 作为上述 action 的内部实现继续复用；完成迁移后不再让模型面对重叠命令。

`scaffold` 计划还必须满足：用途相同的目录合并；单篇内容使用文件，只有持续增加的同类内容才建立目录；子项属于父目录且同层粒度一致；预览列出本次创建、修改和明确不创建的路径及原因。只有迁移、合并、覆盖、删除或目录归属仍不明确时才要求用户确认，不能把所有普通建库都变成人工多轮。

`audit` 的完整合同：

- 用户指定页面或目录时只检查该范围；未指定时才检查全 Wiki Markdown 与 `来源索引.md` 明确登记的项目文件，不遍历 Raw、附件或全部项目文件。
- 机械巡检使用现有 Markdown 解析器，忽略 fenced code、inline code、HTML 注释和转义语法中的伪链接；检查入口与导航断链、歧义链接、孤儿候选、逃逸链接及来源证据。
- 来源状态固定为“当前一致、来源已变化、来源不存在、无法验证、登记不完整”。来源变化只表示待复查，不代表 Wiki 结论错误；巡检不得自动回填新指纹或自行裁决事实。
- 当前导航断链是确定风险；普通未解析链接和孤儿页只是候选，不建议自动删除。`归档/`、`log.md` 和标记为历史/已替代的页面只列历史卫生，不阻断当前交付。
- 语义一致性只检查用户指定主题；只有同一对象、同一属性和同一时间范围的结论不兼容才报告冲突，并列双方原文与路径，不自行选择哪一方正确。
- 目录文件数、页面长度、命名风格和缺少 frontmatter 不用于判错，除非当前 Wiki 入口或规范明确声明该合同。
- 默认在对话中返回实际检查范围、确定风险、待确认候选、历史卫生、未执行项和真实证据位置。用户明确要求保存时，才用 `apply` 写入已有巡检目录的 Markdown 派生报告；不自动修改原巡检报告。
- 复检逐项返回“已解决、仍存在、新发现、无法验证”；默认不自动修复、不更新业务 `hot.md/log.md`、不补来源、不生成 Canvas/Bases。用户同一指令明确要求巡检并修复时，完成巡检后仅对答案唯一且已授权的机械问题进入 `apply`。

## 8. 完成条件与熔断

### 8.1 正常完成条件

| 任务 | 完成条件 |
| --- | --- |
| 查询 Wiki | 模型基于实际证据返回答案；证据不足时明确列出缺失项也算完成 |
| 根据 Wiki 创作 | 已读取入口要求的必要资料，模型完成创作并列出实际来源 |
| 创建/更新/填充页面 | `apply` 的正文、语义状态、派生导航、来源/日志合同和验证全部通过 |
| 移动/整理 Wiki | 所有目标到位，旧导航清除，新导航和精确入链更新，结构复检通过 |
| 移除页面/目录 | 已获高风险确认，目标进入可恢复回收区，导航和现行入链处理完成 |
| 创建 Wiki | `scaffold` 计划落盘，根入口存在且 `validate` 通过 |
| 巡检 | 指定范围检查完成并返回真实报告；不自动修复未授权问题 |
| 修正 | 修正落盘，目标重读和相关结构复检通过 |
| Skill + MCP + Wiki | Skill 要求的必要步骤完成，MCP 结果已消费；若用户要求写 Wiki，则提交和验证也必须完成 |

统一判定：`requiresMutation=false` 且模型已经回答，或 `requiresMutation=true` 且不存在未完成副作用并通过验证，任务才完成。不得仅凭模型输出像最终答案、达到某轮或调用过写工具判定成功。

### 8.2 停滞收敛

- 重复检索签名不执行。
- 连续两次检索无新增证据后关闭检索。
- 同一失败工具调用不得原参数重试。
- 相同工具、参数、Wiki 指纹和错误码组成失败签名；相同签名不重试。证据、指纹或计划改变时允许继续修正。
- `requiresMutation=false` 时模型返回普通正文可结束；`requiresMutation=true` 时普通正文只能作为待写内容，不能吞掉未完成副作用。
- 事务失败且恢复成功时如实显示零变更；恢复失败时停止自动循环并给出恢复清单位置。

### 8.3 安全熔断

Wiki Agent 保留 `12` 次模型请求/工具决策的硬熔断，只防模型失控，不作为成功条件，也不向模型暗示“必须用完”。正常目标：

| 场景 | 正常模型请求 |
| --- | ---: |
| 明确页面查询 | `1` |
| 入口足够的普通 Wiki 查询 | `1` |
| 需要选择并读取页面 | `2` |
| 写入或更新 Wiki | `2-3` |
| 移动或整理 Wiki | `2-4` |
| Skill + MCP + Wiki | 按必要依赖通常 `3-6` |

达到熔断但未满足完成条件时，必须显示“任务未完整完成”及已完成/未完成项；不得伪装成功。不得因为这一路径把 DirectEngine 的全局上限改成 `12`。

## 9. 上下文与性能合同

- 第一次模型请求只包含当前用户任务、短入口、明确页面、已选 Skill 正文和已选能力摘要。
- 后续只保留当前任务仍相关的入口、证据页和工具观察；旧任务聊天与工具结果不进入 Wiki Agent 状态。
- 已经被新观察替代的搜索摘要可以压缩，不重复发送全部历史工具输出。
- 明确页面和模型同轮选择的多个页面由程序并发读取。
- 不把完整百万字 Wiki、完整文件清单、全部 Skill 目录或全部 MCP schema 发送给模型。
- 不记录用户正文、页面正文、模型 reasoning 或 API Key 到性能日志。
- 记录模型请求数、模型耗时、工具调用数、读取页面数、读取字符数、重复检索拦截数、写入状态和总耗时。

## 10. 写入按钮与 Wiki Agent 的边界

两条写入路径同时存在，但不重复：

### 10.1 用户在消息中直接要求写入

```text
“@Wiki 把这份工作进度写入状态目录并更新入口”
  -> Wiki Agent 读取必要资料
  -> 模型生成 apply
  -> 程序预检、写入、维护入口/状态/来源/日志、验证
  -> 程序回执
```

### 10.2 用户先看回答，再点击“写入 Wiki”

```text
模型已经生成回答
  -> 用户点击“写入 Wiki”
  -> 用户选择目标；该点击就是普通写入授权
  -> 程序直接保存持久化草稿并维护入口/日志
  -> 零模型请求
```

按钮不得重新启动 Wiki Agent；Wiki Agent 也不得取代按钮的零模型写入优势。两条路径共用同一个底层 Wiki 提交函数和验证结果，避免两套写入语义。

## 11. 安全与数据边界

- `@Wiki` 只允许写当前唯一 Wiki 根目录；项目外路径、Raw、Skill 安装目录和应用数据目录拒绝写入。
- 模型输出的路径、内容、查询词和 MCP 参数全部按不可信输入校验。
- 用户在同一消息明确要求 Wiki 写入、创建、增量更新或唯一值替换，就是本任务授权，不重复弹确认。
- 移入回收区、完整覆盖、批量移动、歧义目标、扩大用户指定范围，以及现有平台合同要求审批的 Terminal、付费 MCP 和媒体生成，继续二次确认。
- 用户未要求写入时，查询和创作默认只读。
- 入口或页面内容中的“关闭工具”“修改系统”等文字只作为资料，不改变能力和安全策略。
- 取消任务后终止未完成读取，不开始新的事务；已开始的事务完成当前原子提交或恢复后再返回真实结果。
- Web、Desktop、Mobile 不能因实现平台不同而改变 Wiki 路径、入口和提交语义。
- 当前模型不支持工具调用时，`@Wiki` 只允许程序预取后的单次只读回答；写入、建库、修正和多步任务明确提示更换支持工具调用的模型。

## 12. 先写的红灯

### 12.1 激活与能力隔离

1. 未选 `@Wiki` 的普通任务不创建 Wiki Agent，也不读取入口。
2. 只选 `@Wiki` 时仅暴露 `wiki_context/wiki`；`wiki_search` 不再作为第三个模型工具。
3. `@Wiki + 具体 Skill` 加载该 Skill，不出现抽象 `@Skill`。
4. `@Wiki + 具体 MCP` 只暴露选中的 MCP，不出现抽象 `@MCP` 或其他服务器工具。
5. `@Wiki + Skill + MCP` 能在同一任务中读取 Wiki、执行 Skill 和调用具体 MCP。
6. `@Wiki` 不要求再选 `@文件` 才能创建、修改或维护 Wiki 内页面。

### 12.2 入口与渐进读取

1. `@Wiki 查询角色设定` 在第一次模型请求前只读取根入口，不读取全部 Wiki 正文。
2. 模型选择三个页面后，这三个页面在同一阶段并发读取，未选择页面不读取。
3. `wiki_context(paths)` 不扫描 Wiki 其他页面。
4. `continuity` 只沿入口声明的规范、进度、大纲、上一集和资产路由读取。
5. 入口缺少某一路由时返回 `missingRoutes`，不自动全库兜底。
6. 用户明确指定页面时，该页面正文进入第一次模型请求。
7. 用户明确指定项目内 Raw 文件时只读该文件，不扫描 Raw 目录。
8. 普通查询/创作缺入口时停止；建库允许空目录，修复/整理允许通过 `tree` 重建入口。
9. `tree` 只列路径和指纹，不读取所有页面正文。

### 12.3 检索循环

1. 同一 `wiki_context(action='search')` 参数第二次调用被拒绝，实际文件服务不执行第二次。
2. 两次不同检索均未增加 `evidence` 中的新路径或新指纹后，下一轮不再提供只读检索工具。
3. 新检索命中新的真实页面时允许继续读取该页面。
4. 模型已有足够资料并返回正文时立即完成，不等待固定轮数。
5. 无资料时明确回答缺失，不编造页面或路径。

### 12.4 确定性提交

1. “写入 `状态/工作进度.md` 并更新 Wiki”由一次 `apply` 创建或更新正文并维护最近入口。
2. 新页面已存在时 `create` 失败且不覆盖。
3. `replace` 旧值不命中或多处歧义时整项失败。
4. 相同 `append` 重试不产生重复内容。
5. 任一路径越过 Wiki 根目录时整份提交在写入前失败。
6. 任一 `expectedFingerprint` 变化时整批零写入，不能覆盖外部编辑。
7. 正文后入口写入失败时恢复正文；恢复成功显示零变更，恢复失败显示 `recovery-required` 和恢复清单。
8. `move` 同时更新旧/新导航及精确入链，写后不存在指向旧路径的现行链接。
9. `trash` 有现行入链且计划未解决时拒绝；确认后只进入可恢复回收区，不永久删除。
10. 提交成功后重读正文、状态、导航、来源、日志和受影响链接，返回真实路径和指纹。
11. 用户明确要求普通写入时不重复确认；完整覆盖、回收、批量移动、歧义或扩域必须确认。
12. 写入成功后即使最终模型请求失败，用户仍看到程序生成的成功回执。
13. 点击“写入 Wiki”复用同一提交函数，模型请求计数保持不变。

### 12.5 五 Skill 行为内化

#### `jc-cha-wiki` 等价红灯

1. 项目重要结论有来源映射时返回 Wiki 章节、原始来源和已处理范围；没有映射时明确“原始来源未登记或登记不完整”。
2. 来源登记与 Wiki 正文冲突时并列两者，不把来源记录自动判为权威答案。
3. 首轮短词不足时允许同义词、旧称、文件名或路径词补查；原参数和只换顺序的参数被拒绝。
4. 统计使用实际页面与明确口径；默认不写 Wiki、不更新 `hot/log/来源索引`。
5. 只有用户明确要求保存才写 Markdown 派生报告；只有明确要求且存在稳定关系才生成局部 `.canvas`，不覆盖现有布局，不生成 `.base`。

#### `jc-raw-wiki` 等价红灯

1. “把本轮结论写入 Wiki”只读取当前任务对话和用户指定来源，不读取旧聊天、全部 Raw 或项目全盘。
2. 新增、更新、重复、冲突和过程信息被分别判断；重复不写，未裁决冲突停止，过程内容不默认沉淀。
3. 正文事务成功后才登记来源角色、真实路径、处理范围、指纹和时间；事务恢复后不能留下来源行。
4. 同一事实同时有原件和 Markdown 可读副本时生成两条不同 `sourceRole` 的记录；模型生成内容不能登记为原始事实来源。
5. 只有当前状态确实变化时模型才提交 `hot.md`；有实际写入且现有 Wiki 配置 `log.md` 时程序才追加日志。
6. 普通正文填充不修改 `docs/wiki/CLAUDE.md`；只有顶层导航变化时程序精确修改其导航列表。

#### `jc-jian-wiki` 等价红灯

1. 指定范围巡检不扫描范围外 Wiki；全库巡检也不遍历 Raw、附件和未登记项目文件。
2. 代码块、行内代码、HTML 注释和转义语法中的 WikiLink 不被报告为断链。
3. 来源输出五态：“当前一致、来源已变化、来源不存在、无法验证、登记不完整”；来源变化只列待复查，不自动回填指纹或改正文。
4. 当前导航断链是风险，普通未解析链接和孤儿页是候选，归档与日志问题只列历史卫生。
5. 只有同一对象、属性和时间范围不兼容才报告语义冲突；目录数量、页面长度、命名和 frontmatter 不作为默认错误。
6. 复检逐项输出“已解决、仍存在、新发现、无法验证”，并保留原报告；只要求报告时不自动修复。

#### `jc-xiu-wiki` 等价红灯

1. 精确修正必须有唯一 Wiki Markdown 目标、旧值、新值、`reason` 和 `basis`；缺一项即拒绝。
2. 每次写入先完成零落盘 dry-run，返回目标、行号、命中数和全部派生影响；唯一命中可直接执行，多处命中必须确认 `replaceAll`。
3. 无唯一事实答案时停止，不借机械修正写新事实、规划目录或裁决冲突。
4. 写后返回修前/修后指纹、旧值消失情况、新值存在情况和复检结果。

#### `jc-everything-wiki` 等价红灯

1. 建库只创建用途明确的最小结构；用途相同目录合并，单篇内容用文件，持续增长的同类内容才建目录。
2. 子项属于父目录且同层粒度一致；根入口只导航顶层，分区入口只导航直属内容。
3. 预览列出创建、修改和本次明确不创建的路径及原因；已有入口和正文不覆盖。
4. `validate` 对未配置 `hot.md/log.md/来源索引.md` 的 Wiki 不报固定骨架缺失，只检查当前入口或规范实际声明的文件。

#### 共享关系合同

1. 标准正向 WikiLink 是关系真源，反向引用实时计算；只有当前 Wiki 规范明确要求可见回链时才写第二处关系。

### 12.6 完成条件

1. 查询任务以有来源回答结束，不以达到第五轮结束。
2. 写入任务在正文和入口验证通过前不能报告完整成功。
3. 建库任务在入口缺失时不能报告完成。
4. 巡检任务若用户只要求报告，不因未自动修复而继续循环。
5. 用户要求写入时，模型只返回正文不能结束；未调用 `apply` 必须显示未写入。
6. 相同失败签名不重试；证据或计划变化时允许修正，不使用固定一次修正上限。
7. 连续无收益、重复调用和硬熔断达到边界时明确收敛。
8. 硬熔断只作用于 Wiki Agent，不改变 MCP、媒体、3D、Terminal 或 DirectEngine 其他调用者。

### 12.7 百万字创作

建立约一百万中文字符的固定 Wiki 夹具：短入口、创作规范、当前进度、总纲、当前分集大纲、上一集结尾、相关角色/场景/道具/伏笔及大量无关旧正文。

验证：

1. “`@Wiki 根据入口继续写下一集`”读取必要路由和相关页面，不扫描全部正文。
2. 输出集数、角色状态、场景限制、道具状态和伏笔与来源一致。
3. 工具日志能证明实际读取路径和字符数有界。
4. 资料缺失时列出缺失路由，不用模型常识补项目事实。
5. 同一 Wiki 快照和任务连续运行三次，来源集合稳定；允许创作文字不同。
6. “`@Wiki 根据现有资料写下一集并归档`”必须创建新正文，更新当前进度以及确实变化的角色/场景/道具/伏笔/`hot.md`，维护分集入口和根入口，登记来源并追加现有 `log.md`，最后验证全部受影响链接。

## 13. 冲突设计处置

| 当前或旧设计 | 实施后处理 |
| --- | --- |
| `maxMemorySteps = wikiSelected ? 5 : 3` | 删除 Wiki 特例；Wiki Agent 自己使用完成条件和独立熔断 |
| 请求上限后才 `finalizeWithoutTools` | 保留为 DirectEngine 最后安全兜底，不作为 Wiki 成功路径 |
| `wiki_context` 完整读取所有 Wiki Markdown 后评分 | 替换为入口预检、精确路径批量读取和搜索兜底 |
| 模型分别写正文、再手工更新入口 | 替换为一次 `wiki apply`；模型提交完整语义变化，程序维护导航、来源、日志和链接 |
| 默认 Wiki 查询只能调用一次 `wiki_context` | 退役；允许有证据增益的渐进读取，重复和无增益会被拦截 |
| 所有渐进任务统一六轮 | Wiki 部分退役；Wiki Agent 按完成条件运行，十二次仅作熔断 |
| “写入 Wiki”按钮再次调用模型 | 继续禁止；按钮保持零模型程序写入 |
| 通用 `write/edit/mkdir` 作为 `@Wiki` 写入手段 | 从 `@Wiki` 默认能力移除；共用 Wiki 提交函数 |
| `wiki_context/wiki_search/wiki(search/context)` 重复暴露 | 模型只看 `wiki_context/wiki`；旧实现降为内部复用，迁移完成后删 schema |
| `commit` 只有创建/替换/追加 | 替换为 `apply` 的 `mkdir/create/replace/append/move/trash` 最小操作闭包 |
| 每次精确修正都要求用户审批两遍 | 保留程序内部零落盘 dry-run；唯一命中且范围与用户指令一致时直接提交，多处命中、歧义或扩域才确认 |
| 正文成功、入口失败仍保留正文 | 整批事务失败即恢复；恢复不完整时进入 `recovery-required`，不报成功 |
| `validate` 强制固定 `hot/log/来源索引` | 改为验证当前入口和规范实际声明的合同；可选文件不存在不判错 |
| 五个 Wiki Skill | 继续退役；不恢复运行时依赖 |
| 图谱独立保存知识关系 | 禁止；关系以 Markdown WikiLink 为真源，图谱和反向链接按需计算 |

删除前必须先有新链路测试，并用 `rg` 确认没有其他保留调用者。历史文档、`docs/wiki/log.md`、`docs/wiki/开发/开发历史.md`、`CHANGELOG.md` 和归档证据不删除。

## 14. 最小代码边界

| 位置 | 最小职责 |
| --- | --- |
| `src/runtime/memory/wikiAgent.ts` | 新增薄 Wiki 任务状态、检索签名、证据增益和完成判断；不实现 Provider 或文件工具 |
| `src/runtime/memory/memoryChat.ts` | 用户选 `@Wiki` 时委托 Wiki Agent；删除固定五轮 Wiki 特例 |
| `src/runtime/direct/wikiRuntime.ts` | 精确 `wiki_context`、目录树、`apply`、导航/链接维护、指纹/恢复和写后验证 |
| `src/runtime/direct/creativeToolContract.ts` | 收敛为 `wiki_context/wiki` 两个 schema，增加 `wiki apply` 操作闭包 |
| `src/runtime/direct/desktopProjectTools.ts` | 对接现有 Desktop Wiki 文件适配，不增加另一套语义 |
| `src/runtime/direct/webProjectTools.ts` | 对接现有 Web/Mobile Wiki 文件适配，不增加另一套语义 |
| `src/runtime/direct/directEngine.ts` | 原则上不改；只有现有回调无法承载确定性回执时才加一个最小通用钩子 |
| `src/runtime/memory/__tests__/wikiSkillParity.test.ts` | 将退役五 Skill 的有效契约与现有 JSON 夹具迁成一组原生等价红灯；不读取退役 Skill 正文 |
| 相邻现有测试 | Wiki Agent、Wiki Runtime、工具路由、工作台按钮和三端语义红灯 |

不新增 Agent 框架、工作流框架、数据库、向量索引、后台任务、第二模型、路由模型、Pi/Hermes/OpenClaw 依赖或新的 UI 模式。

## 15. 实施顺序

```text
1. 锁定旧行为与根因
   -> 验证：固定五轮、全库读取、正文写入但入口未更新，以及五个退役 Skill 等价合同先红

2. 将 wiki_context 改成入口预检 + 精确 paths 并发读取
   -> 验证：未选择页面零读取，百万字夹具读取范围有界

3. 增加 wiki action=apply 和共用事务提交函数
   -> 验证：全操作闭包、导航/来源/日志/链接维护、指纹冲突、失败恢复和按钮零模型复用

4. 增加薄 wikiAgent.ts
   -> 验证：检索签名去重、两次无增益收敛、完成条件和十二次熔断

5. memoryChat 按 @Wiki 委托 Wiki Agent
   -> 验证：@Wiki、@Skill + @Wiki、@MCP + @Wiki 及组合能力隔离

6. 删除被覆盖的 Wiki 五轮和手工入口编排
   -> 验证：rg 无保留调用者，DirectEngine 其他任务回归不变

7. 跑自动门禁和固定真实模型矩阵
   -> 验证：查询、创作、提交、建库、巡检、修正和百万字案例
```

不得先新建完整 Runtime 再迁移，也不得先删除旧链路再补功能。每覆盖一个真实入口，立即删除该入口的旧编排。

## 16. 自动验证

至少执行：

```bash
pnpm run test:focused:build
node --test /private/tmp/jc-focused-tests/runtime/direct/__tests__/wikiRuntime.test.js
node --test /private/tmp/jc-focused-tests/runtime/direct/__tests__/directEngine.test.js
node --test /private/tmp/jc-focused-tests/runtime/memory/__tests__/memoryToolRouting.test.js
node --test /private/tmp/jc-focused-tests/runtime/memory/__tests__/wikiAgent.test.js
node --test /private/tmp/jc-focused-tests/runtime/memory/__tests__/wikiSkillParity.test.js
pnpm exec vue-tsc -b --pretty false
git diff --check
```

实施完成前还必须运行仓库现行完整 focused 门禁。真实 Desktop/Web/Mobile、真实 MCP 和真实模型未执行时只能登记为待验收。

## 17. 真实模型验收矩阵

固定模型精确 ID、Provider、reasoning effort、Wiki 快照和新任务，分别执行三次：

| 用例 | 必须结果 |
| --- | --- |
| `@Wiki 读取指定文档并总结` | 一次模型请求完成，来源路径正确 |
| `@Wiki 查询角色设定` | 入口优先，必要时渐进读取，无重复检索 |
| `@Wiki 查询角色设定及原始依据` | 返回 Wiki 章节、来源路径和处理范围；来源缺失或冲突如实标记 |
| `@Wiki 根据大纲续写下一集` | 必要创作资料齐全，无关旧正文不读取 |
| `@Wiki 根据现有资料写下一集并归档` | 新正文、当前进度及确实变化的资产/伏笔/`hot.md`、入口、来源、日志和链接一次闭环 |
| `@Wiki 写入工作进度并更新入口` | 正文、入口、现有日志和验证一次完成，不重复确认普通写入 |
| `@Wiki 把角色页移动到新分区` | 旧/新导航和全部精确入链同步，外部并发修改时零写入 |
| `@Wiki 删除废弃目录` | 显示递归范围并确认，进入可恢复回收区，活动入链未处理时拒绝 |
| `@Wiki 创建一个新 Wiki` | 一次 scaffold 计划落盘，入口可用 |
| `@Wiki 巡检这个目录并复检上次问题` | 范围有界，来源五态和问题分级正确，伪链接被忽略，复检四态完整且默认不修复 |
| `@Wiki 把角色名的唯一错字修正` | 内部 dry-run 后一次提交，回执含行号、命中数和修前/修后指纹；多命中时停止确认 |
| `@Wiki 根据现有资料设计最小目录` | 合并同用途目录，单篇内容不建目录，预览列出不创建项及原因 |
| `@Skill + @Wiki` | Skill 方法与 Wiki 事实同时生效 |
| `@MCP + @Wiki` | 只调用选中 MCP，结果可被写入 Wiki |
| `@Skill + @MCP + @Wiki` | 能按依赖完成，不自动开放其他工具 |

每次记录：模型请求数、工具决策数、读取路径、读取字符数、重复调用拦截、写入文件、入口变更、验证结果和总耗时。未执行的真实模型或平台不得写成通过。

## 18. 完成定义

本 TDD 只有在以下条件全部满足后才能标记为已实施：

1. `@Wiki` 已由独立薄 Wiki Agent 驱动，DirectEngine 没有复制。
2. Wiki 任务以查询、创作、提交、建库、巡检或修正的真实完成条件结束。
3. 固定五轮不再决定 Wiki 成败；十二次只作为失控熔断。
4. `wiki_context` 不再为每个任务完整读取全部 Wiki Markdown。
5. `wiki apply` 覆盖 `mkdir/create/replace/append/move/trash`，一次事务完成语义内容、导航、来源、日志、链接和验证；失败可恢复且不伪报部分成功。
6. “写入 Wiki”按钮保持零模型请求，并复用同一提交函数。
7. `@Wiki + @Skill/@MCP/@文件/媒体/3D/Terminal` 只按用户显式选择组合，不自动扩权。
8. 百万字夹具证明渐进读取范围有界，真实来源可追溯。
9. 五个退役 Skill 的查询、沉淀、巡检、修正和建库合同已由原生测试覆盖，但五个 Skill 本身未恢复。
10. 跨任务聊天记忆、Raw 自动扫描、固定项目骨架、向量数据库和通用 Agent 框架没有恢复。
11. 自动门禁通过；真实模型和真实平台未执行项如实列为待验收。

## 19. 当前状态

截至 2026-08-28，本 TDD 已实施。`@Wiki` 使用独立薄 Wiki Agent，读取与确定性提交分别由 `wiki_context`/`wiki` 驱动；DirectEngine 仅提供通用循环和最终回答拒绝钩子。自动 focused 门禁 1183/1183、Wiki 核心回归和 `vue-tsc` 已通过。真实模型、真实 Desktop/Web/Mobile、真实 MCP 的验收仍需在可用运行环境执行，不能由本地单测替代。

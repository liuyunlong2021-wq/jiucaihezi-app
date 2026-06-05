# 交接文档：Unified Conversation Context Engine + RH 渠道 / 普模型整合

**日期**: 2026-06-04  
**交接人**: Grok (AI 协作者)  
**接收人**: 用户 (by3)  
**核心原则**: 本次会话**严格不改任何代码**（按用户明确指令）。仅输出本交接文档 + 之前创建的 SDD 作为参考。所有实际代码变更、NewAPI 配置、测试验证均由用户自行处理（包括与 RH 渠道一起处理）。

---

## 1. 背景与范围

### 1.1 你引用的 SDD
- 文件: `docs/sdd/unified-conversation-context-engine-final-sdd.md`
- 状态 (SDD 内): “最终方案，待执行”
- 目标: 将对话上下文规模与长期记忆管理收敛为**唯一**的 `Unified Conversation Context Engine`。
  - UI 零感知（第二列会话列表、聊天区输入输出、历史查看保持不变）。
  - 唯一事实源：`messages`、`sessions`、`runtime_segments`、`conversation_run_snapshots`。
  - Mem0 只允许作为 Engine **内部**的语义记忆索引驱动，**绝不暴露**为产品概念或并列模块。
  - 支持极端长文（1w+1w 连续多轮）：chunking、brief、sourceMessageIds 回查、Heavy 策略、continuation、dirty segment 重建、可降级。
  - 硬性铁律：所有 build/afterAssistantMessage 必须经过 Engine；禁止上层绕过。

### 1.2 本次会话上下文（你要求一起处理的 RH 渠道）
- 你已在 NewAPI 侧完成 Trump（川普特供，高倍率 group）上游 CNS 2.0（sd2.mengfactory.cn / openai-compatible）的渠道 + 价格配置。
  - 文档参考: `特朗普seedace2.md`、`特朗普API.md`、`火山引擎seedance2.0.md`。
  - 模型名: seedance-2.0、seedance-2.0-fast（官方无 Pro，按你确认）。
- 目标：在**创作面板**前端 UI 增加 5 个**“普”前缀模型**（普通用户 group=1 可见/可用），与 Trump 特供分离：
  1. 普gpt-image-2
  2. 普gemini-3-pro-image-preview
  3. 普gemini-3.1-flash-image-preview
  4. 普seedance2.0 （映射 seedance-2.0）
  5. 普seedance2.0-fast （映射 seedance-2.0-fast）
- 这些是**纯添加**（additive），**不改任何现有模型定义**（原 gpt-image-2、rh-seedance2-*、seedance-2-0 等保持不变）。
- RH 渠道（rh-adapter + NewAPI 自定义渠道 → RunningHub）与直接 CNS 2.0 兼容层并存。
- **你明确指示**：context engine（本 SDD） + RH 渠道 / 普模型 **一起处理**（由你统筹）。本次 AI 会话只负责写交接文档，不碰代码。

**分离说明**（重要）：
- `Unified Conversation Context Engine` **仅用于聊天区**（useChat.ts、ChatPanel、chatRuntimeConnection）。
- 创作面板 / Canvas 的媒体生成（图片/视频，包括上述 5 个普模型 + RH 系列）走**独立路径**：
  - `src/data/mediaModelCapabilities.ts`（catalog + fields + enabled）
  - `scripts/creation-models/server.mjs`（ROUTES + /api/creation/models 可用性查询 NewAPI channels）
  - `src/composables/useCreation.ts` + `CreationPanel.vue`（模型选择 + 提交）
  - `src/api/media-generation.ts`（generateImage / generateVideo，按 provider / model 路由：RH 用 rh-adapter，direct CNS 用 legacy /api/seedance 或 /v1/videos）
- 两者目前**无代码重叠**。context engine 不影响 creation 可用性；RH 模型不走 chat context。
- 长期：如果 chat 中要调用 creation 工具，或 canvas LLM 节点要复用 context engine，需显式桥接（SDD 中有 canvas 注释提到 future）。

---

## 2. Unified Conversation Context Engine 当前实现状态（基于代码审查 + SDD 对照）

（本次只读审查，未改任何文件。状态基于 2026-06-04 代码基线 + SDD 描述。）

### 2.1 已落地的核心
- **Engine 实例化与调用**：
  - `src/composables/useChat.ts`：单例 `const conversationContextEngine = new ConversationContextEngine()`
  - build 调用：sendMessage / runToolLoop 路径中传入 userInput、currentMessages、selectedSkillId、primaryVaultId、enabledToolNames、modelId、contextBudget、contextMode 等。
  - afterAssistantMessage：在 assistant 输出后记录（带 run snapshot、sourceMessageIds）。
  - 其他：invalidateMessages（ChatPanel 编辑/删除/重试时）、prepareContinuation（长输出 continuation）、deleteSessionContext。
- **Runtime Connection 集成**：
  - `src/runtime/connection/chatRuntimeConnection.ts`：接收 `conversationContextEvidencePrompt` 和 `conversationContext`（含 runtimeSegmentId、loadLevel、memoryHitCount、degraded）。
  - `buildChatRuntimeConnection` 把 context 注入 prompt sections 和 trace。
- **启动与存储**：
  - `src/main.ts`：`startConversationContextWorkers()`（异步 job worker）。
  - `src/stores/sessionStore.ts`：使用 `createConversationContextStorage`。
  - `src/components/chat/ChatPanel.vue`：直接 new Engine 用于 invalidate 和 prepareContinuation。
- **本地驱动**：
  - `localFallbackIndexDriver.ts`：当前生产使用本地 fallback（FTS/关键词 + 内存），符合 SDD “Mem0 只作为内部驱动”的精神（未直接暴露 Mem0）。
- **测试覆盖**（丰富）：
  - `src/runtime/conversationContext/__tests__/`：engine.test.ts、longFormStress.test.ts、continuation.test.ts、oversizedInput.test.ts、memoryIndex.test.ts、rebuildIndex.test.ts、runtimeSegment.test.ts 等 15+ 测试。
  - 覆盖：build 返回 evidence + trace、chunking oversized、Heavy 回查 source chunks、continuation 合并、degrade、dirty rebuild、sqlite maintenance。
  - 架构守卫：`src/runtime/connection/__tests__/architectureGuards.test.ts` 扫描 import 边界（禁止上层直接 import memoryIndex / mem0）。
- **Canvas 预留**：
  - `src/components/canvas/v8/nodes/V8LlmNode.vue` 等有注释：“Future: const engine = new ConversationContextEngine(); ...”
  - 测试中提到 3-way priority rules（prompt-flow + context）。

### 2.2 与 SDD “待执行” 项的对照明细（用户后续可对照实施）
SDD 强调的硬性目标 vs 当前：

**已基本覆盖**：
- 唯一入口（build / afterAssistantMessage）。
- runtime_segment 隔离（Skill / Vault / 关键 Tool 变化切 segment）。
- Oversized Input：chunking + brief + sourceMessageIds 回查（有 oversizedInput.ts + 测试）。
- Long Output Continuation：prepareContinuation + attachContinuationContext（ChatPanel + useChat 有调用）。
- Heavy 策略 + 历史 chunk 回查（memoryIndex + provenance）。
- Local fallback + degrade（engine 内部支持）。
- UI 零感知（ChatPanel 只传消息 id，context 证据只在 prompt 里）。
- 原始消息 append-only 保存（idb + runtime 存储）。

**部分 / 待强化**（SDD 里标“待执行”或高压力场景）：
- **Mem0 作为内部 driver**：当前只有 localFallback。SDD 允许“Mem0 不可用时降级”。如果要接 Mem0（作为语义索引），需在 engine.ts / memoryIndex.ts 内部实现 driver 切换（不暴露给 useChat / connection）。SDD 明确：“Mem0 只能作为 Engine 内部 driver，不是产品概念”。
- **记忆分层衰减 + 结构化 brief**：有 compaction.ts、backfill.ts，但极端 40+ 轮 1w+1w 的“早期决策锚点强制保留 + 3 层（近期事实 / 中期摘要 / 早期锚点）”可能需验证/补强（longFormStress.test 覆盖部分）。
- **dirty segment 重建 + 可中断索引**：有 reconcileIndex.ts、rebuildIndex.ts、sqliteMaintenance.ts。需确保生产能按 segment 增量重建。
- **可观测诊断**：trace 已传（loadLevel、memoryHitCount、degraded、sourceMessageIds）。SDD 要求“清晰的降级、对账、重建和 source 回查路径”。ChatPanel / useChat 有 _conversationContext 透传，可用于日志。
- **Canvas / 其他 runtime 复用**：V8 LlmNode 等有预留，但未全量接 Engine.build()。SDD 目标是 chat 为主，canvas 后续。
- **架构边界**：已有 architectureGuards.test，但需持续运行（import 扫描 + 运行时禁止绕过）。
- **极端场景承诺**：SDD 明确“不承诺永远不丢记忆”，只承诺“可追溯召回 + 可降级 + 可重建”。产品文案需体现（当前可能未全写）。

**运行约束检查点**（用户接手时验证）：
- `buildChatRuntimeConnection` 必须接收 conversationContext（已有）。
- 禁止上层直接访问 memory index（guard test + 代码审查）。
- workers 启动（main.ts）。
- session 切换时清理（已有 deleteSessionContext）。

**测试建议**（不改代码时可手动）：
- 用 longFormStress.test 风格跑连续多轮。
- 切 Skill/Vault 验证新 segment。
- 超长 input + continuation 验证 source 回查。
- 模拟 Mem0 不可用降级。

### 2.3 代码关键文件清单（只读参考）
- Engine 核心：`src/runtime/conversationContext/engine.ts`、`index.ts`、`types.ts`
- 存储/索引：`storage.ts`、`memoryIndex.ts`、`localFallbackIndexDriver.ts`、`runtimeSegment.ts`、`oversizedInput.ts`、`continuation.ts`、`memoryCompaction.ts`、`rebuildIndex.ts` 等
- 连接层：`src/runtime/connection/conversationContextConnection.ts`、`chatRuntimeConnection.ts`、`index.ts`
- 上层调用：`src/composables/useChat.ts`（build + after + record）、`src/components/chat/ChatPanel.vue`（invalidate + prepareContinuation）
- 启动/存储集成：`src/main.ts`、`src/stores/sessionStore.ts`
- 守卫测试：`src/runtime/connection/__tests__/architectureGuards.test.ts`
- 完整测试套件：`src/runtime/conversationContext/__tests__/`（强烈建议接手后先跑全量）

**不碰的边界**（本次 + 推荐）：
- useChat.ts 里对 context 的调用点（已接）。
- canvas 相关（未来）。
- 任何 Mem0 直接 import（禁止）。

---

## 3. RH 渠道 / 普模型部分（你统筹处理，与 context engine 一起）

（本次会话之前已讨论的方案，仅在此总结供你参考。你说“一起处理”，所以 context engine 的 handover + 这个一并给你。**不改代码**。）

### 3.1 当前 Trump 侧（你已完成）
- 按 `特朗普seedace2.md` + `特朗普API.md` + `火山引擎seedance2.0.md`：
  - NewAPI channel 类型 OpenAI，base `https://sd2.mengfactory.cn/openai-compatible`
  - 模型：seedance-2.0、seedance-2.0-fast
  - Group：川普特供（高倍率 8）
  - 价格：按次
- 类似可用于 gpt-image-2、gemini-3-pro-image-preview、gemini-3.1-flash-image-preview（你列出的图片模型）。
- legacy 路径：前端仍部分走 `/api/seedance/v1/videos`（Nginx 直代），不完全走 NewAPI channel（SDD 里已注明需后续打通）。

### 3.2 普版本目标（5 个模型，纯前端可见）
- 目标：普通用户（group=1 token）在**创作面板**能看到/使用带“普”前缀的独立入口。
- 列表：
  1. 普gpt-image-2 （图片，model=gpt-image-2）
  2. 普gemini-3-pro-image-preview （图片）
  3. 普gemini-3.1-flash-image-preview （图片）
  4. 普seedance2.0 （视频，model=seedance-2.0）
  5. 普seedance2.0-fast （视频，model=seedance-2.0-fast）
- **为什么 5 个**：3 个图片（覆盖 gpt + 两个 gemini preview）+ 2 个 Seedance（官方只有 2.0/fast，无 Pro）。
- **实现路径（你后续操作）**：
  1. **catalog 添加**（`src/data/mediaModelCapabilities.ts` 数组末尾追加 5 个新 {}）：
     - id: '普xxx'，label: '普xxx'（完全按“写上普+模型名”）
     - task: 'image' 或 'video'
     - model: 对应 backend 名（gpt-image-2 / gemini-... / seedance-2.0 / seedance-2.0-fast）
     - provider: 'gateway-image'（图片，走 gpt 生成路径）或 'gateway-video'（视频）
     - enabled: true
     - fields: 复制同类现有（gpt 用 size/image；seedance 用 prompt/ratio/resolution/duration/images + generate_audio）
     - 对于视频普：endpoint 可保留 legacy `/api/seedance/v1/videos`（当前代码兼容），或留空走通用 /v1/videos（推荐匹配 md 文档的 NewAPI 兼容用法）。
  2. **availability ROUTES**（`scripts/creation-models/server.mjs` 的 `CREATION_MODEL_ROUTES` 末尾追加）：
     - `{ id: '普gpt-image-2', aliases: ['gpt-image-2'] }`
     - 类似为其他 4 个（aliases 用 backend model 名）。
     - 这样 `/api/creation/models` 会根据你普 group channel 的 status 动态返回 enabled。
  3. **NewAPI 侧**（你已熟练）：
     - 建/用普 group（1）的 channel，models 列表包含上面 5 个名字。
     - 设价格（可比 Trump 低倍率）。
     - 启用。
     - 模型管理注册（精确匹配），可用分组含 1。
     - Trump 通道保持（可同时列这些 model 名，group 选路）。
  4. **生成路径**（已有代码支持，无需新逻辑）：
     - 图片普：走 `generateImage` 的 GPT 分支（/v1/images/generations/edits），传 model 名 → NewAPI 按 group 路由。
     - 视频普：model=seedance-2.0 / fast → 不进 isSeedanceVideo（只认 seedance-2-0-pro 的 legacy），走通用 /v1/videos（完美匹配你 md 文档）。
     - RH 现有模型（rh-seedance2-* 等）继续走 rh-adapter 路径（独立于 direct CNS）。
  5. **UI 自动出现**：
     - `useCreation.ts` + `CreationPanel.vue` 的 modelList / availableModels 会包含新 id（availability enabled 时）。
     - 选择后 fields 驱动参数（时长、参考图等自动支持）。
     - 提交走 mediaTaskStore → generate*。

**与 RH 渠道的关系**（你一起处理）：
- RH 渠道 = rh-adapter（独立 Node/Python 服务，翻译到 RunningHub 356+ 端点）+ NewAPI 自定义渠道（代理 http://rh-adapter:8789）。
- 现有 handoff.md 已记录 RH 模型列表（含 rh-seedance2）。
- 普 seedance2.0 / fast 是 **direct CNS 2.0 兼容层**（sd2.mengfactory.cn），**不是** RH 的 rh-seedance2-*。
- 你可：
  - 让 RH 通道继续服务 rh-seedance2-*（AI App webappId）。
  - 普 channel 单独服务 direct 名字（seedance-2.0 / fast + gpt/gemini image）。
- creation-models 服务会同时看到两个通道的 models，按 status 返回 availability。
- 前端 catalog 里同时有 rh-xxx 和 普xxx，用户按 label 区分（普 vs 特 vs RH 原名）。

**风险提醒（SDD 风格）**：
- Gemini image-preview 是否真的支持 /v1/images/generations（prompt + size + image ref）？按你 Trump API 确认（可能需特定 upstream）。
- Seedance direct 当前部分 legacy bypass（/api/seedance），availability 能控但计费/ group 可能不完全走 NewAPI channel（handoff 里已注）。
- 可用性是“任何 enabled channel 就报 enabled”，执行时才按 group 选 channel。
- 5 个普模型出现后，原有模型列表会变长，考虑排序或分组（可选，后续）。

### 3.3 推荐的交接动作顺序（你统筹）
1. 完成 RH + 普模型的 catalog / ROUTES / NewAPI 配置（上面列的 5 步）。
2. 用普 token 测试创作面板：5 个模型应出现、可配参、可提交生成。
3. 同时推进 context engine：
   - 跑全量 `src/runtime/conversationContext/__tests__/` + architectureGuards。
   - 验证长文场景（用 longFormStress 风格）。
   - 检查 Mem0 driver 是否要接（按 SDD 内部化）。
   - 更新产品文案（“不承诺永远不丢记忆，但可追溯+可重建”）。
4. 验证 chat + creation 隔离：chat 用 context engine，creation 用 availability + RH/CNS。
5. 如果 canvas LLM 要复用 context，参考 V8 LlmNode 注释 + SDD。
6. 部署/运维：更新 我的服务器运维手册.md（参考 handoff.md 风格），加 普 channels + context workers 监控。

---

## 4. 关键文件 & 变更点（仅供你参考，不执行）

（纯信息，不作为 patch。）

**Context Engine 相关**（已部分落地）：
- src/runtime/conversationContext/（engine, storage, memory*, oversized*, continuation*, tests/）
- src/runtime/connection/conversationContextConnection.ts + chatRuntimeConnection.ts
- src/composables/useChat.ts（build/after 调用 + _conversationContext 透传）
- src/components/chat/ChatPanel.vue（invalidate/prepare）
- src/main.ts（workers）
- src/stores/sessionStore.ts
- 守卫：src/runtime/connection/__tests__/architectureGuards.test.ts

**RH / 普模型相关**（待你加）：
- src/data/mediaModelCapabilities.ts（追加 5 个 普 对象 + isRemoved 豁免）
- scripts/creation-models/server.mjs（追加 5 个 ROUTES）
- NewAPI 后台（普 group channel + 价格 + 模型管理）
- 可选更新：我的服务器运维手册.md、特朗普seedace2.md（记录 普 channels）

**已有参考 SDD**（你可合并）：
- 本目录下 `add-pu-prefixed-models-creation-panel-sdd.md`（之前输出，描述了 5 个模型的 catalog 结构、ROUTES、NewAPI 侧）。
- unified-conversation-context-engine-final-sdd.md（你引用的主 SDD）。
- rh-adapter.md、rh-model-full-pipeline-sdd.md（RH 侧）。

---

## 5. 风险、边界、后续建议

- **隔离风险**：chat context engine 与 creation media 路径独立。不要尝试把 RH 模型“塞”进 chat context（除非未来做 tool 调用 creation）。
- **Mem0 边界**：SDD 铁律——只内部 driver。当前 localFallback 已满足核心。如果要接，严格在 engine 内部实现 driver 接口。
- **可用性 vs 执行**：/api/creation/models 报 enabled 不等于能成功生成（group 匹配在 NewAPI 侧）。
- **极端长文**：SDD 承诺是“可追溯”，不是“零丢失”。接手后用 longFormStress 持续压测。
- **Canvas 未来**：V8 节点有预留，context engine 可复用（参考 SDD + canvas v8 sdd）。
- **测试/守卫**：保持 architectureGuards.test 常绿。新增普模型后，补充 creation 相关测试（不影响 context）。
- **文档同步**：本交接 + handoff.md + 各 sdd 一起维护。更新后可发给团队。

---

## 6. 行动清单（给你自己用）

- [ ] 读完 unified-conversation-context-engine-final-sdd.md 全篇 + 本交接。
- [ ] 跑 context 相关测试 + long form 场景验证。
- [ ] 按 3.2 完成 5 个普模型的 catalog/ROUTES/NewAPI（与 RH 渠道一起）。
- [ ] 用普/Trump token 交叉测试创作面板 + chat（确认隔离 + 可用性）。
- [ ] 检查 Mem0 是否需要作为内部 driver 落地（参考 SDD 2.4/2.5）。
- [ ] 更新运维手册 + 产品文案（记忆边界）。
- [ ] 如果需要，基于本 SDD 写 TDD / 实施 PR（context engine 剩余项 + 普模型）。
- [ ] 定期 re-run architectureGuards + 边界扫描。

---

**备注**：
- 所有“写代码”部分均留给你自己（或后续会话）。本次输出仅文档。
- 如果需要我基于当前审查再输出更细的“待办 checklist”或“context engine 剩余项优先级”，直接说。
- RH 渠道 + 普模型的具体 catalog 片段，可参考之前输出的 add-pu-...-sdd.md（已存在于 docs/sdd/）。

这个文档可直接作为团队交接材料使用。祝处理顺利！如果有遗漏或需要补充，随时问。
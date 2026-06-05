# Codex App-Server 协议集成重磅升级交接文档（2026-06）

**目标受众**：Codex（或其他 AI 编码代理 / Grok Build / Claude 等）。**请务必第一步完整阅读本文件 + 项目根目录的 `CLAUDE.md` + `AGENTS.md`**。

**文档目的**：这是独立的重磅升级交接文档。用户已决定将 openai/codex 作为产品“心脏/发动机”，通过其官方 **app-server 协议** 实现 agentic 执行，同时**完全保留**产品的手动哲学、UI 优势、Skill 系统、知识库（Vault）、工具、媒体/画布/创作面板能力。

**核心原则（绝不违反）**：
- 一切手动显式：用户先在 UI 选择 Skill / Knowledge / Tool / Model，Connection 只组装。
- 保留产品最强部分：富客户端 UI + Skill（官方格式） + Vault（手动添加/整理/召回） + 工具（显式开启） + 媒体/画布/创作面板（41 节点 + 生成 + 导出）。
- Codex 只负责“发动机”部分：agent 循环、sandbox 执行、plan mode、approvals、rollout 持久化、模型调用上下文组装。
- 升级友好：**永远不修改 Codex 源码**。只驱动官方二进制 / 协议。Codex 升级时只换二进制，你的客户端适配协议变化即可。
- 哲学一致：当前用户输入最高优先；Knowledge 只做 evidence；Tool 默认不暴露；严禁自主黑盒 Agent Loop。

**Codex 源码研究位置**（用于理解协议/实现，不修改）：
- `/Users/by3/Documents/Codex/codex` （完整 clone，已同步官方最新）
  - 当前最新 commit: 55aa071b1 (2026-06-05) "[codex] Forward turn moderation metadata through app-server (#25710)"
  - 总提交数: 7164
  - 大小: ~193M
- **已确认官方仓库更新**：本地 clone 已通过 `git fetch + pull --ff-only` 同步至 https://github.com/openai/codex origin/main 最新版（2026-06-05）。最近 app-server 相关改进包括 "Forward turn moderation metadata through app-server"。升级产品时直接使用官方二进制（curl/npm/brew），本地 clone 仅用于协议研究。
- 重点阅读（协议/客户端相关）：
  - `README.md`（高层定位，明确鼓励外部 rich clients 如 VSCode 扩展）
  - `codex-rs/app-server/README.md`（**圣经**：完整 Lifecycle、Thread/Turn/Item 原语、turn/start 参数（model、sandboxPolicy、approvalPolicy、skills 等）、Skills 章节、inject_items、Approvals、Events、初始化）
  - `sdk/typescript/` 和 `sdk/python/`（官方 SDK 示例，最快建立链接的参考代码）
  - `codex-rs/docs/protocol_v1.md`（底层心智模型：Session/Task/Turn、Op/Event）
  - `codex-rs/app-server-protocol/`（schema，可运行 `codex app-server generate-ts --out DIR` 生成类型）
  - `codex-rs/core/src/context/`（available_skills_instructions.rs、permissions_instructions.rs 等，理解 skill/tool/context 如何作为 fragment 组装进 prompt）

---

## 1. 项目核心定位（严格来自 CLAUDE.md）

韭菜盒子 Studio 是 **本地优先的纯手动 AI 工作台桌面应用**（Tauri 2 + Vue 3 + Pinia + TS + Vite）。

**北极星**：用户手动选择 Skill/Knowledge/Tool/Model，Connection 只组装成可追踪运行。**绝不**发明自主 Agent、黑盒 Workflow、AI 自动决策。

**对话上下文最终架构（2026-06-03 定版，铁律）**：
- UI 层（ChatPanel、Skill 仓库、知识库、工具仓库、画布、编辑器、创作面板）
- ConversationRuntime（冻结 RuntimeSnapshot：会话、历史、显式选择、当前 user message）
- ContextBuilder（按 token budget 产 ContextPacket：recent messages、selectedSkills、vaultEvidence、attachments、omittedItems）
- PromptAssembler（messages + tools + trace）
- Executor（流式 + 工具循环）
- RunTrace（记录本轮实际看到什么）

**禁止**：
- 知识库自动写入（只用户手动）。
- 临时对话、通用 Agent Loop。
- 当前用户输入被 Skill 压制。
- 任何并行 Agent/Memory/Prompt 系统。

当前核心能力（保留并增强）：
- 多模型对话 + 手动选择条（SkillPickerBar、VaultPickerBar）
- Skill 系统（官方 SKILL.md + 进化）
- 知识库 Vault + Wiki + 召回（手动添加/整理）
- 创作面板（媒体生成 13+ 模型）
- 41 节点 Vue Flow 画布（执行引擎）
- 本地工具（browser、devProject、content、office、ToMD、transcribe、narrate 等）
- 对话上下文引擎（ConversationContextEngine：chunk、memory index、continuation、ContextBoundary）
- 富编辑器 + 导出（docx/pdf/html/md，高保真）

**技术现状**：
- 本地能力中心（LocalCapabilitySetup）：检测 browser/file/shell/project/ffmpeg 等。
- 工具暴露：getLocalContentToolDefinitions + toolConnectionAdapter（intent 检测 + risky filter）。
- 媒体处理：localContentTools.ts（inspect/plan/process/transcribe/subtitle_burn/video_narrate，ffmpeg + Whisper）。
- Canvas 执行：canvasExecutor + runtimes（llm/media/tool）。
- 所有外部链接用 openExternal，所有 HTTP 用 safeFetch / Rust bridge。

**硬性要求**（每次变更后）：
- `pnpm run test:focused` 必须通过（556+ 测试）。
- `npx vue-tsc -b` 类型检查。
- 手动验证：手动选择必须被尊重；知识库不被污染；用户输入最高优先。

---

## 2. 升级愿景：Codex 作为可独立升级的“心脏/发动机”

**问题**：当前内部 LLM 编排 + 上下文组装 + 工具循环在产品侧自己实现，复杂、难以跟上先进 agent 能力（plan mode、强 sandbox、rollout 持久化、skill/app 加载）。

**解决方案**（用户已决定）：
- **保留**：所有手动 UI、Skill 系统、Vault（知识库）、显式 Tool、媒体/画布/创作面板、ConversationRuntime（用于手动流程和 snapshot 冻结）。
- **委托给 Codex**：agentic 执行的“发动机”部分（Turn 循环、模型上下文组装、sandboxed tool/patch 执行、plan/approval 事件、rollout 持久化、MCP 扩展）。
- **链接方式**：通过 Codex **官方 app-server 协议**（JSON-RPC 2.0）驱动。**绝不修改 Codex 源码**。
- **每轮组装**：用户手动选择 → 你的映射层 → 构造 Codex `thread/start` + `turn/start`（items + overrides）。
- **结果**：Codex 内部完成 prompt 组装 + 模型调用 + 工具执行循环，你只消费事件更新 UI。
- **升级**：Codex 独立升级（换二进制 / npm / brew / rebuild 他们的 repo）。你的客户端只适配协议变化（他们提供 generate-ts / schema）。

这完美匹配产品哲学：手动选择在前，Codex 只执行“这一轮你给它的配置”，当前用户输入仍最高优先。

**Codex 官方定位确认**（来自 clone README + app-server/README）：
- 明确鼓励外部客户端：“the interface Codex uses to power rich interfaces such as the Codex VS Code extension”。
- 核心原语：Thread（持久对话）、Turn（一轮执行）、Item（输入输出，可注入）。
- 支持 per-turn 覆盖：model、sandboxPolicy、approvalPolicy、permissions profile、skills、additional context。
- 明确支持 Skills（显式传 path）、inject_items（完美用于你的 Vault 证据）、Approvals 事件（接你的手动确认）、PlanDelta（plan mode）。
- 传输：stdio（推荐，JSONL）、unix socket。
- SDK：typescript / python（可直接参考或用于原型）。

---

## 3. 映射规则（你的手动选择 → Codex 请求）

**原则**：
- 每轮请求必须从**当前用户显式选择 + 当前 snapshot** 现组装。
- Skill → explicit skill item 或 skill instructions fragment。
- Knowledge（Vault evidence）→ `thread/inject_items` 或 turn context（用你的 ContextBuilder 选 top evidence + chunks）。
- Tool → sandboxPolicy + approvalPolicy + permissions（你的 enabled tools 决定策略）。
- Model → 直接 override。
- 用户输入 → items 里最后（最高优先）。
- 上下文注入不污染 Codex 自己的 rollout（用 inject_items）。

**具体 per-turn 请求构造示例**（基于 app-server README）：
```json
// thread/start （或 resume）
{
  "method": "thread/start",
  "params": {
    "cwd": "...",
    "sandboxPolicy": "workspace-write",  // 从你的 Tool 选择映射
    "approvalPolicy": "on-request",      // 强制手动
    "permissions": { "profile": "your-tool-profile" },
    "model": "claude-sonnet-4-6"         // 从选择
  }
}

// turn/start
{
  "method": "turn/start",
  "params": {
    "threadId": "...",
    "input": [  // items
      { "type": "text", "text": "用户当前输入..." },
      { "type": "skill", "skill": { "name": "your-skill", "path": "/path/to/SKILL.md" } },
      // 更多 skill / mention
    ],
    "additionalContext": [ /* 你的 vault evidence 文本 */ ],
    "settings": {
      "model": "...",
      "sandboxPolicy": "...",
      "approvalPolicy": "..."
    }
  }
}
```

**注入知识**：`thread/inject_items`（推荐，不启动新 turn）或 turn/start 里带 context。

**知识库 Wiki 结构内容如何链接（官方说明 + 像 Skill 一样的渐进式披露）**：
官方 Codex **没有特定“Wiki结构”或“知识库 Vault”的文档**（grep 整个 clone 的 app-server、protocol、docs、core/context/skills 无 "wiki"、"vault"、"RAG"、"knowledge base" 针对性；只有一个 sample SKILL.md 说 "Knowledge bases outside developers.openai.com are outside this route"，强调外部 KB 单独处理。skills 有专属支持，但 general knowledge 是通过通用 context 注入）。
- **主要机制**（来自 app-server/README、protocol、core-skills/render.rs）：
  - `thread/inject_items`：追加 raw Responses API items（message with output_text）到历史，不启动新 turn。items 持久化到 rollout，进入模型请求。
    示例（官方 README）：
    ```json
    { "method": "thread/inject_items", "id": 36, "params": {
        "threadId": "thr_123",
        "items": [ { "type": "message", "role": "assistant", "content": [{ "type": "output_text", "text": "Previously computed context." }] } ]
    } }
    ```
  - turn/start input items + additionalContext/context 字段。
  - Core `ContextualUserFragment` 系统：很多 *instructions.rs（available_skills_instructions、environment_context、permissions_instructions、hook_additional_context 等），用 role "developer" + 特殊 tags 模块化注入 prompt。
  - 持久：rollout + memories + goals。`thread/compact/start` 支持管理。
- **是否能像 Skill 一样 + 渐进式披露？ 是的，最优解就是“客户端模拟 Skill 的 progressive disclosure” + Codex 的注入/fragments**：
  - Codex 自己的 skills 正是这个设计（从 core-skills/src/render.rs "How to use a skill (progressive disclosure)"）：
    - Discovery: 列表 name + description + path（或 aliases + roots）。
    - Trigger: 用户命名 ($SkillName) 或任务匹配 description → 必须用。
    - Use: 决定用后，打开 SKILL.md，只读足够跟进 workflow 的部分。
    - References (references/、scripts/、assets/): 只 load 具体需要的文件，不要 bulk-load。
    - Context hygiene: keep small，summarize long sections，只 load 直接 linked 的；avoid deep reference-chasing；pick only relevant；announce which/why/order；if skip say why。
    - Multiple: minimal set。
    - Safety: if can't apply cleanly, state issue, fallback。
  - Sample SKILL.md in Codex 也强调外部 KB 单独，作为 "references" 提供，而不是混在官方 docs。
- **你的 Vault Wiki 的最优链接方案**（不改 Codex，全在你的映射层 + evidence planner，完美契合手动 + progressive）：
  - 把 "Vault Wiki 使用" 作为一个或多个 **explicit "knowledge skill"**（像你的其他 Skill 一样，有自己的 SKILL.md 或 instructions fragment，描述 "how to use the provided Vault Wiki evidence with structure and sources"）。
    - 在每轮可用 skills 列表中暴露（via available_skills 或 explicit item），带 name/description/path（虚拟或指向你的 meta skill）。
    - Trigger: 如果 query 匹配 "知识/证据/回忆/参考 wiki" 等，模型必须用。
  - **渐进式披露**（客户端做 discovery 和 load，只 disclose 需要的 "references" 给 Codex）：
    - 用你的 `buildVaultEvidencePlan` / `rankVaultKnowledge` / ContextBuilder 做 "discovery"：先看 query intent，选相关 Wiki "topics" 或 index（像 skills list）。
    - 只 "load" 具体的 wiki pages + sourceChunks（用 sourceChunkIds 回查 raw，保持 traceable）。
    - 格式化成 "references"：markdown 结构 + 来源锚点（你的 wiki schema：人物/关系/事件线 或 案由/文书）。
    - **注入**：用 `thread/inject_items` 追加为 raw "message" items（或作为 skill 的 "references" 内容）。只注入当前 subset（像 skill 只 load 具体文件）。
    - CLAUDE.md / config：作为该 "knowledge skill" 的 instructions fragment 注入（用 tags 或并入）。
    - 模型侧：看到 skill list → trigger → "open" instructions（你的 meta skill） → 只用注入的 "references"（Wiki chunks），cite sources，必要时 "backtrack"（但实际由你提供）。
    - Hygiene：你的 planner 控制 "keep small"，只 relevant；Codex 的 context budget 会 truncate 如果太多（有 warning）。
  - 示例（每轮）：
    - 可用 skills 包括 "vault-wiki-knowledge" (description: "Use the injected Vault Wiki evidence for facts, with sources and structure. Progressive: only relevant sections.").
    - 如果 trigger，inject 1-4 个具体 wiki pages/chunks as items。
    - 模型用 skill 的 instructions + injected items。
  - 这就是 "像 Skill 一样的链接 + 渐进式披露"：Skill 提供 instructions + trigger + hygiene 规则；Wiki 内容是 "references"，由客户端 progressive 选择和注入（discovery -> load only needed -> disclose）。
- **卡帕西的关于Wiki的一些文档**：
  - 在整个 /Users/by3/Documents（包括 jiucaihezi-app、Codex clone、其他项目如 openclaw、测试知识库）grep "卡帕西" 或 "Kapasi" **无匹配**。可能指你其他项目（如 MY-openclaw-main/extensions/memory-wiki/skills/wiki-maintainer、docs/memory-wiki.md、feishu wiki、或 /0421 测试/知识库/wiki）中的 Wiki 维护/结构文档，或外部 "卡帕西" 的 Wiki 设计（或许是社区中某位关于知识库结构化的人）。
  - 如果是 openclaw 的 memory-wiki：它有 wiki skills for maintain，类似你的 Vault compile + evidence。结合 Codex：用 skill for "wiki-maintain/use" instructions，inject 作为 context。
  - 最优解仍是上面：客户端 (jiucaihezi) 的 evidence plan 做 progressive（像 Codex skill 的 discovery + only load needed references），通过 inject_items 提供结构化 Wiki 作为 "prebuilt context"，用 skill fragment 教模型怎么用（cite、structure、back to raw）。
  - 这避免 Codex 需要理解你的 raw/wiki/CLAUDE.md 格式（外部 KB 单独处理，如 Codex sample 所说），同时保留你的手动 + traceable 优势。
- **在 handover 实现中**：在 mapper 里加 "buildWikiAsSkillReferences"：用你的 planner 选，格式化 items，inject；暴露 "vault-wiki" as skill（instructions from your CLAUDE.md for vault + progressive rules from Codex render）；在 turn/start 带 explicit skill item if needed。Codex 会按其 skill progressive 规则 "use" 它 + 注入的内容。
- **验证**：Codex 回答引用 Wiki 时，有来源；只注入相关（token 控制）；手动选择 KB 仍控制是否/哪些注入；无 AI 自动写入 Vault。

**同时使用 Skill + Wiki-like-skill 会不会冲突？ Codex 如何处理多个 Skill？（针对你的问题）**
- **不会冲突**：Codex 明确支持同时使用多个 skills（包括你的普通 Skill + "vault-wiki-knowledge" meta-skill）。
  - 从 core-skills render.rs：
    - "If multiple skills apply, choose the minimal set that covers the request and state the order you'll use them."
    - "Announce which skill(s) you're using and why (one short line)."
    - Trigger: "Multiple mentions mean use them all. Do not carry skills across turns unless re-mentioned."
    - Hygiene per skill: each loads only its needed references (progressive), skills coordinate in prompt (minimal + order).
  - Wiki content (injected via inject_items as "prebuilt context" items) is additional evidence that all skills can reference (like skill references).
  - In app-server protocol: skills are explicit per turn (in items or settings), context injection (inject_items) is independent, so multiple skills + Wiki context coexist in the Turn prompt.
  - Priority/overlap: Codex chooses "minimal set"; you can specify in your "vault-wiki" skill instructions "when combined with other skills, prioritize X, cite sources".
  - No built-in conflict resolution beyond that; the model (guided by instructions) handles.

**卡帕西（karpathy/autoresearch）的 Wiki 相关**：
- 已 clone 检查 /tmp/autoresearch：核心是 `program.md` 作为 "super lightweight 'skill'" 提供给 agent 的 instructions/context。
- README: "The `program.md` file is essentially a super lightweight "skill"."
- Agent 被 prompt 读 program.md，然后自主研究（编辑 train.py 等）。
- 没有重型 "Wiki" 结构；它是 "program.md" 作为动态 research org "code" / context。
- 启发：把你的 Vault Wiki 编译成类似 "program.md" 的结构化 "knowledge program"（markdown with sections + sources），然后作为 skill 的 "references" 或 via inject_items 提供给 Codex。
- 结合 Codex skill progressive：用 skill 机制暴露 "autoresearch-vault-wiki" skill，其 program.md-like instructions 指导 "treat the injected Wiki as your research context, use progressively (only relevant sections), iterate with evidence"。
- 最优：客户端 (jiucaihezi) 的 evidence plan 做 "discovery"（select relevant Wiki like skill list），inject 作为 context（like references），skill fragment 提供 the "how to use" (progressive rules from Codex + autoresearch style)。

这部分已更新到本文档。官方（Codex skill 机制 + autoresearch program.md 启发）最优就是**客户端用 skill 包装 Wiki 规则（progressive + program style），inject 实际 Wiki 作为 references/context**。多个 skill 完全支持（minimal set + hygiene），Wiki 作为额外 evidence 无冲突。你的手动 planner 控制 disclosure。完美。

如果需要读 autoresearch 具体 program.md 或 Codex 更多（e.g. skills.rs for turn_skills），告诉我。继续聊或更新 handover？直接说。

如果 "卡帕西" 指特定文件，告诉我路径，我可以读来看看是否有额外洞见。继续聊或更新 handover？直接说。
- `item/completed`（tool call / file edit / media） → 回写 canvas output、creation gallery、chat 附件。
- Approvals → 弹你的 confirmAction UI，发回批准。
- `turn/completed` + PlanDelta → 更新 UI 状态、trace。
- 完整 rollout 由 Codex 管理，你只 sync 关键事件到 sessionStore。

**混合模式**：
- 纯手动流程（无 agent）：继续用现有 direct LLM + local tools + ConversationContextEngine。
- Agentic 流程（chat/canvas/creation 中的规划执行）：手 off 给 Codex thread/turn。
- Canvas LLM 节点 / tool 节点：直接用 Codex 驱动（支持 skill + context 注入）。
- Creation 规划：用 Codex 做 storyboard / pipeline 规划。

---

## 4. 实现路线图（交给 Codex 代理执行的步骤）

**第一步（必须）**：完整阅读 CLAUDE.md + AGENTS.md + 本文档 + clone 里的 app-server/README.md + protocol_v1.md + SDK examples。

**第二步**：探索 Codex 协议与你的产品对齐
- 读 clone 里的 app-server/README.md（Lifecycle、turn/start 所有可选字段、Skills 章节、inject_items、Events、Approvals）。
- 读 sdk/ 下的 examples（TS 推荐用于理解）。
- 确认你的本地 clone 路径和启动方式：`codex app-server --stdio`。
- 研究如何 spawn（参考现有 mcp_spawn_stdio、local servers 在 src-tauri 和 runtime/tools）。

**第三步**：设计客户端 wrapper（Tauri 优先，纯新增不破坏现有）
- 推荐位置：`src/runtime/codex/` 或 `src/services/codexAppServerClient.ts` + Rust 侧命令。
- 功能：
  - 启动/管理 `codex app-server` 进程（stdio 通信，处理 backpressure）。
  - 实现 JSON-RPC client（或用官方 SDK 包一层）。
  - `initialize` with clientInfo（name: "jiucaihezi-studio"）。
  - 映射函数：`buildCodexTurnRequest(runtimeSnapshot, currentSelections, vaultEvidence)`。
  - 事件消费：订阅 item deltas / approvals / turn completed，emit 到你的 eventBus / UI。
- 认证：支持 ChatGPT OAuth 或 API key（Codex 自己处理）。
- 本地能力：扩展 LocalCapabilitySetup，检测 `codex` 二进制（类似 ffmpeg）。

**第四步**：映射层（连接你的手动选择）
- 在 toolConnectionAdapter / runtimeConnection 中添加 "codex" intent 检测（关键词：agent、规划、执行、解说等）。
- 每轮 agent 运行前：从 UI 选择器收集 Skill/Knowledge/Tool/Model → 冻结 snapshot → 调用映射 → 发 turn/start。
- Skill：传 path + 内容（或 references）。
- Knowledge：用你的 rankVaultKnowledge 选 top → inject_items。
- Tool：从 enabled 映射到 sandboxPolicy / approvalPolicy / permissions。
- Model：直接传。
- 对于 canvas/creation：类似，在 executor 里 hand off。

**第五步**：UI 集成（保留你的手动哲学）
- ChatPanel：agent 开关时走 Codex 路径，审批弹窗用你现有的 confirmAction。
- Canvas：LLM 节点 / tool 节点 / runninghub 等，可配置用 Codex 驱动。
- CreationPanel：规划阶段用 Codex（通过 turn/start 注入你的 media models / pipeline）。
- 事件回写：deltas → MessageBubble 渐进；tool results → canvas output / gallery / attachments。
- 状态：Codex threadId 存到你的 session/rollout 关联；支持 resume/fork。

**第六步**：本地工具与 Codex 执行桥接
- Codex 的 sandbox 执行适合 coding / shell / patch。
- 你的本地工具（browser、devProject、content、narrate）保留：可通过 MCP 暴露给 Codex，或在 approval 后由你本地执行（Codex 只规划）。
- 媒体 pipeline：Codex 可规划 storyboard，实际渲染/烧录还是你的本地 ffmpeg + models。

**第七步**：升级与兼容
- 永远用官方 Codex（二进制 / npm / brew）。
- 客户端用 `codex app-server generate-ts` 保持 schema 同步。
- 协议变化：只在你的 wrapper 层处理（v1/v2、experimental opt-in）。
- 测试矩阵：不同 Codex 版本 + 你的手动选择场景。

**第八步**：测试与验证（硬性）
- `pnpm run test:focused` 全过。
- 手动验证：
  - 手动选择 Skill/KB/Tool/Model 必须被每轮 turn/start 尊重。
  - Vault 不被 Codex 自动写入。
  - 审批走你的 UI。
  - Plan mode 事件正确显示。
  - 升级 Codex 后仍能跑（用最新二进制测试）。
- 性能：Codex 进程生命周期管理（启动/关闭/错误恢复）。
- 安全：路径 sanitize、sandbox 策略、用户确认所有副作用操作。

**关键文件（surgical 修改，优先新增）**：
- 新增：src/runtime/codex/（client、mapper、types）、src-tauri/src/codex_bridge.rs（spawn + ipc）。
- 最小修改：src/composables/useChat.ts（agent 路径分支）、src/runtime/connection/toolConnectionAdapter.ts（intent + localContent 扩展）、canvas runtime（LLM/tool 节点可选 Codex）、localCapabilities.ts（新增 codex-engine）。
- 文档：更新 CLAUDE.md / AGENTS.md 提及（可选）。
- 示例：docs/ 下新增集成示例或 SDD。

**成功标准**：
- Codex 作为发动机：agentic 任务（规划、迭代工具调用、带审批的执行）全部由 Codex 完成。
- 你的手动层完整：选择 UI、Skill、Vault、Tools、Media 能力 100% 保留且更强。
- 可升级：Codex 独立更新，你的 app 继续工作。
- 哲学一致：无黑盒；每轮都从用户显式手动选择开始；知识库纯手动。

---

## 5. 风险与缓解（Codex 代理必须处理）

- 协议演进：用官方 schema 生成 + 版本 pin + 回退。
- 哲学漂移：映射层强制“每轮从 RuntimeSnapshot + 手动选择开始”，加 trace 记录。
- 性能/进程：Tauri 侧健壮 spawn + 健康检查 + graceful shutdown。
- 知识库污染：只用 inject_items，不让 Codex 写 Vault。
- 工具执行：Codex sandbox + 你的本地工具双保险；高风险操作必经用户确认。
- 范围蔓延：先做 chat agent 模式 → canvas LLM 节点 → creation 规划 → 全流程。每次只改必要文件。

---

## 6. 参考资料（Codex 代理第一步必须读）

**Codex 侧（clone 内）**：
- `codex-rs/app-server/README.md`（完整 API + 示例 + Skills + inject_items）。
- `sdk/typescript/README.md` + examples（最快“建立链接”的代码）。
- `docs/protocol_v1.md` + `codex-rs/app-server-protocol/src/protocol/common.rs`（UserTurn / turn/start 定义）。
- `codex-rs/core/src/context/available_skills_instructions.rs` 等（理解 skill 如何注入）。
- 运行 `codex app-server generate-ts` 生成类型。

**产品侧**：
- `CLAUDE.md`（全文，尤其是 1.3.1 对话上下文最终架构、核心对象、标准调用链）。
- `AGENTS.md`（审查范围、已知问题、协作三方关系）。
- `src/composables/useChat.ts`、`src/runtime/connection/toolConnectionAdapter.ts`、`src/utils/localContentTools.ts`、`src/components/canvas/runtime/canvasExecutor.ts`（现有 agentic 路径）。
- `docs/sdd/` 下相关（unified-conversation-context-engine-final-sdd.md, narratoai-integration.md 等）。
- 本地能力中心 `src/utils/localCapabilities.ts` + `src/components/settings/LocalCapabilitySetup.vue`。

**构建/测试**：
- `pnpm run test:focused`
- `pnpm tauri dev`（测试 spawn + 协议）
- 手动端到端：手动选 Skill+Vault+Tool → agent 运行 → 审批 → 结果回写 canvas/creation。

---

**Codex 代理执行本任务时请严格**：
1. 先读 CLAUDE.md + AGENTS.md + 本文档。
2. 只做必要修改（surgical）。
3. 所有变更必须通过 test:focused + 手动验证（手动选择必须被尊重）。
4. 保持 Codex 可独立升级。
5. 输出清晰的 RunTrace / 变更说明。

**用户当前状态**：已克隆 Codex 源码用于研究；app-server 协议已确认可行；决定保留手动 UI + 核心能力，只把 agent 执行委托给 Codex。

**立即开始**：从读 app-server/README.md + 设计 Tauri spawn + JSON-RPC wrapper 开始。

这份文档独立完整，可直接交给 Codex 代理完成实现。需要补充细节时再问我（只聊不改）。 

加油，这会让你的产品同时拥有“世界级手动工作台 UI” + “世界级 agent 发动机”。 

（文档生成于 2026-06，基于当前 clone 状态。）
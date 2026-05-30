# Connection System Execution Plan

> Date: 2026-05-30
> Product: 韭菜盒子 Studio
> Required execution mode: follow this plan task by task. Do not stop after each small step unless a verification fails or a product decision is blocked.

**Goal:** Build the final Connection system that connects official Skill, independent Knowledge, global Tool, Superpower selection, and LLM execution into one traceable runtime.

**Architecture:** Connection is not an Agent and not a Workflow module. It is the runtime protocol that assembles an explicit run from user-controlled choices: Skill, Knowledge, Tool exposure, model, and optional Superpower recommendation. Workflow remains inside official `SKILL.md` content.

**Tech Stack:** Vue 3, Pinia, TypeScript, Vitest, Tauri v2, local SQLite storage.

---

## Execution Progress

- [x] Task 0 baseline and deletion inventory
- [x] Task 1 SkillConnection official Skill integration
- [x] Task 2 ToolConnection integration
- [x] Task 3 KnowledgeConnection integration
- [x] Task 4 RuntimeConnection prompt assembly
- [x] Task 5 SuperpowerConnection boundary
- [x] Task 6 useChat integration first pass
- [x] Task 7 ChatPanel integration first pass
- [x] Task 8 Canvas KnowledgeConnection routing
- [ ] Task 9 full legacy deletion sweep
- [ ] Task 10 final architecture audit

## Product Rules

- 搭子就是 official Anthropic Skill: required `SKILL.md`, optional `references/`, `scripts/`, `assets/`.
- Skill format must not be replaced by a private Agent schema.
- Superpower is allowed. It gives users a free/auto-selection space when they do not know which Skill to choose.
- Tools are global execution capabilities. They can be used directly, by Skill-guided runs, or by Superpower-guided runs.
- Knowledge is independent Wiki/Vault evidence. It can be combined with Skill, Tool, and LLM, but it does not decide workflow.
- LLM executes the assembled runtime request. It does not own product flow.
- Workflow is not an independent product module. Workflow lives inside the selected Skill instructions.

## Final Target Flow

```text
User chooses or asks Superpower to recommend
↓
SkillConnection resolves official Skill content and resources
↓
User chooses Knowledge, or leaves Knowledge off
↓
KnowledgeConnection recalls Wiki/Vault evidence as evidence only
↓
ToolConnection exposes allowed global tools with source trace
↓
RuntimeConnection assembles Skill + Knowledge + Tool + LLM trace
↓
useChat streams LLM response and executes requested tool calls
↓
Result is produced according to Skill instructions
```

## Files To Create Or Modify

- Create: `src/runtime/connection/skillConnectionAdapter.ts`
- Create: `src/runtime/connection/toolConnectionAdapter.ts`
- Create: `src/runtime/connection/knowledgeConnectionAdapter.ts`
- Create: `src/runtime/connection/chatRuntimeConnection.ts`
- Create: `src/runtime/connection/superpowerConnection.ts`
- Modify: `src/runtime/connection/types.ts`
- Modify: `src/runtime/connection/skillConnection.ts`
- Modify: `src/runtime/connection/toolConnection.ts`
- Modify: `src/runtime/connection/knowledgeConnection.ts`
- Modify: `src/runtime/connection/runtimeConnection.ts`
- Modify: `src/composables/useChat.ts`
- Modify: `src/components/chat/ChatPanel.vue`
- Modify: `src/components/canvas/runtime/canvasLlmRuntime.ts`
- Modify: `package.json`
- Test: `src/runtime/connection/__tests__/*.test.ts`
- Test: existing `src/utils/__tests__/useChatSendMessage.test.ts`

## Task 0: Baseline And Deletion Inventory

**Status:** completed.

- [x] Update `CLAUDE.md` to the final product baseline: 韭菜盒子 Studio, official Skill, independent Knowledge, global Tool, LLM runtime, Connection core.
- [x] Delete wrong or conflicting architecture documents.
- [x] Add `docs/sdd/connection-cleanup-inventory.md`.
- [x] Add `docs/sdd/connection-system-sdd.md`.
- [x] Create initial Connection landing zone under `src/runtime/connection/`.
- [x] Add initial unit tests for SkillConnection, ToolConnection, KnowledgeConnection, and RuntimeConnection.
- [x] Run focused tests.

Verification:

```bash
pnpm run test:focused
```

Expected: all focused tests pass.

## Task 1: SkillConnection Official Skill Integration

**Purpose:** Make SkillConnection the only place that turns a selected 搭子 into runtime instructions.

**Rules:**

- Preserve official Skill anatomy.
- Accept inline `SKILL.md` content and `skill://` public Skill references.
- Keep `SKILL.md` body as the Skill workflow source.
- Resource directories are progressive disclosure metadata, not automatic prompt stuffing.

Steps:

- [ ] Write tests for resolving inline Skill content.
- [ ] Write tests for resolving `skill://` references with an injected loader.
- [ ] Implement `skillConnectionAdapter.ts`.
- [ ] Export a typed resolver result that includes `SkillConnection` and load errors.
- [ ] Keep existing behavior untouched until the adapter tests pass.
- [ ] Run focused tests.

Verification:

```bash
pnpm run test:focused
```

Expected: SkillConnection tests pass.

## Task 2: ToolConnection Integration

**Purpose:** Move tool exposure decisions behind ToolConnection while preserving global tool availability.

**Rules:**

- Do not make tools owned by Skills.
- Preserve user-requested and global tool use.
- Skill can guide tool usage through its instructions.
- ToolConnection records why tools are exposed.

Steps:

- [ ] Add tests for deduping and source tracing of available tools.
- [ ] Add `toolConnectionAdapter.ts`.
- [ ] Move or wrap `buildAvailableTools()` so Connection can request the same definitions.
- [ ] Keep `useChat.ts` as the executor of tool calls during this phase.
- [ ] Run focused tests.

Verification:

```bash
pnpm run test:focused
```

Expected: ToolConnection tests pass and existing chat tests still pass.

## Task 3: KnowledgeConnection Integration

**Purpose:** Make Knowledge attachment a first-class Connection instead of scattered prompt injection.

**Rules:**

- Knowledge is evidence only.
- Knowledge does not execute tasks.
- Knowledge does not decide workflow.
- Knowledge can be off, quick, standard, or deep.

Steps:

- [ ] Add tests for evidence rendering and off mode.
- [ ] Add `knowledgeConnectionAdapter.ts`.
- [ ] Wrap existing `recallKnowledgeWithTrace()` behind KnowledgeConnection.
- [ ] Preserve current recall ranking behavior.
- [ ] Replace direct canvas Knowledge recall after chat path is stable.
- [ ] Run focused tests.

Verification:

```bash
pnpm run test:focused
```

Expected: KnowledgeConnection tests pass and evidence remains clearly labeled as evidence.

## Task 4: RuntimeConnection Assembly

**Purpose:** Compose SkillConnection, KnowledgeConnection, ToolConnection, Superpower state, and LLM metadata into one runtime object.

**Rules:**

- RuntimeConnection is a traceable run object.
- RuntimeConnection is not a workflow engine.
- Prompt section order is deterministic.
- Each section has source metadata for audit.

Steps:

- [ ] Add tests for section order: product rules, Skill, Knowledge, Tool, user task.
- [ ] Add `chatRuntimeConnection.ts`.
- [ ] Build an assembled prompt from existing `assembleContextPrompt()` behavior.
- [ ] Preserve old chat behavior behind a temporary fallback.
- [ ] Run focused tests.

Verification:

```bash
pnpm run test:focused
```

Expected: RuntimeConnection tests pass.

## Task 5: SuperpowerConnection Boundary

**Purpose:** Keep Superpower, but stop ChatPanel from owning its routing and prompt composition.

**Rules:**

- Superpower remains optional and user-visible.
- Superpower may recommend/select a Skill.
- Superpower does not erase user control.
- Superpower output becomes a Connection source, not a hidden product flow.

Steps:

- [ ] Add `superpowerConnection.ts`.
- [ ] Move `buildSuperpowersPrompt()` usage behind this boundary.
- [ ] Move route/chain state adaptation behind this boundary.
- [ ] Keep UI confirmation behavior in ChatPanel.
- [ ] Remove direct prompt assembly from ChatPanel after tests pass.

Verification:

```bash
pnpm run test:focused
```

Expected: all focused tests pass and Superpower UI behavior is unchanged.

## Task 6: useChat Integration

**Purpose:** Make `useChat.ts` consume RuntimeConnection instead of owning Skill/Knowledge/Tool assembly.

**Rules:**

- `useChat.ts` keeps streaming, SSE parsing, message persistence, and tool-result loop.
- Connection owns Skill/Knowledge/Tool/trace assembly.
- Keep a temporary compatibility branch until tests cover the new path.

Steps:

- [ ] Extend `SendMessageOptions` with optional `runtimeConnection`.
- [ ] Use `runtimeConnection` prompt when present.
- [ ] Use `runtimeConnection.tools` when present.
- [ ] Record `runtimeConnection.trace`.
- [ ] Remove duplicated assembly helpers only after the new path is used by ChatPanel.
- [ ] Run focused chat tests.

Verification:

```bash
pnpm run test:focused
```

Expected: existing send-message behavior remains stable.

## Task 7: ChatPanel Integration

**Purpose:** Make ChatPanel collect UI state and call Connection, instead of assembling prompts directly.

**Rules:**

- ChatPanel can still show Superpower pipeline UI.
- ChatPanel can still select Skill and Vault.
- ChatPanel should not directly build final system prompts.

Steps:

- [ ] Replace `buildSystemPrompt()` with `buildChatRuntimeConnection()`.
- [ ] Pass `runtimeConnection` into `sendMessage()`.
- [ ] Keep direct media-generation path untouched.
- [ ] Keep parallel model sending behavior.
- [ ] Run focused tests and type check if feasible.

Verification:

```bash
pnpm run test:focused
pnpm run type-check
```

Expected: focused tests pass; type-check passes or reports only unrelated existing issues.

## Task 8: Canvas Knowledge Connection

**Purpose:** Remove direct Knowledge recall from canvas LLM runtime.

Steps:

- [ ] Find direct Knowledge recall in `canvasLlmRuntime.ts`.
- [ ] Route it through KnowledgeConnection.
- [ ] Keep canvas node behavior unchanged.
- [ ] Add or update a focused unit test if a test harness exists.

Verification:

```bash
rg "recallKnowledge|recallKnowledgeWithTrace" src/components/canvas src/composables src/runtime/connection
pnpm run test:focused
```

Expected: canvas no longer bypasses KnowledgeConnection.

## Task 9: Delete Legacy Scattered Connection Code

**Purpose:** Finish the deletion-first mandate after replacements are live.

Delete or remove from main flow:

- Direct Skill prompt resolving in `useChat.ts`.
- Direct Knowledge prompt section assembly in `useChat.ts`.
- Direct Tool exposure assembly in `useChat.ts`.
- Direct Superpower prompt assembly in `ChatPanel.vue`.
- Any stale architecture docs that describe private Agent/L2 as the product center.

Preserve:

- Actual tool executors.
- Actual vault retrieval primitives.
- Official Skill files.
- Superpower user-facing capability.

Verification:

```bash
rg "buildSystemPrompt|resolveSelectedSkillPrompt|buildKnowledgeEvidenceSection|buildAvailableTools|buildSuperpowersPrompt" src
pnpm run test:focused
pnpm run type-check
```

Expected: remaining matches are either Connection files or lower-level leaf functions with explicit names.

## Task 10: Final Audit

Steps:

- [ ] Run focused tests.
- [ ] Run type-check.
- [ ] Scan `src/runtime/connection/` for private Agent terminology.
- [ ] Scan docs for wrong anti-Superpower or anti-global-tool claims.
- [ ] Summarize changed files and residual risks.

Verification:

```bash
pnpm run test:focused
pnpm run type-check
rg "L2 Agent|通用 Agent|自主决策 Agent|anti-Superpower|Tool 只" docs CLAUDE.md src/runtime/connection
```

Expected: no conflicting product claims remain, except where quoted as prohibited designs with the correct context.

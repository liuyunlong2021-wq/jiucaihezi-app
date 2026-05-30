# Connection System SDD

> Date: 2026-05-30
> Product baseline: 韭菜盒子 Studio uses official Anthropic Skills as 搭子. Connection is the runtime protocol that connects Skill, Knowledge, Tool, Superpower, and LLM.

## Goal

Build a coherent Connection system by first deleting scattered, ad hoc connection logic, then rebuilding the connection layers in this order:

1. SkillConnection, following official Anthropic Skills behavior.
2. ToolConnection, naturally exposed through Skill/tool use and also available globally.
3. KnowledgeConnection, connecting Wiki/Vault evidence to a task.
4. RuntimeConnection, composing Skill, Knowledge, Tool, Superpower, and LLM into one traceable run.

## Non-Goals

- Do not invent a private Skill schema.
- Do not convert Skills into custom Agents.
- Do not delete bottom-layer capabilities such as vault retrieval, tool executors, model runtimes, or official skill files.
- Do not make Connection a new autonomous Agent or Workflow product.

## Current Problem

Connection-like behavior exists today, but it is scattered:

- `ChatPanel.vue` directly handles Superpower prompt assembly, routing, and chain invoke.
- `useChat.ts` directly resolves Skill prompts, recalls Knowledge, exposes Tool definitions, assembles context, records trace, and runs tool loops.
- Canvas LLM runtime directly calls Knowledge recall.
- Older SDD documents describe L2 Agent or anti-Superpower directions that conflict with the final product baseline.

The project has useful lower-level capabilities. The problem is not the capabilities; the problem is that wiring between them is not centralized.

## Deletion Principle

Delete or isolate scattered connection relationships. Preserve leaf capabilities.

Preserve:

- Official Skill storage and loading.
- `public/skills/**`.
- Vault/Wiki storage and retrieval primitives.
- Tool registry and tool executors.
- LLM runtime and model/provider request utilities.
- Superpower as a user-selectable recommendation/auto-selection capability.

Delete or replace:

- Wrong architecture documents that fight the current baseline.
- Direct ChatPanel responsibility for Skill/Knowledge/Tool prompt composition.
- Direct `useChat.ts` responsibility for assembling Skill/Knowledge/Tool/Trace.
- Direct Knowledge recall from non-Connection runtimes.
- Old L2 Agent schema/design as a product direction.

## Target Architecture

```text
UI
↓
RuntimeConnection
├── SkillConnection
├── ToolConnection
├── KnowledgeConnection
├── SuperpowerConnection
└── LlmConnection
↓
LLM Runtime
```

## Phase 0: Delete Wrong Direction Docs

Delete:

- `docs/sdd/jiucaihezi-studio-product-architecture.md`
- `docs/sdd/agent-vault-gpt55-upgrade-design-draft.md`

Reason:

- The first document was created from an incorrect interpretation that treated Superpower and global tools as violations.
- The second document centers L2 Agent as a product direction; the new baseline centers official Skill plus Connection.

Keep:

- `CLAUDE.md` as the current architecture baseline.
- This SDD as the execution baseline.

## Phase 1: Cut Scattered ChatPanel Connection Logic

Target files:

- `src/components/chat/ChatPanel.vue`
- `src/composables/useSkillRouter.ts`
- `src/data/superpowerSkills.ts`
- `src/stores/agentStore.ts`

Desired end state:

- ChatPanel collects UI state and user input.
- ChatPanel calls Connection runtime.
- Superpower can still recommend/select, but ChatPanel does not directly assemble Superpower prompts or process chain invoke.

Initial action:

- Move direct prompt/routing responsibilities behind a future `SuperpowerConnection` boundary.
- Until the new boundary exists, isolate old routing as legacy and mark it for removal from the main request path.

## Phase 2: Cut Scattered useChat Connection Logic

Target files:

- `src/composables/useChat.ts`
- `src/utils/contextAssembly.ts`
- `src/utils/chatRunAudit.ts`
- `src/composables/useBrain.ts`

Desired end state:

- `useChat.ts` receives an assembled runtime request.
- `useChat.ts` handles streaming, cancellation, message persistence hooks, and low-level tool result round trips.
- Connection owns Skill, Knowledge, Tool, and trace assembly.

Initial action:

- Extract pure connection helpers first, with tests.
- Avoid behavior changes until tests cover the current assembly order.

## Phase 3: Build SkillConnection First

Target behavior:

- Use official Anthropic Skill anatomy:
  - `SKILL.md` is required.
  - Frontmatter metadata is used for discovery.
  - Body instructions are loaded when the Skill is active.
  - `references/`, `scripts/`, and `assets/` are progressive-disclosure resources.
- Do not modify the Skill format.
- Expose enough metadata for RuntimeConnection trace.

Initial files:

- `src/runtime/connection/skillConnection.ts`
- `src/runtime/connection/types.ts`
- `src/runtime/connection/__tests__/skillConnection.test.ts`

## Phase 4: Build ToolConnection

Target behavior:

- Tools remain global capabilities.
- ToolConnection records which tools are exposed and why:
  - global
  - user-requested
  - skill-suggested
  - superpower-suggested
- SkillConnection may suggest tool usage through Skill instructions, but tools are not owned by Skills.

Initial files:

- `src/runtime/connection/toolConnection.ts`
- `src/runtime/connection/__tests__/toolConnection.test.ts`

## Phase 5: Build KnowledgeConnection

Target behavior:

- Knowledge remains independent Wiki/Vault.
- Support modes:
  - `off`
  - `quick`
  - `standard`
  - `deep`
- Support primary and secondary vaults.
- Knowledge evidence is always evidence, not system instruction.

Initial files:

- `src/runtime/connection/knowledgeConnection.ts`
- `src/runtime/connection/__tests__/knowledgeConnection.test.ts`

## Phase 6: Compose RuntimeConnection

Target behavior:

RuntimeConnection answers:

- Which Skill was active?
- Was it selected by user or Superpower?
- Which Knowledge was connected?
- Which tools were exposed?
- Which LLM runtime was used?
- What prompt sections were assembled?
- What trace should be shown in the UI?

Initial files:

- `src/runtime/connection/runtimeConnection.ts`
- `src/runtime/connection/assemblePrompt.ts`
- `src/runtime/connection/__tests__/runtimeConnection.test.ts`

## Verification Strategy

Use TDD for production code changes:

1. Write failing unit tests for each Connection layer.
2. Implement the smallest possible layer.
3. Run focused tests.
4. Only then wire into `ChatPanel.vue` / `useChat.ts`.

For deletion-only steps:

- Verify with `rg` that deleted documents or direct references are gone.
- Verify the app still type-checks after each integration phase.

## Risk Controls

- Do not delete lower-level executors.
- Do not remove Superpower capability; move it behind Connection.
- Do not remove tool access; centralize tool exposure.
- Do not remove Knowledge recall; centralize Knowledge attachment.
- Do not alter official Skill file format.


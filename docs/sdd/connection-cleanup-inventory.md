# Connection Cleanup Inventory

> Date: 2026-05-30
> Purpose: list scattered connection responsibilities before wiring the new Connection runtime into the app.

## Delete / Replace From Main Flow

These are connection responsibilities that should stop living in UI or chat runtime files.

### ChatPanel.vue

Current scattered responsibilities:

- Builds system prompt for normal Skill and Superpower modes.
- Calls `routeMessage()` directly.
- Calls `processChainInvoke()` and `confirmChainInvoke()` directly.
- Knows Superpower pipeline state.

Target:

- ChatPanel only collects UI state and user input.
- ChatPanel calls RuntimeConnection.
- Superpower choice happens behind SuperpowerConnection.

### useChat.ts

Current scattered responsibilities:

- Resolves selected Skill prompt.
- Calls Knowledge recall.
- Builds Knowledge evidence section.
- Decides available tools.
- Assembles prompt sections.
- Records run trace.
- Runs the tool loop.

Target:

- RuntimeConnection owns Skill/Knowledge/Tool/Trace assembly.
- `useChat.ts` receives an assembled request and handles streaming/tool result round trips.

### canvasLlmRuntime.ts

Current scattered responsibilities:

- Calls Knowledge recall directly from canvas LLM runtime.

Target:

- Canvas LLM nodes call Knowledge through KnowledgeConnection or RuntimeConnection.

## Preserve As Leaf Capabilities

These are not deletion targets.

- `public/skills/**`
- `src/stores/agentStore.ts` storage/loading primitives
- `src/composables/useBrain.ts` and `src/utils/vault*` retrieval primitives
- `src/utils/toolRegistry.ts`
- `src/utils/localContentTools.ts`
- `src/utils/browserTools.ts`
- `src/utils/devProjectTools.ts`
- `src/composables/officeTools.ts`
- `src/utils/llmRuntime.ts`
- `src/utils/api.ts`
- `src/services/newApiClient.ts`
- `src/services/newApiAuth.ts`
- Superpower as a user-selectable recommendation/auto-selection capability

## New Connection Landing Zone

Created:

- `src/runtime/connection/types.ts`
- `src/runtime/connection/skillConnection.ts`
- `src/runtime/connection/toolConnection.ts`
- `src/runtime/connection/knowledgeConnection.ts`
- `src/runtime/connection/runtimeConnection.ts`

Tests:

- `src/runtime/connection/__tests__/skillConnection.test.ts`
- `src/runtime/connection/__tests__/toolConnection.test.ts`
- `src/runtime/connection/__tests__/knowledgeConnection.test.ts`
- `src/runtime/connection/__tests__/runtimeConnection.test.ts`

## Next Integration Order

1. Replace direct `buildSystemPrompt()` in `ChatPanel.vue` with a RuntimeConnection request builder.
2. Move `resolveSelectedSkillPrompt()` from `useChat.ts` to SkillConnection integration.
3. Move `recallKnowledgeWithTrace()` usage from `useChat.ts` into KnowledgeConnection integration.
4. Move `buildAvailableTools()` usage from `useChat.ts` into ToolConnection integration.
5. Replace `recordChatRunTrace()` with RuntimeConnection trace.
6. Replace direct canvas Knowledge recall with KnowledgeConnection.


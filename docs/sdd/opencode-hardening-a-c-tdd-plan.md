# OpenCode Hardening A-C TDD Plan

**Goal:** make P0-P3 pass the strict OpenCode official behavior acceptance rule after the subagent audit.

**Architecture:** move OpenCode chat state toward event/part/timeline driven rendering without embedding the official Web UI. Keep all adaptation in the Jiucai shell: `src/opencodeClient/**`, `src/composables/useChat.ts`, `src/components/chat/**`, and `src/stores/sessionStore.ts`.

**Tech Stack:** Vue 3, Pinia, TypeScript, `@opencode-ai/sdk/v2`, Node test runner.

---

## Hardening A: P0 + P1 Backbone

### Task A1: Official Session Status And Abort State

**Files:**
- Modify: `src/composables/useChat.ts`
- Modify: `src/components/chat/AgentStatusBar.vue`
- Test: `src/components/__tests__/chatMessagePresentation.test.ts`

- [x] Add failing tests that require:
  - `AgentPhase` includes `cancelling`
  - `session.status` handles `busy`, `retry`, and `idle`
  - `stopStream()` sets `cancelling` before calling official abort
  - abort errors are surfaced instead of silently swallowed
- [x] Run: `pnpm run test:focused:build && pnpm run test:focused:run`
- [x] Implement minimal code to pass.
- [x] Re-run focused tests.

### Task A2: Timeline Rows Drive Production Rendering

**Files:**
- Modify: `src/components/chat/ChatPanel.vue`
- Modify: `src/components/chat/MessageBubble.vue`
- Modify: `src/opencodeClient/timelineRows.ts`
- Test: `src/components/__tests__/chatMessagePresentation.test.ts`
- Test: `src/opencodeClient/__tests__/messageMapper.test.ts`

- [x] Add failing tests that require:
  - `ChatPanel.vue` calls `buildOpenCodeTimelineRows(...)`
  - assistant part rows are rendered separately from user message rows
  - thinking/error/compaction rows have dedicated rendering paths
- [x] Run focused tests and verify RED.
- [x] Implement minimal production wiring.
- [x] Re-run focused tests.

### Task A3: No Part Flattening Into Message Content

**Files:**
- Modify: `src/opencodeClient/messageMapper.ts`
- Modify: `src/components/chat/ChatPanel.vue`
- Modify: `src/components/chat/MessageBubble.vue`
- Test: `src/opencodeClient/__tests__/messageMapper.test.ts`
- Test: `src/components/__tests__/chatMessagePresentation.test.ts`

- [x] Add failing tests that require:
  - non-text parts keep `content === ''`
  - `openCodeParts` alone makes an assistant message visible
  - `part.type === 'error'` is visible before final sync
  - `tool_result` part is visible before final sync
- [x] Run focused tests and verify RED.
- [x] Implement minimal mapper/filter changes.
- [x] Re-run focused tests.

## Hardening B: P2 Inputs And System Events

### Task B1: Structured Prompt Request Parts

**Files:**
- Modify: `src/opencodeClient/session.ts`
- Modify: `src/composables/useChat.ts`
- Modify: `src/components/chat/ChatPanel.vue`
- Test: `src/opencodeClient/__tests__/session.test.ts`
- Test: `src/components/__tests__/chatMessagePresentation.test.ts`

- [x] Add failing tests that require:
  - `fireOpenCodePrompt()` accepts typed `parts`
  - file/image/agent inputs are forwarded as OpenCode request parts
  - plain text remains `{ type: 'text' }`
- [x] Run focused tests and verify RED.
- [x] Implement minimal typed request parts.
- [x] Re-run focused tests.

### Task B2: System Event Rows

**Files:**
- Modify: `src/opencodeClient/timelineRows.ts`
- Modify: `src/components/chat/ChatPanel.vue`
- Modify: `src/composables/useChat.ts`
- Test: `src/opencodeClient/__tests__/messageMapper.test.ts`
- Test: `src/components/__tests__/chatMessagePresentation.test.ts`

- [x] Add failing tests that require:
  - agent switch renders as a system row, not message content
  - compaction renders as a system row, not message content
  - retry and step end/fail events are represented
- [x] Run focused tests and verify RED.
- [x] Implement minimal event-to-row support.
- [x] Re-run focused tests.

## Hardening C: P3 Session Cache And Prefetch

### Task C1: Link Local Sessions To OpenCode Sessions

**Files:**
- Modify: `src/stores/sessionStore.ts`
- Modify: `src/composables/useChat.ts`
- Test: `src/opencodeClient/__tests__/session.test.ts`
- Test: `src/components/__tests__/chatMessagePresentation.test.ts`

- [x] Add failing tests that require:
  - local session metadata can store `openCodeSessionId`
  - loading a local session restores `activeOpenCodeSessionId`
  - loading history no longer unconditionally clears OpenCode session state
- [x] Run focused tests and verify RED.
- [x] Implement minimal metadata bridge.
- [x] Re-run focused tests.

### Task C2: Wire Prefetch Into Session Switching

**Files:**
- Modify: `src/components/chat/ChatPanel.vue`
- Modify: `src/opencodeClient/session.ts`
- Test: `src/components/__tests__/chatMessagePresentation.test.ts`
- Test: `src/opencodeClient/__tests__/session.test.ts`

- [x] Add failing tests that require:
  - `prefetchOpenCodeSession()` is called on session switch when an OpenCode session id exists
  - cached OpenCode messages are reused with `preferCache`
  - fallback to local history remains when no OpenCode session id exists
- [x] Run focused tests and verify RED.
- [x] Implement minimal prefetch wiring.
- [x] Re-run focused tests.

## Final Gate

- [x] `pnpm exec vue-tsc -b`
- [x] `pnpm run test:focused:build`
- [x] `pnpm run test:focused:run`
- [x] `pnpm run test:tauri`
- [x] Manual smoke: normal message, streaming, tool part, error part, abort, attachment, session switch.

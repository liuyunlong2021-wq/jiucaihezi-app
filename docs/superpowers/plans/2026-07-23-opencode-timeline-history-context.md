# OpenCode Timeline History Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Translate OpenCode v1.18.4's active-turn waiting state, paginated message history, and server-owned context compaction visibility into the Vue Desktop client.

**Architecture:** Keep OpenCode `session/message/part/status` as the sole authority. The Vue timeline projects a busy status onto its current user turn instead of creating an assistant placeholder. Session history starts with the official initial page size and prepends cursor pages without replacing event-confirmed entries. Context remains a sidecar concern; the client refreshes its official context endpoint after a turn and surfaces compaction or overflow parts.

**Tech Stack:** Vue 3, Pinia, TypeScript, `@tanstack/vue-virtual`, OpenCode SDK/runtime v1.18.4, Node test runner.

---

### Task 1: Active Turn Thinking Row

**Files:**
- Modify: `src/opencodeClient/timelineRows.ts:276-376`
- Modify: `src/opencodeClient/__tests__/messageMapper.test.ts`
- Modify: `src/components/chat/ChatPanel.vue:988-1007,3793-3836,3995-4014`
- Test: `src/components/__tests__/chatMessagePresentation.test.ts`

- [ ] **Step 1: Write failing projection tests**

```ts
const rows = buildOpenCodeTimelineRows([{ id: 'u1', role: 'user', content: '继续', timestamp: 1 } as any], {
  sessionStatus: 'busy',
  activeUserMessageId: 'u1',
})
assert.deepEqual(rows.map(row => row.type), ['user', 'thinking'])
```

Add a second assertion with a visible assistant text part and the same active user id; it must not add a second thinking row.

- [ ] **Step 2: Run the focused compiled test and observe failure**

Run: `pnpm run test:focused:build && node --test /private/tmp/jc-focused-tests/opencodeClient/__tests__/messageMapper.test.js`

Expected: the busy user-only turn produces only `user` because `sessionStatus` and `activeUserMessageId` do not exist yet.

- [ ] **Step 3: Implement the official projection contract**

Extend `buildOpenCodeTimelineRows` input with `sessionStatus?: 'busy' | 'idle' | 'retry'` and `activeUserMessageId?: string`. After emitting each user row, append `thinking:${message.id}` only when that id is active, status is `busy`, and no visible assistant text/reasoning part belongs to the current turn. Preserve existing assistant part rows and error rows.

In `ChatPanel.vue`, compute the active user id from the last OpenCode user message while `isStreaming`. Pass it and the store status into `openCodeRowsForMessage`. Render its thinking row directly below the user message, using the existing `cp-opencode-thinking` styling. Delete the global `typing-dot` fallback and its CSS.

- [ ] **Step 4: Run focused timeline and UI presentation tests**

Run: `pnpm run test:focused:build && node --test /private/tmp/jc-focused-tests/opencodeClient/__tests__/messageMapper.test.js /private/tmp/jc-focused-tests/components/__tests__/chatMessagePresentation.test.js`

Expected: zero failures; source contracts require the user-turn projection and reject `typing-dot`.

- [ ] **Step 5: Commit task**

```bash
git add src/opencodeClient/timelineRows.ts src/opencodeClient/__tests__/messageMapper.test.ts src/components/chat/ChatPanel.vue src/components/__tests__/chatMessagePresentation.test.ts
git commit -m "feat: align OpenCode active turn thinking"
```

### Task 2: Cursor-Paginated Session History

**Files:**
- Modify: `src/stores/openCodeSyncStore.ts:625-740`
- Modify: `src/stores/__tests__/openCodeSyncStore.test.ts`
- Modify: `src/components/chat/ChatPanel.vue:780-1036,3710-3758`
- Test: `src/components/__tests__/chatMessagePresentation.test.ts`

- [ ] **Step 1: Write failing store tests**

```ts
await store.openSession('/project', 'ses_1')
assert.equal(firstCall.limit, 20)
assert.equal(store.hasOlderMessages('ses_1'), true)
await store.loadOlderMessages('/project', 'ses_1')
assert.equal(secondCall.before, 'cursor_older')
assert.deepEqual(store.state.messages.ses_1?.map(message => message.id), ['msg_old', 'msg_new'])
```

Mock the SDK response headers through `{ data, response: { headers: new Headers({ 'x-next-cursor': 'cursor_older' }) } }`. Also assert a later event-confirmed message survives an older page response.

- [ ] **Step 2: Run the store test and observe failure**

Run: `pnpm run test:focused:build && node --test /private/tmp/jc-focused-tests/stores/__tests__/openCodeSyncStore.test.js`

Expected: `hasOlderMessages` and `loadOlderMessages` are missing; initial load still requests `limit: 500`.

- [ ] **Step 3: Implement official pages without a second message store**

Add per-session `{ cursor, complete, loadingOlder }` metadata beside current sync state. `openSession()` fetches `limit: 20`, reads `x-next-cursor`, and merges its page with event state. `loadOlderMessages()` sends `before: cursor` with `limit: 200`, merges by message/part id, and updates cursor/complete. Existing `message.removed` tombstones remain the only delete authority.

Expose `hasOlderMessages`, `loadingOlderMessages`, and `loadOlderMessages` from the store. In `ChatPanel.vue`, invoke `loadOlderMessages()` near scroll top only while the user is not following output; preserve the visible anchor with the existing virtualizer's measured top row before and after the prepend.

- [ ] **Step 4: Run store and UI tests**

Run: `pnpm run test:focused:build && node --test /private/tmp/jc-focused-tests/stores/__tests__/openCodeSyncStore.test.js /private/tmp/jc-focused-tests/components/__tests__/chatMessagePresentation.test.js`

Expected: zero failures; session opening requests 20, older pages use `before`, and active event state is retained.

- [ ] **Step 5: Commit task**

```bash
git add src/stores/openCodeSyncStore.ts src/stores/__tests__/openCodeSyncStore.test.ts src/components/chat/ChatPanel.vue src/components/__tests__/chatMessagePresentation.test.ts
git commit -m "feat: page OpenCode session history"
```

### Task 3: Official Context Status Visibility

**Files:**
- Modify: `src/composables/useChat.ts:501-533,1159-1173`
- Modify: `src/opencodeClient/__tests__/catalog.test.ts`
- Modify: `src/composables/__tests__/useChatControls.test.ts`
- Modify: `docs/wiki/开发/OpenCode差异修复记录.md`
- Modify: `docs/wiki/hot.md`

- [ ] **Step 1: Write failing context refresh tests**

```ts
// A desktop session transitions busy -> idle after a prompt.
// The client must call v2.session.context once and publish the returned usage.
assert.equal(contextCalls, 1)
assert.equal(chat.openCodeContextUsage.value?.usage, 82)
```

Add an error-event case asserting the provider's `ContextOverflowError` message remains visible in the assistant error projection rather than being replaced by an endless busy state.

- [ ] **Step 2: Run composable tests and observe failure**

Run: `pnpm run test:focused:build && node --test /private/tmp/jc-focused-tests/composables/__tests__/useChatControls.test.js`

Expected: context is refreshed only by manual session actions, not when a prompt becomes idle.

- [ ] **Step 3: Implement client observation only**

On the Desktop active session's `busy -> idle` status transition, invalidate and load `v2.session.context`; ignore only stale session changes. Keep `v2.session.compact` as the existing explicit user action and do not introduce a client token counter or compression algorithm. Preserve OpenCode `compaction` parts and `ContextOverflowError` as timeline rows.

- [ ] **Step 4: Run focused tests and type check**

Run: `pnpm run test:focused:build && node --test /private/tmp/jc-focused-tests/composables/__tests__/useChatControls.test.js /private/tmp/jc-focused-tests/opencodeClient/__tests__/catalog.test.js && pnpm exec vue-tsc -b`

Expected: zero failures and no TypeScript errors.

- [ ] **Step 5: Commit task**

```bash
git add src/composables/useChat.ts src/composables/__tests__/useChatControls.test.ts src/opencodeClient/__tests__/catalog.test.ts docs/wiki/开发/OpenCode差异修复记录.md docs/wiki/hot.md
git commit -m "feat: expose OpenCode context state"
```

### Final Verification

- [ ] Run `pnpm run test:focused:build && pnpm run test:focused:run`.
- [ ] Run `pnpm exec vue-tsc -b` and `git diff --check`.
- [ ] Confirm `target/debug/jiucaihezi-app` and Vite are from this worktree before manual Desktop testing.

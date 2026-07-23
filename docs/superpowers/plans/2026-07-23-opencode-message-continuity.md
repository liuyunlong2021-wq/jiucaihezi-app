# OpenCode Message Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep completed OpenCode message parts visible while a follow-up prompt starts, and match OpenCode's per-text-part copy contract.

**Architecture:** Translate the bounded orphan-part handling and event-aware message reconciliation from OpenCode v1.18.4's `packages/app/src/context/server-session.ts`. The Vue UI remains a projection of the sync store; it must not apply a second, immediate post-submit replacement. Assistant presentation keeps the official distinction between a response part copy and a fenced-code-block copy, including the official `content-visibility: auto` property.

**Tech Stack:** Vue 3, Pinia, TypeScript, Node test runner, OpenCode v1.18.4 source.

---

### Task 1: Preserve valid out-of-order parts

**Files:**
- Modify: `src/opencodeClient/eventReducer.ts`
- Test: `src/opencodeClient/__tests__/eventReducer.test.ts`

- [x] **Step 1: Write a failing event-order test**

```ts
test('part updates arriving before the parent message become visible when its parent arrives', () => {
  const state = createOpenCodeSyncState()
  applyOpenCodeEvent(state, directory, event('message.part.updated', { sessionID: 'ses_1', part }))
  applyOpenCodeEvent(state, directory, event('message.updated', { sessionID: 'ses_1', info: assistant }))
  assert.equal(state.parts.msg_1?.[0]?.id, 'prt_1')
})
```

- [x] **Step 2: Run the reducer test and verify the assertion fails**

Run: `pnpm exec esbuild src/opencodeClient/__tests__/eventReducer.test.ts --bundle --platform=node --format=esm --outfile=/private/tmp/jc-event-reducer.test.mjs && node --test /private/tmp/jc-event-reducer.test.mjs`

Expected: failure because the local reducer discards the part before its parent exists.

- [x] **Step 3: Buffer pre-parent parts only during an active load, reject tombstoned parents, and clear unmatched parts when loading completes**

```ts
// Store a part before its message but do not project it until state.messages owns messageID.
// Clear it only when the parent is explicitly removed or a completed snapshot proves it absent.
```

- [x] **Step 4: Run the reducer test and verify it passes**

Run: `pnpm exec esbuild src/opencodeClient/__tests__/eventReducer.test.ts --bundle --platform=node --format=esm --outfile=/private/tmp/jc-event-reducer.test.mjs && node --test /private/tmp/jc-event-reducer.test.mjs`

Expected: all event-reducer tests pass.

### Task 2: Do not overwrite the projection after a send

**Files:**
- Modify: `src/composables/useChat.ts`
- Test: `src/composables/__tests__/useChatControls.test.ts`

- [x] **Step 1: Write a failing source-contract test**

```ts
assert.doesNotMatch(desktopSubmitBody, /replaceMessagesPreservingPrompt\(/)
```

- [x] **Step 2: Run the focused use-chat test and verify it fails**

Run: `pnpm exec esbuild src/composables/__tests__/useChatControls.test.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=/private/tmp/jc-use-chat-controls.test.mjs && node --test /private/tmp/jc-use-chat-controls.test.mjs`

Expected: failure because successful Desktop submission directly replaces the reactive projection.

- [x] **Step 3: Remove only the post-submit and post-failure replacements**

```ts
await openCodeSyncStore.submitPrompt(input)
pendingDesktopMessages.value = pendingDesktopMessages.value.filter((message) => message.id !== desktopMessageID)
// The existing store watcher publishes the optimistic and confirmed projection.
```

- [x] **Step 4: Run the focused use-chat test and verify it passes**

Run: `pnpm exec esbuild src/composables/__tests__/useChatControls.test.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=/private/tmp/jc-use-chat-controls.test.mjs && node --test /private/tmp/jc-use-chat-controls.test.mjs`

Expected: all use-chat control tests pass.

### Task 3: Match OpenCode assistant copy boundaries

**Files:**
- Modify: `src/components/chat/MessageBubble.vue`
- Modify: `src/components/__tests__/chatMessagePresentation.test.ts`

- [x] **Step 1: Write a failing presentation contract test**

```ts
assert.match(messageBubble, /@click="copyOpenCodeTextPart\(part\)"/)
assert.doesNotMatch(openCodeTextPartTemplate, /@click="copyMessage"/)
```

- [x] **Step 2: Run the presentation test and verify it fails**

Run: `pnpm exec esbuild src/components/__tests__/chatMessagePresentation.test.ts --bundle --platform=node --format=esm --outfile=/private/tmp/jc-chat-message-presentation.test.mjs && node --test /private/tmp/jc-chat-message-presentation.test.mjs`

Expected: failure because the current text-part action copies every part in the message.

- [x] **Step 3: Add a part-scoped clipboard handler and retain the official visibility behavior**

```ts
async function copyOpenCodeTextPart(part: OpenCodeRenderablePart) {
  await writeClipboardText(part.text || '')
}
```

Keep OpenCode's `content-visibility: auto` on `[data-component="assistant-message"]`; remove the Studio-only `contain-intrinsic-size` hint.

- [x] **Step 4: Run the presentation test and verify it passes**

Run: `pnpm exec esbuild src/components/__tests__/chatMessagePresentation.test.ts --bundle --platform=node --format=esm --outfile=/private/tmp/jc-chat-message-presentation.test.mjs && node --test /private/tmp/jc-chat-message-presentation.test.mjs`

Expected: all presentation tests pass.

### Task 4: Verify the branch

**Files:**
- Verify only: the files above

- [x] **Step 1: Run targeted regression tests**

Run the three commands from Tasks 1-3.

- [x] **Step 2: Run project gates**

Run: `pnpm run typecheck && pnpm run build:desktop && git diff --check`

Expected: exit status 0 for every command.

- [ ] **Step 3: Manually verify Desktop**

Send a follow-up in an existing OpenCode session; the previous answer must remain continuously visible. Hover a response part to copy exactly that part. Hover a fenced code block to copy exactly that block. A Markdown quote must not gain a custom copy control.

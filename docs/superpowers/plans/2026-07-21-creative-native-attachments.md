# Creative Native Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make Creative Mode send original image, video, audio, and file inputs to models that can read them, using only the user's current Provider/K, with same-provider Gemini assistance and existing local-tool approval as fallbacks.

**Architecture:** Add one transient attachment contract shared by Web and Desktop. The message builder owns the production `image_url` / `file.file_data` shape; model capability routing owns whether an original attachment may be sent. Same-provider Gemini reuses the already-resolved API configuration and transport, while unsupported paths keep attachment metadata and let the existing model-tool loop request local tools.

**Billing boundary:** Jiucaihezi provides orchestration only. Every cloud request must reuse the current turn's already-resolved Provider/K. Never read another group, another Provider, a default Gemini credential, or a platform-owned account. If that exact Provider/K has no verified Gemini, ask for local-tool permission; refusal, missing tools, or missing function calling ends with an explicit unsupported result.

**Tech Stack:** Vue 3, TypeScript, Pinia, Node test runner, Tauri 2, existing OpenAI-compatible Chat Completions runtime.

---

### Task 1: Freeze the production attachment contract

**Files:**
- Modify: `src/utils/__tests__/directMessageBuilder.test.ts`
- Modify: `src/utils/directMessageBuilder.ts`

- [x] **Step 1: Write failing tests for production content parts**

Add tests that pass `attachments` containing image, video, audio, and PDF values and assert this exact shape:

```ts
[
  { type: 'text', text: '分析附件' },
  { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
  { type: 'file', file: { filename: 'clip.mp4', file_data: 'data:video/mp4;base64,BBB' } },
  { type: 'file', file: { filename: 'voice.wav', file_data: 'data:audio/wav;base64,CCC' } },
  { type: 'file', file: { filename: 'brief.pdf', file_data: 'data:application/pdf;base64,DDD' } },
]
```

Also assert the video never creates a `video_url` part and that legacy `images` still work.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm run test:focused:build
node --test /private/tmp/jc-focused-tests/utils/__tests__/directMessageBuilder.test.js
```

Expected: attachment tests fail because `BuildDirectMessagesInput` has no `attachments` contract.

- [x] **Step 3: Implement the minimum shared contract**

Add:

```ts
export type DirectAttachmentKind = 'image' | 'video' | 'audio' | 'file'

export interface ResolvedDirectAttachment {
  id: string
  name: string
  mime: string
  size: number
  kind: DirectAttachmentKind
  value: string
}
```

Extend `DirectApiMessageContent` with only the verified `file` part, and build all current-turn attachment parts in `buildDirectMessages()`. Do not add provider adapters or persist values.

- [x] **Step 4: Verify GREEN**

Run the two commands from Step 2. Expected: all direct-message tests pass.

- [x] **Step 5: Commit**

```bash
git add src/utils/directMessageBuilder.ts src/utils/__tests__/directMessageBuilder.test.ts
git commit -m "feat: add native direct attachment contract"
```

### Task 2: Record provider-scoped input capabilities

**Files:**
- Modify: `src/stores/agentStore.ts`
- Create: `src/runtime/direct/modelInputCapabilities.ts`
- Create: `src/runtime/direct/__tests__/modelInputCapabilities.test.ts`

- [x] **Step 1: Write failing capability tests**

Cover these cases:

```ts
resolveModelInputModalities({ id: 'gemini-3.5-flash', providerId: 'jiucaihezi' })
// => ['text', 'image', 'video', 'audio', 'file']

resolveModelInputModalities({ id: 'gpt-5.6-terra', providerId: 'jiucaihezi' })
// excludes video and audio

findMediaSpecialist(models, 'custom-a', ['video'])
// never returns a Gemini owned by jiucaihezi or custom-b

findMediaSpecialist(models, 'local-ollama', ['video'])
// => null
```

- [x] **Step 2: Verify RED**

Run the focused build and the generated test file. Expected: module-not-found or missing-export failure.

- [x] **Step 3: Implement conservative capability routing**

Add `inputModalities?: DirectAttachmentKind[]` to `ModelEntry`. Preserve Gateway-provided fields when present. For the current verified `jiucaihezi/gemini-3.5-flash`, declare all five inputs; for existing vision-capable models declare only text/image unless production evidence proves more. Local and custom providers never inherit cloud declarations.

Implement `findMediaSpecialist()` by exact `providerId`, exact available catalog membership, and all-required-modalities matching.

- [x] **Step 4: Verify GREEN and commit**

Run the targeted capability test, then commit:

```bash
git add src/stores/agentStore.ts src/runtime/direct/modelInputCapabilities.ts src/runtime/direct/__tests__/modelInputCapabilities.test.ts
git commit -m "feat: scope media capabilities to current provider"
```

### Task 3: Preserve one transient original per upload

**Files:**
- Modify: `src/components/chat/FileUploader.vue`
- Modify: `src/components/__tests__/chatMessagePresentation.test.ts`

- [x] **Step 1: Add failing source-contract tests**

Assert that `AttachedFile` exposes one `modelValue`, audio and video assign it from one data-URL read, video media references reuse that value, and the local metadata summary remains separate.

- [x] **Step 2: Verify RED**

Run the focused build and `chatMessagePresentation.test.js`. Expected: missing `modelValue` and duplicate video-read assertions fail.

- [x] **Step 3: Implement the smallest uploader change**

Add:

```ts
modelValue?: string
modelKind?: 'image' | 'video' | 'audio' | 'file'
```

Images reuse their preview data URL. Audio/video read one data URL into `modelValue`; video `mediaReferenceValue` reuses it. Other uploaded files retain their extracted text and also keep the original request-only data URL. Do not store this value outside the current uploader instance.

- [x] **Step 4: Verify GREEN and commit**

Run the targeted test and commit the two files.

### Task 4: Carry transient attachments through Desktop Creative Mode

**Files:**
- Modify: `src/components/chat/ChatPanel.vue`
- Modify: `src/composables/creativeChat.ts`
- Modify: `src/composables/useChat.ts`
- Modify: `src/composables/__tests__/creativeChat.test.ts`
- Modify: `src/components/__tests__/chatMessagePresentation.test.ts`

- [x] **Step 1: Write failing behavior tests**

Prove that ChatPanel builds `ResolvedDirectAttachment[]`, keeps only lightweight metadata on `ChatMessage.attachments`, passes values separately to `sendCreative()`, and clears the uploader only after the transient snapshot exists.

- [x] **Step 2: Verify RED**

Run the two generated targeted tests. Expected: attachments are absent and video remains text-only.

- [x] **Step 3: Implement Desktop wiring**

Add a lightweight persisted reference:

```ts
export interface DirectAttachmentRef {
  id: string
  name: string
  mime: string
  size: number
  kind: DirectAttachmentKind
  source: 'upload' | 'project' | 'canvas' | 'task'
  resource?: ProjectResource
  cachePath?: string
}
```

`ChatPanel` freezes references and resolved values once. `creativeChat.send()` accepts transient resolved attachments, filters them through the selected model's verified modalities, and gives supported originals to `buildDirectMessages()`. Never append Base64 to `ChatMessage.files`.

- [x] **Step 4: Verify GREEN and commit**

Run both targeted tests and commit only the listed files.

### Task 5: Carry the same contract through Web Creative Mode

**Files:**
- Modify: `src/composables/web/chatCloud.ts`
- Modify: `src/composables/useChat.ts`
- Modify: `src/components/__tests__/chatMessagePresentation.test.ts`

- [x] **Step 1: Write a failing Web contract test**

Assert that `SendMessageOptions.attachments` reaches the same `buildDirectMessages()` call and that Web never creates a second `video_url` builder.

- [x] **Step 2: Verify RED, implement, and verify GREEN**

Pass the transient attachment array through `sendWebCloudMessage()`. Platform differences stay in Blob/OPFS reading and fetch; the standardized message must match Desktop.

- [x] **Step 3: Commit**

```bash
git add src/composables/web/chatCloud.ts src/composables/useChat.ts src/components/__tests__/chatMessagePresentation.test.ts
git commit -m "feat: share native attachments with web creative chat"
```

### Task 6: Add same-provider Gemini assistance without a second client

**Files:**
- Create: `src/runtime/direct/mediaSpecialist.ts`
- Create: `src/runtime/direct/__tests__/mediaSpecialist.test.ts`
- Modify: `src/composables/creativeChat.ts`
- Modify: `src/composables/web/chatCloud.ts`
- Modify: `src/components/chat/ChatPanel.vue`

- [x] **Step 1: Write failing policy tests**

Cover: primary model supports all inputs; same-provider Gemini exists; Gemini exists only in another provider; local provider; user rejects consent; specialist response includes summary and uncertainties; specialist request uses the same API base and API key object supplied by the caller.

- [x] **Step 2: Verify RED**

Run the generated specialist test. Expected: missing module failure.

- [x] **Step 3: Implement the policy and one-time consent**

`mediaSpecialist.ts` receives the current catalog, current provider ID, attachments, user goal, and an injected `sendCompletion(modelId, messages)` callback. It never calls `resolveApiConfig()` or reads storage. Reuse the existing composer approval strip for first cross-model consent and store only `allowed` when the user chooses “始终允许”.

The injected callback must close over the main request's already-resolved API base, headers, key, abort signal, and transport. It may change only the model ID. Add tests proving the specialist module cannot resolve credentials and that a Gemini found under another Provider is unavailable.

- [x] **Step 4: Keep unsupported fallback inside the existing model-tool loop**

When no same-provider specialist exists, keep attachment metadata and existing terminal attachment tokens in the main request. If the model supports tools, it may request terminal/read/Skill and the existing approval strip decides execution. If the model cannot call tools, return a direct “当前模型和账号都不能读取该媒体” result. Do not add a public service or automatic shell execution.

Do not auto-read or execute the local attachment before permission. A rejected permission, unavailable local tool, or failed tool result must return through the existing model loop when possible and otherwise end explicitly; it must never trigger a cloud upload or model switch.

- [x] **Step 5: Verify GREEN and commit**

Run the specialist, creative-chat, and presentation tests, then commit the listed files.

### Task 7: Decouple tools from attachment delivery

**Files:**
- Modify: `src/composables/creativeChat.ts`
- Modify: `src/composables/web/chatCloud.ts`
- Modify: `src/composables/__tests__/creativeChat.test.ts`
- Modify: `src/components/__tests__/chatMessagePresentation.test.ts`

- [x] **Step 1: Write failing tests**

Assert: `toolCall === false` removes only `tools`; supported attachments remain; media understanding does not create a media plan; a model-produced generation plan still creates the existing confirmation card.

- [x] **Step 2: Verify RED, implement minimum branching, verify GREEN**

Choose `tools` from the current `ModelEntry.toolCall` flag. Do not keyword-route user intent. Preserve the existing `runDirectChatCompletion()` loop and media-plan parser.

- [x] **Step 3: Commit**

Commit only the four listed files.

### Task 8: Full verification and Wiki closeout

**Files:**
- Modify: `docs/wiki/开发/创模式原生附件直连合同SDD.md`
- Modify: `docs/wiki/来源索引.md`
- Modify: `docs/wiki/hot.md`
- Modify: `docs/wiki/log.md`

- [x] **Step 1: Run automatic verification**

```bash
pnpm run test:focused
pnpm exec vue-tsc -b
pnpm run build
pnpm run build:desktop
git diff --check
```

Expected: all commands exit 0. Use local ignored sidecar binaries for Tauri tests and builds; do not commit them.

- [x] **Step 2: Run real-request smoke tests**

Using the current user K only, repeat the tiny PNG, MP4, WAV, `file + tools`, and GPT unsupported cases. Record model ID, part type, byte count, result, and status without K or Base64.

- [x] **Step 3: Update Wiki with proved facts only**

Mark automatic implementation facts complete. Keep Web/Desktop UI, refresh recovery, Windows, Intel Mac, Apple Silicon, and any paid/manual scenario unverified until actually run.

- [x] **Step 4: Final audit**

Confirm no Base64 is persisted, no other Provider/K is read, no `video_url` is emitted, local models never upload media to cloud, and all SDD success criteria have direct evidence.

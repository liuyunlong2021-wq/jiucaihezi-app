# Dual Client Final Product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the final product shape: Desktop APP with 文 / 武 / 直连 modes, and Web client with 直连 mode only.

**Architecture:** Treat Desktop and Web as equally important clients. Keep OpenCode isolated to Desktop 文 / 武, complete Web direct first, then extract a shared direct engine for Desktop direct reuse.

**Tech Stack:** Vue 3, Pinia, Vite, Tauri 2, OpenCode SDK, NewAPI-compatible chat completions, IndexedDB/local browser persistence, existing chat UI components.

---

## Operating Rules

- Read `CLAUDE.md`, `AGENTS.md`, and `docs/sdd/dual-client-final-product-roadmap.md` before executing this plan.
- Work one Phase at a time.
- Update the checkboxes in this file as work is completed.
- Do not cross from Web direct work into `src-tauri/**` or `src/opencodeClient/**`.
- Do not cross from Desktop OpenCode work into Web direct internals unless the Phase explicitly says to extract shared direct code.
- Run the listed verification commands before marking a Phase complete.
- Commit at the end of each Phase with a focused message.

## Phase 0: Documentation and Branch Baseline

**Goal:** Make the roadmap discoverable to any AI tool.

**Branch:** `main` or `codex/opencode-core-execution`, then fast-forward `main`.

**Files:**

- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`
- Create: `docs/sdd/dual-client-final-product-roadmap.md`
- Create: `docs/superpowers/plans/2026-06-15-dual-client-final-product.md`

- [x] Add "current execution entry" to `CLAUDE.md`.
- [x] Add matching "current execution entry" to `AGENTS.md`.
- [x] Create the final product roadmap SDD.
- [x] Create this execution plan.
- [x] Run: `git diff --check`.
- [x] Commit docs: `git commit -m "docs: add dual-client final product roadmap"`.
- [x] Push `main` and any aligned working branch.

**Exit Criteria:**

- A new tool can read the four required docs and know the current goal, branch strategy, and next Phase.

## Phase 1: Rebase Web Direct Onto New Main

**Goal:** Make `codex/web-direct-wongsaang` start from the promoted `main` without desktop/OpenCode pollution.

**Branch:** `codex/web-direct-wongsaang`.

**Files to inspect first:**

- `src/composables/chatCloud.ts`
- `src/composables/useChat.ts`
- `src/stores/sessionStore.ts`
- `src/utils/idb.ts`
- `src/utils/webSearch.ts`
- `src/components/chat/ChatPanel.vue`
- `src/components/chat/MessageBubble.vue`
- `package.json`
- `pnpm-lock.yaml`

- [x] Create a safety branch from the current Web branch:

```bash
git switch codex/web-direct-wongsaang
git branch backup/web-direct-before-main-sync-$(date +%Y%m%d-%H%M%S)
```

- [x] Sync with new `main` using rebase or merge.

Preferred if conflicts are manageable:

```bash
git fetch origin
git rebase main
```

Conservative fallback:

```bash
git merge main
```

- [x] Resolve conflicts by preserving Web direct changes only in Web direct files.
- [x] Confirm no Web branch changes under desktop-only paths:

```bash
git diff --name-only main...HEAD | rg '^(src-tauri/|src/opencodeClient/)' && exit 1 || true
```

- [x] Confirm Web direct docs/code do not enter OpenCode branch files:

```bash
rg -n "WongSaang|chatgpt-ui|DIRECT_WEB_SEARCH_TOOL|generateTitleForDirect" src-tauri src/opencodeClient || true
```

- [x] Run typecheck:

```bash
pnpm install --frozen-lockfile
pnpm exec vue-tsc -b
```

- [x] Commit Phase 1:

```bash
git add .
git commit -m "chore: sync web direct branch with promoted main"
```

**Exit Criteria:**

- `codex/web-direct-wongsaang` is based on current `main`.
- It has no changes in `src-tauri/**` or `src/opencodeClient/**`.

## Phase 2: Complete Web Direct Product

**Goal:** Web direct becomes deployable as a complete product.

**Branch:** `codex/web-direct-wongsaang`.

**Expected files:**

- Modify/Create: direct chat engine files under `src/composables/` or `src/runtime/direct/`.
- Modify: `src/composables/chatCloud.ts` or replace with shared direct entry.
- Modify: `src/composables/useChat.ts` only inside `!isTauriRuntime()` branch.
- Modify: `src/stores/sessionStore.ts` only for direct-safe session/history APIs.
- Modify: `src/utils/webSearch.ts` only for Web-safe search behavior.
- Avoid modifying: `src-tauri/**`, `src/opencodeClient/**`.

- [x] Audit current Web direct implementation against `docs/web-direct-mode-wongsaang-integration-plan.md` if that file exists in the Web branch.
- [x] Add or update focused tests for streaming parser:
  - JSON fallback response.
  - SSE content delta.
  - SSE reasoning delta if supported.
  - tool_calls accumulation.
  - `[DONE]` handling.
- [x] Add or update focused tests for tool-call follow-up:
  - `web_search` tool result pairs assistant `tool_calls` with `tool` messages.
  - invalid JSON tool args produce a model-visible tool error.
  - unsupported tools do not break the visible assistant bubble.
- [x] Verify Web mode selector behavior:
  - Web shows only 直连.
  - Desktop still shows 文 / 武 and later will show 直连 only when Phase 4 adds it.
- [x] Verify session/history:
  - create session.
  - switch session.
  - refresh restore.
  - delete session if supported.
- [x] Verify persistence does not store non-cloneable objects.
- [x] Verify Web search:
  - search off produces normal direct response.
  - search on injects or calls web search without empty assistant output.
- [x] Run:

```bash
pnpm exec vue-tsc -b
pnpm run test:focused:build
pnpm run build
```

**Phase 2 verification notes (2026-06-15):**

- `docs/web-direct-mode-wongsaang-integration-plan.md` is not present in this branch, so Phase 2 is verified against this plan and `docs/sdd/dual-client-final-product-roadmap.md`.
- Added direct engine tests for JSON fallback, SSE content, SSE reasoning, tool-call accumulation, `[DONE]`, invalid JSON tool args, unsupported tools, and missing `web_search.query`.
- Static Web selector audit passed: Web runtime is guarded to 直连 only; desktop mode selector remains under `!isWebRuntime`.
- Static persistence audit passed: direct snapshots use plain cloned messages before store writes.
- Added Web session history regression coverage for direct session create, switch, refresh-style reload, message restore, and delete.
- Static search audit passed: search off uses normal direct streaming; search on pre-injects Jina evidence and exposes `web_search` tool-call follow-up.
- `pnpm exec vue-tsc -b`: passed.
- `pnpm run test:focused:build`: passed, with an existing duplicate `wikiLink` case warning in `src/utils/editorDocument.ts`.
- `node --test /private/tmp/jc-focused-tests/composables/__tests__/webDirectEngine.test.js /private/tmp/jc-focused-tests/stores/__tests__/webSessionHistory.test.js`: passed, 8/8.
- `pnpm run audit:web-direct-boundary`: passed.
- `pnpm run test:focused:run`: blocked by unrelated desktop/OpenCode focused tests (`OpenCode streaming`, continuation grouping, Help center glossary, OpenCode run event detection). Do not fix these in the Web branch.
- `pnpm run build`: blocked by the same unrelated desktop/OpenCode focused tests because it invokes `pnpm run test:focused` first.
- Web deploy artifact path passed: `pnpm exec vite build`, then `node scripts/prune-web-dist.mjs`, then `pnpm run audit:web-dist`.
- Local Web preview smoke passed after proxy/session fixes:
  - localhost/127.0.0.1 preview routes NewAPI calls through `/__jc_api`, avoiding browser CORS failures.
  - Web cloud output remains visible while streaming instead of flashing away.
  - Refresh restores the streamed assistant message from Web session history.
  - User manually confirmed the Web direct send/stream/refresh path works.

- [x] Commit Phase 2:

```bash
git add src docs package.json pnpm-lock.yaml
git commit -m "feat: complete web direct chat product"
```

**Exit Criteria:**

- Web build can be deployed and manually tested for send/stream/history/search.
- No desktop/OpenCode paths are modified.

## Phase 3: Extract Shared Direct Engine

**Goal:** Make direct mode reusable by Desktop without OpenCode.

**Branch:** new branch from Web branch after Phase 2, or continue Web branch if scope is small.

**Recommended files:**

- Create: `src/runtime/direct/directEngine.ts`
- Create: `src/runtime/direct/directTypes.ts`
- Create: `src/runtime/direct/directStream.ts`
- Create: `src/runtime/direct/directTools.ts`
- Create: `src/runtime/direct/__tests__/directStream.test.ts`
- Create: `src/runtime/direct/__tests__/directTools.test.ts`
- Modify: Web direct caller to use the shared engine.

- [x] Move pure message shaping into direct engine.
- [x] Move OpenAI-compatible stream parsing into direct stream helper.
- [x] Move direct tool-call pairing/follow-up logic into direct tools helper.
- [x] Keep platform-specific persistence and fetch config outside the pure engine.
- [x] Confirm no imports from:

```text
src-tauri/**
src/opencodeClient/**
```

- [x] Run:

```bash
pnpm exec vue-tsc -b
pnpm run test:focused:build
pnpm run build
```

**Phase 3 verification notes (2026-06-15):**

- Added shared direct runtime modules under `src/runtime/direct/` for types, OpenAI-compatible stream parsing, tool-call result pairing, and second-pass direct chat completion orchestration.
- Web cloud adapter now calls `runDirectChatCompletion()` and keeps Web-only fetch config, API headers, Jina search, persistence, and UI mutation outside the pure engine.
- `src/composables/webDirectEngine.ts` is retained as a compatibility re-export.
- Focused direct/session subset passed: `node --test /private/tmp/jc-focused-tests/runtime/direct/__tests__/directStream.test.js /private/tmp/jc-focused-tests/runtime/direct/__tests__/directTools.test.js /private/tmp/jc-focused-tests/runtime/direct/__tests__/directEngine.test.js /private/tmp/jc-focused-tests/composables/__tests__/webDirectEngine.test.js /private/tmp/jc-focused-tests/composables/__tests__/useChatControls.test.js /private/tmp/jc-focused-tests/stores/__tests__/webSessionHistory.test.js`: passed, 25/25.
- `pnpm exec vue-tsc -b`: passed.
- `pnpm run test:focused:build`: passed, with the existing duplicate `wikiLink` case warning in `src/utils/editorDocument.ts`.
- `pnpm run audit:web-direct-boundary`: passed.
- Direct engine source audit found no `src-tauri`, `opencodeClient`, OpenCode, Tauri, or `tauriEnv` imports under `src/runtime/direct`.
- Web deploy artifact path passed: `pnpm exec vite build`, then `node scripts/prune-web-dist.mjs`, then `pnpm run audit:web-dist`.
- `pnpm run build`: still blocked in `test:focused:run` by unrelated desktop/OpenCode focused tests (`OpenCode streaming`, continuation grouping, Help center glossary, OpenCode run event detection). Do not fix these in the Web branch.

- [x] Commit Phase 3:

```bash
git add src/runtime/direct src/composables src/utils
git commit -m "refactor: extract shared direct chat engine"
```

**Exit Criteria:**

- Web direct works exactly as Phase 2 after extraction.
- Shared direct engine has focused tests.

## Phase 4: Add Desktop Direct Mode

**Goal:** Desktop gains 直连 mode while 文 / 武 remain OpenCode.

**Branch:** branch from updated `main` after Web/direct-engine merge, or a short desktop-direct branch.

**Expected files:**

- Modify: `src/components/chat/ChatPanel.vue` for mode selector only.
- Modify: `src/composables/useChat.ts` to route desktop direct to shared direct engine.
- Modify: session persistence only if needed for direct mode metadata.
- Avoid changing OpenCode client internals unless a test proves it is needed.

- [x] Add/adjust mode state to support `plan`, `build`, and `direct` on Desktop.
- [x] Route `plan` and `build` exactly through existing OpenCode paths.
- [x] Route `direct` through shared direct engine.
- [x] Ensure direct mode does not create OpenCode session parts.
- [x] Ensure direct mode does not require project directory.
- [x] Verify 文 / 武 mode labels and behavior are unchanged.
- [x] Run:

```bash
pnpm exec vue-tsc -b
pnpm run test:focused:build
```

**Phase 4 verification notes (2026-06-15):**

- Desktop mode selector now supports `武` / `文` / `直连`. Web remains direct-only.
- Desktop `直连` passes an explicit `chatMode: 'direct'` signal and does not pass an OpenCode agent.
- Desktop `直连` routes cloud text models through `runDirectChatCompletion()` from `src/runtime/direct`, while local models keep the existing local direct path.
- Desktop `文` / `武` continue to pass `openCodeAgent` to the existing OpenCode path.
- Desktop `直连` hides OpenCode slash/shell command entry points and does not require a project directory.
- Focused Phase 4/static/direct subset passed: 18/18.
- User manually confirmed Desktop `直连` streams without OpenCode and restores after refresh.
- User manually confirmed Desktop `文` routes to OpenCode plan mode and Desktop `武` routes to OpenCode build mode.
- User manually confirmed `/` and `!` commands only trigger OpenCode command handling in `文` / `武`, not in `直连`.
- Post-smoke console review found repeated Vue timestamp prop warnings from OpenCode ISO timestamps; fixed in `messageMapper.ts`.
- Post-smoke status review found completion fallback could miss the active session id and leave the status bar at `回复中`; fixed by preserving session-keyed status fallback.
- `pnpm exec vue-tsc -b`: passed.
- `pnpm run test:focused`: passed, including frontend focused tests and Tauri tests. The existing duplicate `wikiLink` case warning in `src/utils/editorDocument.ts` remains unrelated.
- `pnpm run audit:web-direct-boundary`: passed.
- Web deploy artifact path passed: `pnpm exec vite build`, then `node scripts/prune-web-dist.mjs`, then `pnpm run audit:web-dist`.

- [x] Commit Phase 4:

```bash
git add src
git commit -m "feat: add desktop direct chat mode"
```

**Exit Criteria:**

- Desktop supports 文 / 武 / 直连.
- OpenCode behavior is unchanged in 文 / 武.

## Phase 5: Dual-Client Regression

**Goal:** Verify both clients before merging to `main`.

- [x] Web regression:
  - direct send/stream.
  - session create/switch/refresh restore.
  - search off/on.
  - tool-call response.
  - `pnpm run build`.

- [x] Desktop regression:
  - 文 send with project directory.
  - 武 send with project directory.
  - OpenCode timeline parts.
  - permission/question/todo/diff surfaces.
  - 直连 send/stream/persist.
  - `pnpm exec vue-tsc -b`.

- [x] Boundary audit:

```bash
git diff --name-only main...HEAD
rg -n "WongSaang|chatgpt-ui|DIRECT_WEB_SEARCH_TOOL|generateTitleForDirect" src-tauri src/opencodeClient || true
```

- [x] Commit any regression fixes separately with focused messages.

**Phase 5 verification notes (2026-06-15):**

- User manual Desktop smoke passed:
  - `直连`: does not enter OpenCode, streams normally, and survives refresh/history restore.
  - `文`: planning prompt enters OpenCode plan mode.
  - `武`: file/execution prompt enters OpenCode build mode.
  - `/` and `!` commands only trigger OpenCode command handling in `文` / `武`; `直连` treats them as normal text.
- Console review found no new fatal errors. Repeated Vue timestamp warnings and stale `回复中` state were fixed in commit `f49098a`.
- `pnpm run build`: passed, including `pnpm run test:focused`, `vue-tsc -b`, Web Vite build, `prune-web-dist`, and `audit:web-dist`.
- `pnpm run build:desktop`: passed, including `pnpm run test:focused`, `vue-tsc -b`, Desktop Vite build, `prune-desktop-dist`, and `audit:desktop-dist`.
- `pnpm run audit:web-direct-boundary`: passed.
- `git diff --name-only main...HEAD` showed only expected docs/chat/useChat/opencodeClient/test files.
- `rg -n "WongSaang|chatgpt-ui|DIRECT_WEB_SEARCH_TOOL|generateTitleForDirect" src-tauri src/opencodeClient || true`: no findings.
- Existing non-blocking warnings remain:
  - duplicate `wikiLink` case warning in `src/utils/editorDocument.ts`.
  - Vite chunk-size / ineffective dynamic import warnings.

**Exit Criteria:**

- Both clients pass their smoke tests.
- Boundary audit has no unexpected findings.

## Phase 6: Merge and Release

**Goal:** Put the final validated product on `main` and release.

- [ ] Merge Web direct branch to `main`.
- [ ] Merge desktop direct branch to `main` if separate.
- [ ] Run final verification from `main`:

```bash
pnpm install --frozen-lockfile
pnpm exec vue-tsc -b
pnpm run build
```

- [ ] Build desktop if release is intended:

```bash
pnpm run build:desktop
pnpm run tauri:build
```

- [ ] Write release notes:
  - Web: 直连 mode.
  - Desktop: 文 / 武 / 直连.
  - Known limitations.

- [ ] Tag release only after artifacts are verified.

**Exit Criteria:**

- `main` is releasable.
- Web deploy and Desktop packages match the final product shape.

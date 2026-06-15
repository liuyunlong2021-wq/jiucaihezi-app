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
- [ ] Verify session/history:
  - create session.
  - switch session.
  - refresh restore.
  - delete session if supported.
- [x] Verify persistence does not store non-cloneable objects.
- [x] Verify Web search:
  - search off produces normal direct response.
  - search on injects or calls web search without empty assistant output.
- [ ] Run:

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
- Static search audit passed: search off uses normal direct streaming; search on pre-injects Jina evidence and exposes `web_search` tool-call follow-up.
- `pnpm exec vue-tsc -b`: passed.
- `pnpm run test:focused:build`: passed, with an existing duplicate `wikiLink` case warning in `src/utils/editorDocument.ts`.
- `pnpm run build`: blocked by unrelated desktop/OpenCode focused tests (`OpenCode streaming`, continuation grouping, Help center glossary, OpenCode run event detection). Do not fix these in the Web branch.
- Web deploy artifact path passed: `pnpm exec vite build`, then `node scripts/prune-web-dist.mjs`, then `pnpm run audit:web-dist`.

- [ ] Commit Phase 2:

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

- [ ] Move pure message shaping into direct engine.
- [ ] Move OpenAI-compatible stream parsing into direct stream helper.
- [ ] Move direct tool-call pairing/follow-up logic into direct tools helper.
- [ ] Keep platform-specific persistence and fetch config outside the pure engine.
- [ ] Confirm no imports from:

```text
src-tauri/**
src/opencodeClient/**
```

- [ ] Run:

```bash
pnpm exec vue-tsc -b
pnpm run test:focused:build
pnpm run build
```

- [ ] Commit Phase 3:

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

- [ ] Add/adjust mode state to support `plan`, `build`, and `direct` on Desktop.
- [ ] Route `plan` and `build` exactly through existing OpenCode paths.
- [ ] Route `direct` through shared direct engine.
- [ ] Ensure direct mode does not create OpenCode session parts.
- [ ] Ensure direct mode does not require project directory.
- [ ] Verify 文 / 武 mode labels and behavior are unchanged.
- [ ] Run:

```bash
pnpm exec vue-tsc -b
pnpm run test:focused:build
```

- [ ] Commit Phase 4:

```bash
git add src
git commit -m "feat: add desktop direct chat mode"
```

**Exit Criteria:**

- Desktop supports 文 / 武 / 直连.
- OpenCode behavior is unchanged in 文 / 武.

## Phase 5: Dual-Client Regression

**Goal:** Verify both clients before merging to `main`.

- [ ] Web regression:
  - direct send/stream.
  - session create/switch/refresh restore.
  - search off/on.
  - tool-call response.
  - `pnpm run build`.

- [ ] Desktop regression:
  - 文 send with project directory.
  - 武 send with project directory.
  - OpenCode timeline parts.
  - permission/question/todo/diff surfaces.
  - 直连 send/stream/persist.
  - `pnpm exec vue-tsc -b`.

- [ ] Boundary audit:

```bash
git diff --name-only main...HEAD
rg -n "WongSaang|chatgpt-ui|DIRECT_WEB_SEARCH_TOOL|generateTitleForDirect" src-tauri src/opencodeClient || true
```

- [ ] Commit any regression fixes separately with focused messages.

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

# Project Filetree Phase 1 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Phase 1 file-tree resource contract for directory changes and a single resource-open route without changing Phase 2 bulk file operations.

**Architecture:** `ProjectFileService` snapshots the affected directory subtree before a successful rename or delete, then publishes one batch event containing every affected resource transition. A small explorer service owns both batch expansion and the document/media/canvas open decision; the file-tree component only renders and presents the returned action. Editor sessions consume every inner event so descendant Tabs are renamed, closed, or put into the existing dirty-delete flow.

**Tech Stack:** Vue 3, TypeScript, Tauri commands, IndexedDB/OPFS Web adapter, Node test runner bundled by esbuild.

---

### Task 1: Lock directory-resource event behavior

**Files:**
- Modify: `src/services/__tests__/projectFileService.test.ts`
- Modify: `src/components/editor/__tests__/editorSessionStore.test.ts`

- [ ] **Step 1: Write failing service tests**

Add a directory with `docs/one.md` and assert that renaming `docs` publishes one batch whose flattened transitions rename both `docs` and `docs/one.md`; deleting it publishes deletion transitions for both resources.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `pnpm exec esbuild src/services/__tests__/projectFileService.test.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=/tmp/project-file-service.test.mjs && node --test /tmp/project-file-service.test.mjs`

Expected: FAIL because the current service only publishes the directory root event.

- [ ] **Step 3: Write a failing editor-session test**

Open a document below a directory, apply a batch rename/delete event, and assert the Tab resource follows the new path or is removed when clean.

- [ ] **Step 4: Run it and verify it fails**

Run: `pnpm exec esbuild src/components/editor/__tests__/editorSessionStore.test.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=/tmp/editor-session-store.test.mjs && node --test /tmp/editor-session-store.test.mjs`

Expected: FAIL because the session store currently accepts only a single change event.

### Task 2: Publish and consume complete directory batches

**Files:**
- Modify: `src/services/projectFileService.ts`
- Modify: `src/components/editor/editorSessionStore.ts`

- [ ] **Step 1: Add a batch event type and a small expansion helper**

Represent one directory mutation as `{ type: 'batch', changes, transactionId, operationId, source }`. Keep individual events unchanged and provide an exported helper that returns the leaf transitions for either form.

- [ ] **Step 2: Snapshot descendant resources before rename/delete**

Inside the existing per-owner mutation queue, list before the adapter call. For a directory, generate a renamed resource for every `path === root` or `path.startsWith(root + '/')`; for deletion, publish every prior descendant. Keep a single-event result for ordinary files.

- [ ] **Step 3: Make editor sessions expand batches before existing logic**

Apply each leaf transition in order, preserving duplicate-operation suppression and returning the combined effects. This uses the existing dirty-delete handling, rather than adding a second deletion policy.

- [ ] **Step 4: Run the two focused tests and verify they pass**

Run the two commands from Task 1. Expected: all tests PASS.

### Task 3: Centralize the resource-open decision

**Files:**
- Create: `src/services/projectExplorerService.ts`
- Create: `src/services/__tests__/projectExplorerService.test.ts`
- Modify: `src/components/filetree/ProjectFileTree.vue`

- [ ] **Step 1: Write failing routing tests**

Test a complete document returning an editor action, a truncated document returning a safe rejection, media returning a canvas-media action, canvas returning a canvas-open action, and binary returning a binary action.

- [ ] **Step 2: Run the routing test and verify it fails**

Run: `pnpm exec esbuild src/services/__tests__/projectExplorerService.test.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=/tmp/project-explorer-service.test.mjs && node --test /tmp/project-explorer-service.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure async routing service**

It receives `ProjectFileService` and `ProjectResource`, uses the existing `kind` and `canEditProjectText` contract, and returns a discriminated result without importing Vue or the event bus.

- [ ] **Step 4: Replace `ProjectFileTree.vue` open branching**

Call the explorer service from the current click/context-menu handler, then emit the pre-existing editor/canvas events based on its result. Preserve preview and system-open actions for binary resources.

- [ ] **Step 5: Run routing and file-tree tests**

Run the routing command and `pnpm exec esbuild src/components/filetree/__tests__/projectFileTreeCanvas.test.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=/tmp/project-file-tree-canvas.test.mjs && node --test /tmp/project-file-tree-canvas.test.mjs`. Expected: all tests PASS.

### Task 4: Complete the verification record

**Files:**
- Modify: `scripts/run-focused-tests.mjs`
- Modify: `docs/wiki/开发/文件树一期资源身份与文件安全SDD.md`

- [ ] **Step 1: Add the explorer-service test to the focused suite**

Append only `src/services/__tests__/projectExplorerService.test.ts` next to the existing project-file service tests.

- [ ] **Step 2: Run scoped and repository gates**

Run: `pnpm run test:focused`, `cargo test --manifest-path src-tauri/Cargo.toml`, `pnpm exec vite build`, and `git diff --check`.

Expected: scoped tests, Rust tests, Vite build and diff check pass. Record unrelated existing typecheck errors accurately if they remain.

- [ ] **Step 3: Update the SDD implementation record**

Replace the incomplete directory/open-route entries with exact code locations and test counts. State explicitly that Desktop external rename without a filesystem identity remains a delete/create observation, not a guessed rename.

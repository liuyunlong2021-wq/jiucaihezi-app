# File Tree Phase 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the editor-side UI contract for project resources: save the active project file, export its original file, use a Chinese editor context menu, and create project documents through one resource command.

**Architecture:** Keep `ProjectFileService` as the only storage boundary and `editorSessionStore` as the only dirty/revision state. Move the resource-export flow out of `ProjectFileTree.vue` into a service command that both tree and editor call. The editor only decides presentation and emits/consumes resource intent; it never writes Desktop paths, OPFS, or conversion-export output for a project resource.

**Tech Stack:** Vue 3 Composition API, Tiptap, TypeScript, Tauri 2, IndexedDB/OPFS, Node test runner.

---

### Task 1: Shared Original-Resource Export Command

**Files:**
- Modify: `src/services/projectFileActions.ts`
- Modify: `src/components/filetree/ProjectFileTree.vue`
- Test: `src/services/__tests__/projectFileActions.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test that requires the action layer to expose `exportResources(resources)` without an UI callback and rejects empty or cross-project resource lists before any platform export runs.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test src/services/__tests__/projectFileActions.test.ts`

Expected: FAIL because `exportResources` still requires a caller-provided export callback.

- [ ] **Step 3: Implement the minimal command**

Move Desktop directory selection, collision retry, Web directory picker, OPFS export enumeration, and browser cancellation handling from `ProjectFileTree.vue` into `projectFileActions.ts`. Keep the action input as `ProjectResource[]`; use the first resource's `owner` and `runtime`, and preserve the existing Desktop/Web collision semantics.

- [ ] **Step 4: Replace the tree callback call site**

Make `ctxExportSelected()` call the new action directly. Leave “export project” separate because it exports the entire owner rather than a resource selection.

- [ ] **Step 5: Run the focused test to verify it passes**

Run: `node --test src/services/__tests__/projectFileActions.test.ts`

Expected: PASS.

### Task 2: Active-Tab Save and Original Export

**Files:**
- Modify: `src/components/editor/EditorPanel.vue`
- Modify: `src/components/editor/__tests__/editorInteractionSurface.test.ts`

- [ ] **Step 1: Write failing interaction tests**

Replace the “全部保存” source-contract assertion with tests requiring a “保存” control that is enabled only for the active dirty project session, and requiring an editor export handler that calls the shared resource export action after `saveProjectSession()` succeeds.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test src/components/editor/__tests__/editorInteractionSurface.test.ts`

Expected: FAIL because the toolbar still calls `saveAllProjectSessions` and `exportDoc()` still invokes format conversion.

- [ ] **Step 3: Implement the minimal editor changes**

Replace `hasSaveableProjectChanges` and `saveAllProjectSessions()` with an active-session predicate and a wrapper around `saveProjectSession()`. Replace the export submenu, conversion preview/options/template/chunk entry points, and export UI with one “导出当前文件” command. It must reject absent/deleted/non-project tabs, save a dirty project session first, then call `projectFileActions.exportResources([resource])`.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --test src/components/editor/__tests__/editorInteractionSurface.test.ts`

Expected: PASS.

### Task 3: Chinese Context Menu and Text-Mode Safety

**Files:**
- Modify: `src/components/editor/EditorPanel.vue`
- Modify: `src/components/editor/__tests__/editorInteractionSurface.test.ts`

- [ ] **Step 1: Write failing interaction tests**

Add tests requiring a `@contextmenu.prevent` handler on rich and plain editor surfaces, a Chinese menu, and distinct rich/plain command visibility. Verify the menu uses the existing save/export/new-document/locate and Tiptap or textarea editing commands instead of a second file API.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test src/components/editor/__tests__/editorInteractionSurface.test.ts`

Expected: FAIL because the native context menu is currently intentionally left available.

- [ ] **Step 3: Implement the minimal menu**

Add one positioned menu state and one command dispatcher. Rich text commands use the existing `editor.chain().focus()` calls; plain text only exposes native-text-safe commands and never invokes rich formatting. Add outside-click and Escape close handling without clearing selection. Include save, export, and locate only when an active project resource supports them.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --test src/components/editor/__tests__/editorInteractionSurface.test.ts`

Expected: PASS.

### Task 4: Unified Project Document Intent

**Files:**
- Modify: `src/components/editor/EditorPanel.vue`
- Modify: `src/components/creation/CreationPanel.vue`
- Modify: `src/components/filetree/ProjectFileTree.vue`
- Modify: `src/components/filetree/__tests__/projectFileTreeCanvas.test.ts`

- [ ] **Step 1: Write a failing test**

Require editor and creation panel to emit the existing `project:new-document` intent, and require the tree command host to resolve the selection to the current directory, create the resource, read its revision, open it in the editor, and switch to the editor panel.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test src/components/filetree/__tests__/projectFileTreeCanvas.test.ts`

Expected: FAIL because the creation panel does not expose the shared intent.

- [ ] **Step 3: Implement the minimal intent entry**

Add the creation-panel entry using `emitEvent('project:new-document')`; keep target resolution and creation exclusively in the existing tree command host. Do not duplicate target-directory or naming logic in the editor or canvas.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --test src/components/filetree/__tests__/projectFileTreeCanvas.test.ts`

Expected: PASS.

### Task 5: Regression, Audit, and Documentation

**Files:**
- Modify: `scripts/run-focused-tests.mjs`
- Modify: `docs/wiki/开发/文件树五期编辑区与项目文档统一SDD.md`
- Modify: `docs/wiki/hot.md`
- Modify: `docs/wiki/log.md`

- [ ] **Step 1: Add the new focused tests to the test runner**

Include the action, interaction, and tree test files in `scripts/run-focused-tests.mjs`.

- [ ] **Step 2: Run final automated verification**

Run: `pnpm run test:focused:build`, `pnpm run test:focused:run`, `cargo test --manifest-path src-tauri/Cargo.toml`, `pnpm exec vite build`, and `git diff --check`.

Expected: all commands exit 0; any existing `vue-tsc` failures are recorded by exact file and line and not represented as success.

- [ ] **Step 3: Audit and fix blocking findings**

Review the final diff for resource-path bypasses, conversion-export remnants, context-menu focus loss, project-switch races, and Desktop/Web divergence. Fix Critical or Important findings and rerun the affected verification.

- [ ] **Step 4: Update Wiki and commit**

Mark the fifth SDD complete only with verification evidence, refresh `hot.md`, append `log.md`, and commit only the phase-five implementation, tests, plan, and Wiki files.

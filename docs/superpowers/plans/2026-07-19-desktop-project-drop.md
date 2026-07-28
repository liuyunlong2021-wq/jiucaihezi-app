# Desktop Project Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route Desktop Finder drops through project storage before any panel renders or references the file.

**Architecture:** A Rust command copies explicitly supplied Finder drop paths into a validated project-relative destination. A shared frontend action invokes it, resolves the resulting `ProjectResource`s, and panels consume only those resources. File-tree content changes update no structural nodes; structural changes refresh only loaded parents.

**Tech Stack:** Vue 3, TypeScript, Tauri 2/Rust, node:test.

---

### Task 1: External-drop file action

**Files:**
- Modify: `src-tauri/src/commands/dev.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/services/projectFileActions.ts`
- Test: `src/services/__tests__/projectFileActions.test.ts`

- [ ] Add a failing action test for importing a list of Desktop paths into a valid target and returning project resources.
- [ ] Run `pnpm run test:focused:run -- projectFileActions` and confirm the test fails because the action is absent.
- [ ] Add `dev_import_project_drop` that validates root, relative target and ordinary source files, then reuses `import_external_files`.
- [ ] Add `importDesktopPaths({ owner, paths, targetPath })` to `projectFileActions`; invoke the command and resolve returned paths with the runtime service.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: File tree structural refresh

**Files:**
- Modify: `src/components/filetree/ProjectFileTree.vue`
- Test: `src/components/filetree/__tests__/projectFileTreeCanvas.test.ts`

- [ ] Add a failing source-contract test requiring `changed` events to avoid `loadFileTree()` and structural events to call `refreshAffectedDirectory()`.
- [ ] Run the focused test and confirm it fails.
- [ ] Route resource changes by type: content changes preserve nodes; created/deleted/renamed refresh affected loaded parents, with root fallback.
- [ ] Re-run the focused test and confirm it passes.

### Task 3: One Desktop drop dispatcher and panel consumers

**Files:**
- Create: `src/services/desktopProjectDrop.ts`
- Modify: `src/layouts/WorkspaceLayout.vue`
- Modify: `src/components/creation/CreationPanel.vue`
- Modify: `src/components/chat/ChatPanel.vue`
- Modify: `src/components/editor/EditorPanel.vue`
- Modify: `src/components/filetree/ProjectFileTree.vue`
- Test: `src/components/__tests__/desktopProjectDrop.test.ts`

- [ ] Add a failing source-contract test for one `onDragDropEvent` dispatcher, panel drop targets, and project-resource events.
- [ ] Run the test and confirm it fails.
- [ ] Dispatch by `data-project-drop-target`; project tree returns selected directory, canvas imports media into `jc-media`, chat/editor import to `jc-imports`.
- [ ] Make panels consume `ProjectResource`s: add media to canvas, attach a project-backed file to chat, and open text or create a Markdown reference document in the editor.
- [ ] Remove direct Data URL/FileReader drop persistence from the editor and silent Desktop `plugin-fs` path reads from chat.
- [ ] Re-run the test and confirm it passes.

### Task 4: Documentation and verification

**Files:**
- Modify: `docs/wiki/开发/文件树四点五期文件总管统一SDD.md`

- [ ] Record the Desktop drop routing, directory rules, file-tree refresh fix, automated tests, and manual acceptance matrix.
- [ ] Run `pnpm run test:focused:run`, `pnpm exec vue-tsc -b`, `pnpm exec vite build`, and `git diff --check`.
- [ ] Run Desktop manual acceptance for one canvas media drop, one chat attachment, one editor drop, one project-tree drop, and canvas switching.

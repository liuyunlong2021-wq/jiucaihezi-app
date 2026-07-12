# Local Dev Runtime V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let 韭菜盒子 Studio inspect, edit, build, and package a selected local source project through model tool calls.

**Architecture:** Add a first-party Tauri execution layer instead of relying on OpenClaw Gateway for core developer actions. The frontend owns project-root selection, tool definitions, argument validation, and result formatting; Rust owns path confinement, file IO, directory listing, and command execution inside the selected root.

**Tech Stack:** Vue 3, Tauri v2 commands, Node test runner for pure TypeScript policy, Rust std process/file APIs.

---

### Task 1: Frontend Project Runtime Policy

**Files:**
- Create: `src/utils/devProjectTools.ts`
- Create: `src/utils/__tests__/devProjectTools.test.ts`

- [ ] Add tests for relative path normalization, forbidden shell syntax detection, and missing-project-root error payloads.
- [ ] Implement tool definitions for `dev_list_files`, `dev_read_file`, `dev_write_file`, and `dev_run_command`.
- [ ] Implement an executor wrapper that returns JSON results and never calls tools without a selected project root.

### Task 2: Tauri Runtime Commands

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] Add `dev_list_files`, `dev_read_file`, `dev_write_file`, and `dev_run_command`.
- [ ] Confine every file path and command working directory to the selected root.
- [ ] Skip large/generated folders when listing files.
- [ ] Execute commands without shell expansion and return stdout, stderr, exit code, and duration.

### Task 3: Chat Tool Integration

**Files:**
- Modify: `src/composables/useChat.ts`
- Modify: `src/utils/toolRegistry.ts`

- [ ] Add dev tools to model-visible stable tools when a project root is selected.
- [ ] Execute dev tool calls before OpenClaw/Gateway fallback.
- [ ] Add visible cards for project file list, project read, project write, and project command.

### Task 4: Tool Warehouse Project Picker

**Files:**
- Modify: `src/components/tools/ToolWarehousePanel.vue`

- [ ] Add a compact project picker row in the tool warehouse.
- [ ] Store selected project root in localStorage.
- [ ] Show selected folder name and allow clearing it.

### Task 5: Verification

**Files:**
- All files above.

- [ ] Run focused Node tests.
- [ ] Run `pnpm build`.
- [ ] Run `cargo check`.

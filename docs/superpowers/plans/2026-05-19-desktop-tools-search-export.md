# Desktop Tools Search Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make desktop search, file-to-Markdown, and message export stable without depending on the OpenClaw Gateway path.

**Architecture:** Keep web-compatible cloud paths where needed, but add desktop-first local wrappers for network search and browser-side export. Model-visible tools should only include stable tools by default; Gateway-dependent tools remain present in the warehouse but are not offered to the model until a later readiness-gated implementation.

**Tech Stack:** Vue 3, Tauri v2, Node test runner, existing `safeFetch`, existing Office API helpers.

---

### Task 1: Tool Exposure Guard

**Files:**
- Modify: `src/utils/chatToolPolicy.ts`
- Modify: `src/utils/__tests__/chatToolPolicy.test.ts`
- Modify: `src/composables/useChat.ts`

- [ ] Add a failing test proving OpenClaw/Gateway tools are hidden from the default exposed tool list.
- [ ] Add a small policy helper that filters tools by source.
- [ ] Use that helper in `buildAvailableTools()` so `file_read`, `file_write`, `bash`, `browser`, and `cron` are not exposed in normal chat.
- [ ] Run the focused policy test.

### Task 2: Desktop Search Direct Path

**Files:**
- Modify: `src/utils/webSearch.ts`
- Modify: `src/components/chat/ChatPanel.vue`
- Add: `src/utils/__tests__/webSearch.test.ts`

- [ ] Add tests for Jina text parsing and desktop quota display behavior.
- [ ] In Tauri, search `https://s.jina.ai/<query>` through `safeFetch` and build the same markdown context without using user API key or `/api/web-search`.
- [ ] Keep Web behavior unchanged.
- [ ] Make the chat search pill show `搜索` instead of `搜索(3)` on desktop.

### Task 3: Universal Message Export

**Files:**
- Add: `src/utils/messageExport.ts`
- Add: `src/utils/__tests__/messageExport.test.ts`
- Modify: `src/components/chat/MessageBubble.vue`

- [ ] Add tests for Markdown/TXT/HTML export files and format inference.
- [ ] Add a local export builder that creates browser-downloadable text files.
- [ ] Replace Office-only export UI with a compact `导出` menu on assistant messages.
- [ ] Keep Office export options for Word/PDF/PPT/Excel via existing Office helpers.

### Task 4: Verification

**Files:**
- All touched files above.

- [ ] Run focused Node tests for policy, search, and message export.
- [ ] Run `pnpm build`.
- [ ] Run `cargo check` in `src-tauri`.

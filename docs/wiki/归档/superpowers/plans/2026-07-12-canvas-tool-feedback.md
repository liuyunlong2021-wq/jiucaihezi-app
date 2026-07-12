# Canvas Tool Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make canvas text placement immediate, add pen and right-click tool entries, and make undo/redo functional.

**Architecture:** Use Leafer's `PointerEvent.DOWN` and `Editor.openInnerEditor(target, true)` for text so editing begins with the click. Use the built-in `Pen` class for freehand strokes. Keep a capped, local history of `app.tree` JSON snapshots because Leafer Editor has no undo/redo API.

**Tech Stack:** Vue 3, TypeScript, LeaferJS 2.2.0.

---

### Task 1: Align the draw tools with Leafer events

**Files:**
- Modify: `src/components/creation/CreationPanel.vue`

- [ ] Replace text creation's `DragEvent.START` listener with a `PointerEvent.DOWN` listener.
- [ ] Create `new LeaferText` at `event.x/event.y`, add it to `app.tree`, then call `app.editor.openInnerEditor(text, true)` immediately.
- [ ] Keep arrows on Leafer's existing drag events; add a `Pen` on drag start, append page points during drag, and call `pen.paint()` on drag end.

### Task 2: Add shared right-click entries and local history

**Files:**
- Modify: `src/components/creation/CreationPanel.vue`

- [ ] Add `arrow`, `text`, and `pen` entries to the existing right-click menu; each sets `drawType` and calls the same `canvasTool('draw')` entry.
- [ ] Snapshot the tree before a mutation and after a completed draw/text input. Cap the in-memory history at 50 snapshots.
- [ ] Restore snapshots with Leafer's `UI.one(json)` and wire undo/redo buttons and shortcuts to it.

### Task 3: Verify

**Files:**
- Modify: `src/components/creation/CreationPanel.vue`

- [ ] Run `pnpm exec vue-tsc -b`.
- [ ] Run `pnpm exec vite build`.
- [ ] In the desktop app, verify a text click immediately opens the native content-editable overlay, each right-click tool activates, a pen stroke renders, and Ctrl+Z / Ctrl+Shift+Z restore states.

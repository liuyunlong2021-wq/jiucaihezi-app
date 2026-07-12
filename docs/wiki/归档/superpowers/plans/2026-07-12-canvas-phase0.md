# Canvas Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist one complete desktop canvas as a local JSON document without embedding image bytes, then restore the same Leafer scene after reopening.

**Architecture:** `canvasDocument.ts` owns pure JSON normalization and migration. `canvasPersistence.ts` owns project-file reads and atomic writes. `canvasStore.ts` owns asset metadata and the current serializable document; `CreationPanel.vue` supplies and restores Leafer snapshots.

**Tech Stack:** Vue 3, Pinia, TypeScript, Tauri IPC, LeaferJS, Node built-in test runner.

---

### Task 1: Define and test the V2 document contract

**Files:**
- Create: `src/components/canvas/canvasDocument.ts`
- Create: `src/components/canvas/__tests__/canvasDocument.test.ts`
- Modify: `src/types/canvas.ts`
- Modify: `scripts/run-focused-tests.mjs`

- [x] **Step 1: Write failing tests**

```ts
test('normalizes an image data URL into its project-relative asset path', () => {
  const result = createCanvasDocument({
    canvasId: 'canvas-1',
    scene: [{ tag: 'Image', id: 'image-1', url: 'data:image/png;base64,AAAA' }],
    assets: { 'image-1': { id: 'image-1', kind: 'image', path: 'jc-media/images/a.png', source: 'creation', createdAt: 1 } },
  })
  assert.equal(result.scene[0].url, 'jc-media/images/a.png')
  assert.equal(JSON.stringify(result).includes('base64'), false)
})
```

- [x] **Step 2: Run the test and verify RED**

Run: `pnpm exec esbuild src/components/canvas/__tests__/canvasDocument.test.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=/tmp/canvas-document.test.mjs && node --test /tmp/canvas-document.test.mjs`

Expected: FAIL because `canvasDocument.ts` does not exist.

- [x] **Step 3: Implement the smallest pure document helpers**

```ts
export function createCanvasDocument(input: CanvasDocumentInput): CanvasDocumentV2 {
  return {
    version: 2,
    canvasId: input.canvasId,
    updatedAt: input.updatedAt ?? Date.now(),
    viewport: input.viewport ?? { x: 0, y: 0, zoom: 1 },
    scene: normalizeSceneForStorage(input.scene, input.assets),
    assets: input.assets,
  }
}
```

The normalizer must recurse through `children`, ensure every node has an ID, and replace image data/blob URLs with the matching asset path.

- [x] **Step 4: Run the focused canvas test and verify GREEN**

Run the command from Step 2.

Expected: PASS.

### Task 2: Persist and restore V2 documents atomically

**Files:**
- Modify: `src/components/canvas/canvasPersistence.ts`
- Modify: `src/components/canvas/__tests__/canvasDocument.test.ts`

- [x] **Step 1: Add failing tests for legacy migration and V2 restoration**

```ts
test('migrates a V1 layer document to an empty V2 scene with image assets', () => {
  const migrated = migrateCanvasDocument({ version: 1, canvasId: 'default', updatedAt: 1, viewport: { x: 0, y: 0, zoom: 1 }, layers: [legacyLayer], annotations: [] })
  assert.equal(migrated.version, 2)
  assert.equal(migrated.assets[legacyLayer.id].path, legacyLayer.path)
})
```

- [x] **Step 2: Run the focused canvas test and verify RED**

Run the command from Task 1, Step 2.

Expected: FAIL because migration is not implemented.

- [x] **Step 3: Implement V2 read/write plumbing**

`saveCanvas` writes `{canvasId}.jccanvas.tmp` first, then invokes the existing rename IPC to replace the final file. `restoreCanvas` reads up to 30 MB, accepts V2, and migrates V1 in memory.

- [x] **Step 4: Run the focused canvas test and verify GREEN**

Run the command from Task 1, Step 2.

Expected: PASS.

### Task 3: Connect the complete Leafer scene to persistence

**Files:**
- Modify: `src/components/canvas/canvasStore.ts`
- Modify: `src/components/creation/CreationPanel.vue`
- Modify: `src/components/__tests__/creationPanelContractUi.test.ts`

- [x] **Step 1: Add failing contract assertions**

```ts
assert.match(source, /getCanvasDocument\(scene:/)
assert.match(source, /restoreCanvas\(canvasStore\.canvasId\)/)
assert.match(source, /app\.tree\.children\.map\(.*toJSON/)
```

- [x] **Step 2: Run the contract test and verify RED**

Run: `pnpm exec esbuild src/components/__tests__/creationPanelContractUi.test.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=/tmp/creation-panel-contract.test.mjs && node --test /tmp/creation-panel-contract.test.mjs`

Expected: FAIL because the panel only stores `layers[]`.

- [x] **Step 3: Implement the minimal scene bridge**

Give every new Leafer root node a stable ID. Keep image asset metadata in `canvasStore`, save `app.tree.children.map(child => child.toJSON())`, and restore with `UI.one(json)`. Debounce saves for 500 ms and flush on unmount.

- [x] **Step 4: Run the contract test and verify GREEN**

Run the command from Step 2.

Expected: PASS.

### Task 4: Verify Phase 0

**Files:**
- Test: `src/components/canvas/__tests__/canvasDocument.test.ts`
- Test: `src/components/__tests__/creationPanelContractUi.test.ts`

- [x] **Step 1: Run focused canvas tests**

Run: `pnpm exec esbuild src/components/canvas/__tests__/canvasDocument.test.ts src/components/__tests__/creationPanelContractUi.test.ts --bundle --platform=node --format=esm --alias:@=./src --outbase=src --outdir=/tmp/jc-canvas-tests && node --test /tmp/jc-canvas-tests/components/canvas/__tests__/canvasDocument.test.js /tmp/jc-canvas-tests/components/__tests__/creationPanelContractUi.test.js`

Expected: PASS.

- [x] **Step 2: Run type checking**

Run: `pnpm exec vue-tsc -b`

Expected: PASS.

- [x] **Step 3: Commit Phase 0**

```bash
git add src/types/canvas.ts src/components/canvas src/components/creation/CreationPanel.vue src/components/__tests__/creationPanelContractUi.test.ts scripts/run-focused-tests.mjs docs/superpowers/plans/2026-07-12-canvas-phase0.md
git commit -m "feat: 持久化完整画布场景"
```

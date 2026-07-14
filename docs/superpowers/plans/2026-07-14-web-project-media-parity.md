# Web Project Media Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make Web project files, canvas assets, uploads, generated media, preview, and export behave like the Desktop APP without server-side media storage.

**Architecture:** Text, project metadata, and `.jccanvas` documents remain in IndexedDB `documents`. Web binary files live in the browser Origin Private File System (OPFS), addressed by a stable file ID stored in the project record metadata. `webProjectFiles` remains the only project mutation boundary; a binary write is always `OPFS bytes -> IndexedDB metadata -> project change event`, and metadata failure removes the just-written bytes. The file tree, creation runtime, canvas persistence, and model tools consume that boundary.

**Tech Stack:** Vue 3, TypeScript, IndexedDB, OPFS (`navigator.storage.getDirectory()`), Web Locks, BroadcastChannel, native `<input type=file>`, `File`/`Blob` streams, Node test runner.

---

### Task 1: Add Web Binary Project Storage

**Files:**
- Create: `src/utils/webProjectBinaryStore.ts`
- Create: `src/utils/__tests__/webProjectBinaryStore.test.ts`
- Modify: `scripts/run-focused-tests.mjs`

- [ ] **Step 1: Write failing binary-store tests**

Cover a memory-backed adapter that writes `Blob` and `ReadableStream` input, reads and deletes a stable file ID, and reports an unsupported browser clearly:

```ts
test('web project binary store keeps bytes outside IndexedDB metadata', async () => {
  const store = createWebProjectBinaryStore(memoryBinaryAdapter())
  const size = await store.write('asset_1', new Blob(['hello'], { type: 'text/plain' }))
  assert.equal(size, 5)
  assert.equal(await (await store.read('asset_1')).text(), 'hello')
  await store.remove('asset_1')
  await assert.rejects(() => store.read('asset_1'), /不存在/)
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm run test:focused:build
node --test /private/tmp/jc-focused-tests/utils/__tests__/webProjectBinaryStore.test.js
```

Expected: fail because `webProjectBinaryStore.ts` and its API do not exist.

- [ ] **Step 3: Implement the minimum OPFS store**

Define this public boundary:

```ts
export type WebBinarySource = Blob | ReadableStream<Uint8Array>

export interface WebProjectBinaryAdapter {
  write(id: string, source: WebBinarySource): Promise<number>
  read(id: string): Promise<Blob>
  remove(id: string): Promise<void>
  estimate(): Promise<{ quota?: number; usage?: number }>
  persist(): Promise<boolean>
}

export function createWebProjectBinaryStore(adapter?: WebProjectBinaryAdapter)
export async function ensureWebProjectStorage(expectedBytes?: number): Promise<{
  persisted: boolean
  usage?: number
  quota?: number
}>
```

The browser adapter must use `navigator.storage.getDirectory()`, write chunks with `FileSystemWritableFileStream`, store files under a private `jc-project-files/` directory, and call `navigator.storage.persist()` best-effort. It must preflight known `Blob.size` against `navigator.storage.estimate()` and throw a Chinese actionable error when OPFS is unavailable or quota is exhausted. It must not use Base64 or IndexedDB for binary bytes.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2. Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/webProjectBinaryStore.ts src/utils/__tests__/webProjectBinaryStore.test.ts scripts/run-focused-tests.mjs
git commit -m "feat(web): add local project binary storage" -m "涉及常识 #3 #11"
```

### Task 2: Extend the Web Project File Boundary for Binary Files

**Files:**
- Modify: `src/utils/webProjectFiles.ts`
- Modify: `src/utils/__tests__/webProjectFiles.test.ts`
- Modify: `src/composables/useFileStore.ts`
- Modify: `src/utils/idb.ts`
- Modify: `src/runtime/direct/webProjectTools.ts`
- Modify: `src/runtime/direct/__tests__/webProjectTools.test.ts`

- [ ] **Step 1: Write failing project-file tests**

Add tests proving that a binary file creates a `documents` metadata record with a stable `metadata.opfsFileId`, can be read as a blob, survives file and folder rename without copying bytes, and is deleted together with its record. Cover metadata-write failure cleanup, recursive folder deletion cleanup, and rejection of `write` or `edit` against a binary path.

```ts
await files.writeBinary(project.id, 'jc-media/images/a.png', pngBlob, { category: 'image', mimeType: 'image/png' })
assert.equal((await files.read(project.id, 'jc-media/images/a.png')).metadata?.opfsFileId, '...')
assert.equal((await files.readBinary(project.id, 'jc-media/images/a.png')).size, pngBlob.size)
```

Add a tool test showing `read` of an uploaded image produces an OpenAI-compatible data URL follow-up rather than the old remote URL field.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm run test:focused:build
node --test /private/tmp/jc-focused-tests/utils/__tests__/webProjectFiles.test.js /private/tmp/jc-focused-tests/runtime/direct/__tests__/webProjectTools.test.js
```

Expected: fail because binary project APIs are absent.

- [ ] **Step 3: Implement project binary methods**

Add `'binary'` to `FileEntry.category`, inject the binary store into `createWebProjectFiles`, and add these methods:

```ts
writeBinary(projectId, path, source, { category, mimeType, metadata? })
readBinary(projectId, path)
readBinaryDataUrl(projectId, path)
```

`writeBinary` must require real IndexedDB metadata when using the production adapter, check available quota, write OPFS bytes first, then persist a `FileEntry` whose `content` is empty and whose metadata contains `binaryStorage: 'opfs'`, `opfsFileId`, `projectId`, `relativePath`, and optional provenance metadata. If metadata persistence fails, remove the new OPFS object before returning the error. `remove` must delete each descendant OPFS object before removing its metadata. `rename` changes paths only. Existing `write` and `edit` must reject binary records; `glob` and `grep` must continue to skip binary content.

`webProjectTools.read` must keep text paging unchanged and create a data URL only for image binary records; video and audio return a typed file summary rather than pretending to be text. The deprecated URL-only `addMedia` path must not be used by new upload or creation code.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the command from Step 2. Expected: all project and tool tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/webProjectFiles.ts src/utils/__tests__/webProjectFiles.test.ts src/composables/useFileStore.ts src/utils/idb.ts src/runtime/direct/webProjectTools.ts src/runtime/direct/__tests__/webProjectTools.test.ts
git commit -m "feat(web): store binary project files locally" -m "涉及常识 #1 #3 #11 #14"
```

### Task 3: Put Web Canvas Documents in the Current Project

**Files:**
- Modify: `src/components/canvas/canvasPersistence.ts`
- Modify: `src/components/canvas/__tests__/canvasDocument.test.ts`
- Modify: `src/components/filetree/__tests__/projectFileTreeCanvas.test.ts`

- [ ] **Step 1: Write failing Web canvas persistence tests**

Test that Web `createCanvasFile`, `listCanvasFiles`, `saveCanvas`, `restoreCanvasAtPath`, `copyCanvasFile`, `renameCanvasFile`, and `deleteCanvasFile` use the active Web project and `jc-canvas/*.jccanvas`, not `localStorage`. Include a project-switch test proving the last opened canvas path is namespaced by project ID and that persisted canvas media references remain project-relative paths.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm run test:focused:build
node --test /private/tmp/jc-focused-tests/components/canvas/__tests__/canvasDocument.test.js /private/tmp/jc-focused-tests/components/filetree/__tests__/projectFileTreeCanvas.test.js
```

Expected: fail because Web canvas persistence currently returns no project files and uses `localStorage`.

- [ ] **Step 3: Implement the Web branch with `webProjectFiles`**

For non-Tauri runtime, resolve `projectStore.webProjectId`; require a selected project; use `webProjectFiles.write/read/list/rename/remove` for every canvas operation. Namespace the last-path preference with `webProjectId`. Canvas documents stay UTF-8 text project files and persist `jc-media/...` paths, so no binary store is involved. Keep Desktop Tauri calls unchanged.

- [ ] **Step 4: Run tests and verify GREEN**

Run the command from Step 2. Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas/canvasPersistence.ts src/components/canvas/__tests__/canvasDocument.test.ts src/components/filetree/__tests__/projectFileTreeCanvas.test.ts
git commit -m "feat(web): keep canvases in project files" -m "涉及常识 #3 #28"
```

### Task 4: Complete File Tree Upload, Preview, Import, and Export UI

**Files:**
- Modify: `src/components/filetree/ProjectFileTree.vue`
- Modify: `src/components/filetree/__tests__/projectFileTreeCanvas.test.ts`
- Modify: `src/utils/exportSave.ts`
- Modify: `src/utils/__tests__/exportSave.test.ts`
- Create: `src/utils/webProjectTransfer.ts`
- Create: `src/utils/__tests__/webProjectTransfer.test.ts`

- [ ] **Step 1: Write failing UI/source-contract tests**

Add tests that require hidden file inputs, a folder input (`webkitdirectory`), drop handling, root and folder upload menu items, the existing in-app `MediaViewer` preview, and project export/import. Add transfer tests that preserve nested text and binary paths and export a real Blob rather than fetching a remote URL. Test the three collision decisions: overwrite, keep both, and cancel.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm run test:focused:build
node --test /private/tmp/jc-focused-tests/components/filetree/__tests__/projectFileTreeCanvas.test.js /private/tmp/jc-focused-tests/utils/__tests__/exportSave.test.js /private/tmp/jc-focused-tests/utils/__tests__/webProjectTransfer.test.js
```

Expected: fail because project upload, folder upload, import/export, and in-app media preview do not exist.

- [ ] **Step 3: Implement the shared Web file interactions**

Create `webProjectTransfer.ts` as the testable boundary for project import/export. It must export every text record and OPFS Blob with its project-relative directory hierarchy. For import, it must create a new Web project from the selected folder name, strip exactly that top-level folder segment, preserve all nested paths, and route text versus binary input to `write` versus `writeBinary`.

Add two hidden `<input>` controls to `ProjectFileTree.vue`: one multi-file picker and one directory picker. Route toolbar, blank-root context menu, and folder context menu to the same upload handlers. Preserve each `File.webkitRelativePath` when importing a directory. Handle `dragover`, `dragleave`, and `drop` on the tree; use the target folder path or root path. On an existing path, show the user a concrete choice of `覆盖` / `保留两份` / `取消` before writing.

Reuse `MediaViewer.vue` for a compact in-app image/video/audio preview. File right-click gets `预览`; `加入画布` stays separate. `另存为` reads the local Blob and calls `saveGeneratedFile`; it no longer fetches an external URL for local project media. Canvas receives a project path/file ID and resolves a fresh object URL at render time rather than persisting a `blob:` URL.

Implement `导出项目` with `showDirectoryPicker` when available and `webProjectTransfer` for content. Implement `导入项目` using the folder picker and `webProjectTransfer`. If directory selection is unavailable, retain file-level `另存为` as the visible fallback; do not claim full directory export support there.

- [ ] **Step 4: Run tests and verify GREEN**

Run the command from Step 2. Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/filetree/ProjectFileTree.vue src/components/filetree/__tests__/projectFileTreeCanvas.test.ts src/utils/exportSave.ts src/utils/__tests__/exportSave.test.ts src/utils/webProjectTransfer.ts src/utils/__tests__/webProjectTransfer.test.ts
git commit -m "feat(web): add local project file interactions" -m "涉及常识 #3 #6 #17"
```

### Task 5: Persist Web Creation Results into `jc-media`

**Files:**
- Modify: `src/stores/mediaTaskStore.ts`
- Modify: `src/utils/creationMediaCache.ts`
- Modify: `src/components/creation/CreationPanel.vue`
- Modify: `src/stores/__tests__/mediaTaskStore.test.ts`
- Modify: `src/utils/__tests__/creationMediaCacheWeb.test.ts`

- [ ] **Step 1: Write failing creation-result tests**

Cover these facts:

```ts
// A Web task captures projectId when submitted.
// A completed image writes jc-media/images/<timestamp>_<prompt>_<suffix>.<content-type extension>.
// A project switch before completion does not redirect the result.
// A Web canvas task writes the same project-relative path into its canvas document.
// A failed browser download sets an actionable persistence failure, never remote-only success.
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm run test:focused:build
node --test /private/tmp/jc-focused-tests/stores/__tests__/mediaTaskStore.test.js /private/tmp/jc-focused-tests/utils/__tests__/creationMediaCacheWeb.test.js
```

Expected: fail because Web creation tasks are marked `remote-only`, excluded from file-tree saving, and lack a captured project ID.

- [ ] **Step 3: Implement one creation persistence path**

Add `projectId` and `projectPath` to `MediaTask`. Capture the active Web project ID at `submitTask`; reject Web creation before sending a task when no project is selected. `projectPath` is the only durable Web media reference; do not persist a `blob:` URL in `assetUri`. Replace the Web `remote-only` branch with a call into `creationMediaCache` that fetches the result body as a stream and uses `webProjectFiles.writeBinary` at:

```text
jc-media/images/<generated-name>
jc-media/videos/<generated-name>
jc-media/audios/<generated-name>
```

Derive the filename extension from the response content type, with the Desktop default only as fallback. Set `assetStatus = 'local'` only after `writeBinary` succeeds. On a fetch/write failure set `assetStatus = 'failed'`, retain the original URL for an explicit retry action, and surface `保存到项目失败` in `CreationPanel`; CORS failure must remain a visible save failure until a separately approved authenticated relay exists. Update both normal completion and restored-polling completion paths, then update `writeCanvasResult` to use `task.projectId` and `task.projectPath` in Web while retaining Desktop’s absolute-path behavior.

`previewTask` must resolve the local Web project Blob and open the shared in-app `MediaViewer` rather than call `openExternal`.

- [ ] **Step 4: Run tests and verify GREEN**

Run the command from Step 2. Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/stores/mediaTaskStore.ts src/utils/creationMediaCache.ts src/components/creation/CreationPanel.vue src/stores/__tests__/mediaTaskStore.test.ts src/utils/__tests__/creationMediaCacheWeb.test.ts
git commit -m "feat(web): save creation media in active project" -m "涉及常识 #1 #3 #11 #28"
```

### Task 6: Full Verification and Documentation

**Files:**
- Modify: `docs/wiki/开发/Web云端项目Wiki媒体同步与APP升级SDD.md`
- Modify: `docs/wiki/hot.md`

- [ ] **Step 1: Run focused behavior tests**

```bash
pnpm run test:focused:build
node --test \
  /private/tmp/jc-focused-tests/utils/__tests__/webProjectBinaryStore.test.js \
  /private/tmp/jc-focused-tests/utils/__tests__/webProjectFiles.test.js \
  /private/tmp/jc-focused-tests/utils/__tests__/webProjectTransfer.test.js \
  /private/tmp/jc-focused-tests/components/canvas/__tests__/canvasDocument.test.js \
  /private/tmp/jc-focused-tests/components/filetree/__tests__/projectFileTreeCanvas.test.js \
  /private/tmp/jc-focused-tests/stores/__tests__/mediaTaskStore.test.js \
  /private/tmp/jc-focused-tests/runtime/direct/__tests__/webProjectTools.test.js
```

Expected: all pass.

- [ ] **Step 2: Run production verification**

```bash
pnpm exec vue-tsc -b
pnpm run build
git diff --check
```

Expected: every command exits 0. Revert only generated changes created by these commands; preserve user-owned worktree changes.

- [ ] **Step 3: Update the SDD outcome**

Mark the implemented behavior complete, record the actual local storage model and verification evidence, and refresh `hot.md`.

- [ ] **Step 4: Commit**

```bash
git add docs/wiki/开发/Web云端项目Wiki媒体同步与APP升级SDD.md docs/wiki/hot.md
git commit -m "docs: close Web project media parity" -m "涉及常识 #3 #17"
```

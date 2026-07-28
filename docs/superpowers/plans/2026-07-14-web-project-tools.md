# Web Project Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Web build the Desktop second-column project experience, IndexedDB-backed OpenCode-compatible file tools, and automatic progressive Skill loading.

**Architecture:** Keep the existing Vue project tree and editor. Desktop continues to route project operations to Tauri `dev_*` commands; Web routes the same UI actions to `documents` records under one IndexedDB project root. The direct LLM runtime receives a small Skill catalog plus `skill/read/glob/grep/write/edit`, executes calls in the browser, and loops until the model returns text.

**Tech Stack:** Vue 3, TypeScript, Pinia, existing IndexedDB helpers, OpenAI-compatible Chat Completions tool calls, Node test runner.

---

## File Map

- Create `src/utils/webProjectFiles.ts`: IndexedDB project/path operations shared by UI and model tools.
- Create `src/utils/__tests__/webProjectFiles.test.ts`: path, tree, write, edit, rename, and project-isolation checks.
- Modify `src/composables/useFileStore.ts`: admit project records and expose project-aware media insertion.
- Modify `src/stores/projectStore.ts`: track Web project ID/name alongside Desktop directory.
- Modify `src/components/filetree/ProjectFileTree.vue`: select the Desktop or Web file backend without duplicating the UI.
- Modify `src/components/editor/EditorPanel.vue`: keep Web project files on the existing `fileId` editor/save path.
- Modify `src/utils/creationMediaCache.ts`: persist Web creation result metadata under the active project.
- Modify `src/stores/mediaTaskStore.ts`: save user-requested media entries under the active project.
- Create `src/runtime/direct/webProjectTools.ts`: model-facing tool definitions and dispatcher.
- Create `src/runtime/direct/__tests__/webProjectTools.test.ts`: file tool schemas, project scoping, errors, and Skill loading.
- Modify `src/runtime/direct/directEngine.ts`: bounded multi-round tool loop.
- Modify `src/runtime/direct/directTools.ts`: generic tool-result message construction.
- Modify `src/runtime/direct/__tests__/directEngine.test.ts`: multiple sequential calls and loop limit.
- Modify `src/runtime/direct/__tests__/directTools.test.ts`: generic dispatcher success/error pairing.
- Modify `src/utils/skillContentResolver.ts`: load `public/skills/index.json`, resolve a Skill by frontmatter name, and fetch its package files.
- Create `src/utils/__tests__/skillContentResolver.test.ts`: catalog and Skill resolution checks.
- Modify `scripts/build-skills-index.mjs`: include package resource paths in the existing Web Skill index.
- Modify `package.json`: regenerate the existing Skill index before Web/Desktop Vite builds.
- Modify `public/skills/index.json`: commit the generated catalog consumed by Web and tests.
- Modify `scripts/run-focused-tests.mjs`: include the new tests in the repository focused suite after their files exist.
- Modify `src/composables/web/chatCloud.ts`: inject catalog/tool definitions and execute browser tools.
- Modify `src/components/filetree/__tests__/projectFileTreeCanvas.test.ts`: assert the Web backend is wired without changing Desktop behavior.
- Modify `docs/wiki/开发/Web云端项目Wiki媒体同步与APP升级SDD.md`: record completed implementation facts.
- Modify `docs/wiki/hot.md`: refresh the active implementation state.

### Task 1: IndexedDB Project Files

**Files:**
- Create: `src/utils/webProjectFiles.ts`
- Create: `src/utils/__tests__/webProjectFiles.test.ts`
- Modify: `src/composables/useFileStore.ts`

- [ ] **Step 1: Write failing tests for project isolation and path operations**

Cover these exact behaviors with an injected in-memory record adapter:

```ts
const project = await files.createProject('第一部剧')
await files.write(project.id, 'wiki/角色/林风.md', '# 林风')
assert.equal(await files.read(project.id, 'wiki/角色/林风.md'), '# 林风')
assert.deepEqual((await files.glob(project.id, 'wiki/**/*.md')).map(x => x.path), ['wiki/角色/林风.md'])
assert.deepEqual(await files.grep(project.id, '林风'), [{ path: 'wiki/角色/林风.md', line: 1, text: '# 林风' }])
await assert.rejects(() => files.read(project.id, '../other-project/secret.md'), /项目路径/)
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm exec esbuild src/utils/__tests__/webProjectFiles.test.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=/private/tmp/webProjectFiles.test.mjs`

Run: `node --test /private/tmp/webProjectFiles.test.mjs`

Expected: FAIL because `webProjectFiles.ts` does not exist.

- [ ] **Step 3: Implement the minimum project filesystem**

Implement:

```ts
export interface WebProjectRecordAdapter {
  all(): Promise<FileEntry[]>
  get(id: string): Promise<FileEntry | undefined>
  put(entry: FileEntry): Promise<void>
  remove(id: string): Promise<void>
}

export function createWebProjectFiles(adapter: WebProjectRecordAdapter) {
  return {
    listProjects,
    createProject,
    list,
    read,
    glob,
    grep,
    write,
    createFolder,
    edit,
    rename,
    remove,
    addMedia,
  }
}
```

Use `folderId` for hierarchy and `metadata.projectId` plus `metadata.relativePath` for bounded path lookup. Normalize separators, reject absolute paths and `..`, create missing parent folders during `write`, and update descendant paths during folder rename. The production adapter uses existing `getAll/getRecord/setRecord/removeRecord('documents', ...)`.

- [ ] **Step 4: Run the focused tests**

Run: `pnpm exec esbuild src/utils/__tests__/webProjectFiles.test.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=/private/tmp/webProjectFiles.test.mjs`

Run: `node --test /private/tmp/webProjectFiles.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/webProjectFiles.ts src/utils/__tests__/webProjectFiles.test.ts src/composables/useFileStore.ts
git commit -m "feat: add IndexedDB web project filesystem"
```

### Task 2: Web Project Tree and Editor

**Files:**
- Modify: `src/stores/projectStore.ts`
- Modify: `src/components/filetree/ProjectFileTree.vue`
- Modify: `src/components/editor/EditorPanel.vue`
- Modify: `src/components/filetree/__tests__/projectFileTreeCanvas.test.ts`

- [ ] **Step 1: Add failing source-contract tests**

Assert that `ProjectFileTree.vue` imports the Web project filesystem, its non-Tauri `loadFileTree` branch lists IndexedDB entries, Web create/rename/delete actions call that backend, and Web text opening emits a `fileId`.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm exec esbuild src/components/filetree/__tests__/projectFileTreeCanvas.test.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=/private/tmp/projectFileTreeCanvas.test.mjs`

Run: `node --test /private/tmp/projectFileTreeCanvas.test.mjs`

Expected: FAIL on the new Web assertions.

- [ ] **Step 3: Extend the existing project store**

Add persisted Web state without changing Desktop keys:

```ts
const webProjectId = ref(localStorage.getItem('jc_web_project_id') || '')
const webProjectName = ref(localStorage.getItem('jc_web_project_name') || '')

function selectWebProject(project: { id: string; name: string }) { /* persist both */ }
function clearWebProject() { /* clear both */ }
```

Expose `activeProjectId` and make `projectName/hasProject` runtime-aware.

- [ ] **Step 4: Route the existing tree UI to the Web backend**

Keep the current template. In Web mode:

- “选择项目文件夹” becomes “新建或切换项目” and lists existing project roots before offering a new project name.
- `loadFileTree` maps IndexedDB records to the existing `FlatEntry/TreeNode` shape.
- Open text emits `{ fileId, name, content }`, which already uses the editor's IndexedDB branch.
- New folder/file, rename, delete, refresh, copy relative path, and browser download call Web project functions.
- Media uses the stored remote URL for preview/canvas insertion.

- [ ] **Step 5: Keep editor saving on the existing IndexedDB branch**

When Web project files emit `fileId`, `EditorPanel.vue` continues through `saveExistingEditorFile`; preserve `folderId`, `category`, and project metadata during updates.

- [ ] **Step 6: Run the focused tests and type check**

Run: `pnpm exec esbuild src/components/filetree/__tests__/projectFileTreeCanvas.test.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=/private/tmp/projectFileTreeCanvas.test.mjs`

Run: `node --test /private/tmp/projectFileTreeCanvas.test.mjs`

Expected: PASS.

Run: `pnpm exec vue-tsc -b`

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/stores/projectStore.ts src/components/filetree/ProjectFileTree.vue src/components/editor/EditorPanel.vue src/components/filetree/__tests__/projectFileTreeCanvas.test.ts
git commit -m "feat: adapt project tree to web IndexedDB"
```

### Task 3: Generated Assets Enter the Active Web Project

**Files:**
- Modify: `src/utils/creationMediaCache.ts`
- Modify: `src/stores/mediaTaskStore.ts`
- Test: `src/utils/__tests__/mediaDisplayAsset.test.ts`

- [ ] **Step 1: Write a failing test for remote-only project media metadata**

Assert that a Web creation result keeps its remote URL, receives the active Web project ID, and is persisted as a project child without downloading bytes.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm exec esbuild src/utils/__tests__/mediaDisplayAsset.test.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=/private/tmp/mediaDisplayAsset.test.mjs`

Run: `node --test /private/tmp/mediaDisplayAsset.test.mjs`

Expected: FAIL on missing project metadata/persistence.

- [ ] **Step 3: Persist media metadata through the existing file store**

In the Web branch of `creationMediaCache.ts`, call the project-aware `addMedia` with the active project ID and original URL. Apply the same parent project to `mediaTaskStore.saveMediaToFileTree`.

- [ ] **Step 4: Run the focused test**

Run: `pnpm exec esbuild src/utils/__tests__/mediaDisplayAsset.test.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=/private/tmp/mediaDisplayAsset.test.mjs`

Run: `node --test /private/tmp/mediaDisplayAsset.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/creationMediaCache.ts src/stores/mediaTaskStore.ts src/utils/__tests__/mediaDisplayAsset.test.ts
git commit -m "feat: place web media in active project"
```

### Task 4: OpenCode-Compatible Browser File Tools

**Files:**
- Create: `src/runtime/direct/webProjectTools.ts`
- Create: `src/runtime/direct/__tests__/webProjectTools.test.ts`

- [ ] **Step 1: Write failing tool-definition and execution tests**

Test the exact names `read`, `glob`, `grep`, `write`, and `edit`; strict JSON schemas; current-project binding outside model arguments; image read output; traversal rejection; and useful missing-file errors.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm exec esbuild src/runtime/direct/__tests__/webProjectTools.test.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=/private/tmp/webProjectTools.test.mjs`

Run: `node --test /private/tmp/webProjectTools.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement definitions and dispatcher**

Expose:

```ts
export const WEB_PROJECT_TOOL_DEFINITIONS = [read, glob, grep, write, edit]

export function createWebProjectToolExecutor(input: {
  projectId: string
  files: ReturnType<typeof createWebProjectFiles>
  skills: WebSkillLoader
}): DirectToolExecutor
```

Use OpenCode-compatible argument names (`path`, `pattern`, `offset`, `limit`, `content`) and return concise text/JSON. `read` returns text for project text and an image URL/data item for supported images.

- [ ] **Step 4: Run the focused tests**

Run: `pnpm exec esbuild src/runtime/direct/__tests__/webProjectTools.test.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=/private/tmp/webProjectTools.test.mjs`

Run: `node --test /private/tmp/webProjectTools.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/direct/webProjectTools.ts src/runtime/direct/__tests__/webProjectTools.test.ts
git commit -m "feat: add browser project file tools"
```

### Task 5: Progressive Skill Catalog and Loader

**Files:**
- Modify: `src/utils/skillContentResolver.ts`
- Create: `src/utils/__tests__/skillContentResolver.test.ts`
- Modify: `src/runtime/direct/webProjectTools.ts`
- Modify: `src/runtime/direct/__tests__/webProjectTools.test.ts`
- Modify: `scripts/build-skills-index.mjs`
- Modify: `package.json`
- Modify: `public/skills/index.json`

- [ ] **Step 1: Write failing catalog and loader tests**

Mock fetch for `/skills/index.json` and `/skills/JC-短剧-世界模型/SKILL.md`. Assert catalog output contains only `name` and `description`, `skill({ name: 'JC-duanju-shijiemoxing' })` loads the matching package, and unknown names return a clear error.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm exec esbuild src/utils/__tests__/skillContentResolver.test.ts src/runtime/direct/__tests__/webProjectTools.test.ts --bundle --platform=node --format=esm --alias:@=./src --outbase=src --outdir=/private/tmp/web-skill-tests`

Run: `node --test /private/tmp/web-skill-tests/utils/__tests__/skillContentResolver.test.js /private/tmp/web-skill-tests/runtime/direct/__tests__/webProjectTools.test.js`

Expected: FAIL on missing catalog/loader functions.

- [ ] **Step 3: Reuse the existing generated Skill index**

Implement cached functions:

```ts
export async function loadWebSkillCatalog(): Promise<WebSkillCatalogEntry[]>
export function buildWebSkillCatalogPrompt(entries: WebSkillCatalogEntry[]): string
export async function loadWebSkillByName(name: string): Promise<WebLoadedSkill>
```

Resolve frontmatter `name` to index `id`, fetch `/skills/${encodeURIComponent(id)}/SKILL.md`, return the package base `/skills/${id}`, and allow `read` only for resources beneath loaded package bases. Extend `build-skills-index.mjs` to emit sorted relative package file paths, run it before Vite in the existing build scripts, and sample at most 10 paths in the `skill` result like OpenCode.

- [ ] **Step 4: Add the OpenCode-compatible `skill` tool**

Add `skill` to the definitions/dispatcher. Return the full `SKILL.md`, base directory, and sampled package file list available from the generated index/package metadata.

- [ ] **Step 5: Run focused tests**

Run: `node scripts/build-skills-index.mjs`

Expected: `public/skills/index.json` is regenerated with `files` arrays.

Run: `pnpm exec esbuild src/utils/__tests__/skillContentResolver.test.ts src/runtime/direct/__tests__/webProjectTools.test.ts --bundle --platform=node --format=esm --alias:@=./src --outbase=src --outdir=/private/tmp/web-skill-tests`

Run: `node --test /private/tmp/web-skill-tests/utils/__tests__/skillContentResolver.test.js /private/tmp/web-skill-tests/runtime/direct/__tests__/webProjectTools.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/skillContentResolver.ts src/utils/__tests__/skillContentResolver.test.ts src/runtime/direct/webProjectTools.ts src/runtime/direct/__tests__/webProjectTools.test.ts scripts/build-skills-index.mjs package.json public/skills/index.json
git commit -m "feat: add progressive web skill loader"
```

### Task 6: Bounded Direct Tool Loop

**Files:**
- Modify: `src/runtime/direct/directEngine.ts`
- Modify: `src/runtime/direct/directTools.ts`
- Modify: `src/runtime/direct/directTypes.ts`
- Modify: `src/runtime/direct/__tests__/directEngine.test.ts`
- Modify: `src/runtime/direct/__tests__/directTools.test.ts`
- Modify: `src/composables/web/chatCloud.ts`

- [ ] **Step 1: Write failing multi-round tests**

Simulate `skill → read → write → final text`. Assert every request after a call includes paired assistant/tool messages, tools remain available on each round, cancellation stops execution, and exceeding 12 rounds returns a bounded error.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm exec esbuild src/runtime/direct/__tests__/directEngine.test.ts src/runtime/direct/__tests__/directTools.test.ts --bundle --platform=node --format=esm --alias:@=./src --outbase=src --outdir=/private/tmp/direct-loop-tests`

Run: `node --test /private/tmp/direct-loop-tests/runtime/direct/__tests__/directEngine.test.js /private/tmp/direct-loop-tests/runtime/direct/__tests__/directTools.test.js`

Expected: FAIL because the engine stops after one tool round.

- [ ] **Step 3: Generalize tool execution**

Replace the `runWebSearch` special case with:

```ts
export type DirectToolExecutor = (call: DirectToolCall) => Promise<DirectToolResult>
```

Keep `web_search` as one registered executor so current behavior remains.

- [ ] **Step 4: Implement the bounded loop**

For at most 12 rounds: send messages with tools, stream text/tool calls, execute all calls, append paired messages, and continue. Stop on final text, abort signal, or tool-loop limit.

- [ ] **Step 5: Wire Web chat**

In `chatCloud.ts`:

- load the Skill catalog;
- append the catalog prompt only when no Skill is manually selected;
- combine existing `web_search` with `skill/read/glob/grep/write/edit` definitions;
- bind the executor to `projectStore.activeProjectId`;
- preserve manually selected Skill behavior.

- [ ] **Step 6: Run focused tests and type check**

Run: `pnpm run test:focused:build`

Run: `pnpm run test:focused:run`

Expected: PASS.

Run: `pnpm exec vue-tsc -b`

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/runtime/direct src/composables/web/chatCloud.ts
git commit -m "feat: run web tools until completion"
```

### Task 7: End-to-End Verification and Wiki Closeout

**Files:**
- Modify: `docs/wiki/开发/Web云端项目Wiki媒体同步与APP升级SDD.md`
- Modify: `docs/wiki/hot.md`
- Modify: `scripts/run-focused-tests.mjs`

- [ ] **Step 1: Run the complete relevant test set**

Add `webProjectFiles.test.ts`, `webProjectTools.test.ts`, `skillContentResolver.test.ts`, and `projectFileTreeCanvas.test.ts` to `wave1FocusedTests`, then run:

Run: `pnpm run test:focused:build`

Run: `pnpm run test:focused:run`

Expected: PASS.

- [ ] **Step 2: Run repository type checks**

Run: `pnpm exec vue-tsc -b`

Expected: exit 0.

- [ ] **Step 3: Verify the Web workflow in a browser**

Run: `pnpm dev --host 127.0.0.1`

Verify:

1. Create two Web projects and switch between them.
2. Create `wiki/hot.md`, edit it, refresh, and confirm persistence.
3. Ask “创作一部短剧”; confirm the model calls `skill` before project file tools.
4. Confirm `JC-duanju-shijiemoxing` can call `JC-jiyiyasuo`.
5. Confirm a write appears immediately in the second-column tree and opens in the editor.
6. Confirm one project cannot read another project's path.

- [ ] **Step 4: Update the SDD and hot cache with verified facts**

Record the implemented file paths, test commands, and any provider-specific tool-call limitation. Keep the SDD focused on the three adapters.

- [ ] **Step 5: Commit**

```bash
git add docs/wiki/开发/Web云端项目Wiki媒体同步与APP升级SDD.md docs/wiki/hot.md
git commit -m "docs: close web project tools implementation"
```

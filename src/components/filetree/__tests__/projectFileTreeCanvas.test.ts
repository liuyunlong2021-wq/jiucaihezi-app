import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

test('project file tree exposes canvas create, copy, rename, and delete actions', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )

  assert.match(source, /新建画布/)
  assert.match(source, /复制画布/)
  assert.match(source, /ctxNewCanvas/)
  assert.match(source, /ctxCopyCanvas/)
  assert.match(source, /createProjectFileActions/)
  assert.match(source, /projectFileActions\.createCanvas/)
  assert.match(source, /projectFileActions\.copyCanvas/)
  assert.match(source, /projectFileActions\.rename/)
  assert.match(source, /projectFileActions\.remove/)
})

test('project file tree waits for pending canvas persistence before rename or delete', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )

  assert.match(
    source,
    /import \{ (?:consumeLastEvent, )?emitEvent, emitEventAsync, onEvent \} from '@\/utils\/eventBus'/,
  )
  assert.match(source, /import \{ useMediaTaskStore \} from '@\/stores\/mediaTaskStore'/)
  assert.match(source, /const mediaTaskStore = useMediaTaskStore\(\)/)
  assert.ok(
    (
      source.match(
        /const lifecycle: \{ path: string; owner: string; lifecycleId: string; release\?: \(\) => void \} = \{\s+path: n\.path,\s+owner,\s+lifecycleId: crypto\.randomUUID\(\),\s+\}/g,
      ) || []
    ).length === 2,
  )
  assert.match(source, /await emitEventAsync\('canvas:before-rename', lifecycle\)/)
  assert.match(source, /mediaTaskStore\.hasPendingCanvasWrite\(owner, n\.path\)/)
  assert.doesNotMatch(source, /emitProjectResourceChange\(/)
  assert.match(source, /await emitEventAsync\('canvas:before-delete', lifecycle\)/)
  assert.ok(
    (source.match(/if \(!completed\) emitEvent\('canvas:lifecycle-failed', lifecycle\)/g) || [])
      .length === 2,
  )
  assert.match(source, /async function prepareBatchCanvasLifecycle/)
  assert.match(source, /await emitEventAsync\(event, gate\)/)
  assert.match(source, /mediaTaskStore\.hasPendingCanvasWrite\(plan\.owner, resource\.path\)/)
  assert.match(source, /const gates = await prepareBatchCanvasLifecycle\(plan, policy\)/)
  assert.match(source, /const gates = await prepareBatchCanvasLifecycle\(plan\)/)
})

test('project file tree adds images videos and audio to canvas as selectable media', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )

  assert.match(source, /openProjectResource\(projectFiles, resource\)/)
  assert.match(source, /if \(result\.type === 'media' && result\.mediaKind !== 'model3d'\)/)
  assert.match(source, /emitMediaToCanvas\(result\.resource, result\.mediaKind\)/)
  assert.match(
    source,
    /function isCanvasAddableMediaResource\(node: TreeNode \| null \| undefined\): boolean/,
  )
  assert.match(source, /return resourceForNode\(node\)\.kind === 'media'/)
})

test('project file tree virtualizes rows and uses file-type icons without thumbnail work', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )

  assert.match(source, /import \{ useVirtualizer \} from '@tanstack\/vue-virtual'/)
  assert.match(source, /const fileTreeVirtualizer = useVirtualizer/)
  assert.match(source, /const virtualVisibleNodes = computed/)
  assert.match(source, /fileTreeVirtualizer\.getTotalSize\(\)/)
  assert.match(source, /v-for="\{ row, item \} in virtualVisibleNodes"/)
  assert.match(source, /<JcIcon :name="iconForNode\(item\.node\)" class="pft-icon" \/>/)
  assert.match(source, /class="pft-name" :title="item\.node\.name"/)
  assert.doesNotMatch(source, /mediaThumbnail/)
  assert.doesNotMatch(source, /resolveProjectVideoThumbnail/)
  assert.doesNotMatch(source, /pft-media-thumb/)
  assert.doesNotMatch(source, /async function webNodeUrl/)
})

test('project file tree derives hierarchy guides from visible node depth', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )

  assert.match(source, /'--tree-depth': item\.indent/)
  assert.match(source, /pft-node-guides/)
  assert.match(source, /repeating-linear-gradient/)
})

test('project file tree locates a deep resource by loading its collapsed ancestors', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )

  assert.match(source, /async function locateProjectResource\(path: string\)/)
  assert.match(source, /await ensureDirectoryLoaded\(node\)/)
  assert.match(source, /void locateProjectResource\(path\)/)
})

test('Desktop project tree receives filesystem hints instead of restoring the five second poller', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )

  assert.match(source, /@tauri-apps\/api\/event/)
  assert.match(source, /project-fs-hint/)
  assert.match(source, /refreshAffectedDirectory\(event\.payload\.path\)/)
  assert.doesNotMatch(source, /setInterval\(loadFileTree, 5000\)/)
})

test('canvas content saves do not rebuild the lazy file tree', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )
  const resourceChange =
    source.match(
      /const offProjectResourceChanged = onProjectResourceChange\([\s\S]*?\n}\)\n/,
    )?.[0] || ''

  assert.match(resourceChange, /if \(entry\.type === 'changed'\) continue/)
  assert.match(resourceChange, /void refreshAffectedDirectory\(entry\.resource\.path\)/)
  assert.doesNotMatch(resourceChange, /if \(affectsCurrentProject\) void loadFileTree\(\)/)
})

test('same-project Web notifications refresh loaded directories instead of rebuilding the root tree', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )
  const webChange = source.match(/const offWebProjectFilesChanged = onEvent\([\s\S]*?\n\}\)\n/)?.[0] || ''

  assert.match(webChange, /refreshLoadedDirectories\(\)/)
  assert.doesNotMatch(webChange, /loadFileTree\(\)/)
})

test('creating a project file refreshes its parent directory without rebuilding loaded descendants', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )
  const createFile = source.match(/async function createFileAt\([\s\S]*?\n\}\nasync function ctxRename/)?.[0] || ''

  assert.match(createFile, /await projectFiles\.createText\(/)
  assert.doesNotMatch(createFile, /await loadFileTree\(\)/)
  assert.match(source, /onProjectResourceChange\(change =>/)
  assert.match(source, /void refreshAffectedDirectory\(/)
})

test('renaming a loaded directory remaps its existing subtree before refreshing parents', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )
  const resourceChange =
    source.match(
      /const offProjectResourceChanged = onProjectResourceChange\([\s\S]*?\n}\)\n/,
    )?.[0] || ''

  assert.match(source, /function remapLoadedNode\(oldPath: string, newPath: string\)/)
  assert.match(resourceChange, /remapLoadedNode\(entry\.oldResource\.path, entry\.resource\.path\)/)
})

test('file tree context menus position from their measured DOM size instead of a fixed height estimate', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )

  assert.match(source, /nextTick/)
  assert.match(source, /ctxMenuRef\.value\?\.getBoundingClientRect\(\)/)
  assert.match(source, /maxHeight|overflowY|overflow-y/)
  assert.match(source, /\.pft-ctx-menu\s*\{[\s\S]*?box-sizing:\s*border-box/)
  assert.doesNotMatch(source, /CTX_MENU_EST_HEIGHT/)
})

test('mobile file tree opens the existing context menu on long press without blocking scroll', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )

  assert.match(source, /const NODE_LONG_PRESS_MS = 500/)
  assert.match(source, /function startNodeLongPress\(e: PointerEvent, node: TreeNode\)/)
  assert.match(source, /if \(!isMobile \|\| e\.pointerType === 'mouse'\) return/)
  assert.match(source, /openNodeContextMenu\(node, nodeLongPressStart\.x, nodeLongPressStart\.y\)/)
  assert.match(source, /function moveNodeLongPress[\s\S]*?NODE_LONG_PRESS_MOVE_LIMIT[\s\S]*?cancelNodeLongPress\(\)/)
  assert.match(source, /@pointerdown="startNodeLongPress\(\$event, item\.node\)"/)
  assert.match(source, /@pointerup="cancelNodeLongPress"/)
  assert.match(source, /-webkit-touch-callout:\s*none/)
  assert.match(source, /user-select:\s*none/)
})

test('project file tree searches unloaded paths in a temporary ancestor-complete tree', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )

  assert.match(source, /const searchTree = ref<TreeNode \| null>\(null\)/)
  assert.match(source, /await projectFiles\.searchPaths\(owner, query, 2000\)/)
  assert.match(source, /function buildSearchTree/)
})

test('project file tree adapts the existing UI to IndexedDB on Web', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )
  assert.match(source, /createRuntimeProjectFileService/)
  assert.match(source, /await projectFiles\.listDirectory\(/)
  assert.match(source, /await webProjectFiles\.createProject\(/)
  assert.match(source, /await projectFiles\.createFolder\(/)
  assert.match(source, /await projectFiles\.rename\(/)
  assert.match(source, /await projectFiles\.planBatch\(\{ kind: 'delete', resources \}\)/)
  assert.match(source, /await projectFiles\.executeBatch\(plan\)/)
  assert.match(source, /id: node\.id/)
})

test('project file tree recovers stale Web projects and supports save as on both runtimes', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )

  assert.match(source, /async function refreshWebProjects/)
  assert.match(source, /projectStore\.clearWebProject\(\)/)
  assert.match(source, /onEvent\('web-project-files-changed'/)
  assert.match(source, /new BroadcastChannel\(WEB_PROJECT_FILES_CHANNEL\)/)
  assert.match(source, /const requestId = \+\+loadFileTreeRequestId/)
  assert.match(source, /requestId !== loadFileTreeRequestId/)
  assert.match(source, /dev_save_project_file_as/)
  assert.match(source, /<button class="pft-ctx-item" @click="ctxSaveAs"/)
})

test('project file tree uses native Web file interactions and local binary data', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )
  const viewer = readFileSync(join(process.cwd(), 'src/components/media/MediaViewer.vue'), 'utf8')

  assert.match(source, /ref="uploadInput"[^>]*type="file"[^>]*multiple/)
  assert.match(source, /ref="directoryInput"[^>]*type="file"[^>]*webkitdirectory/)
  assert.match(source, /@drop\.prevent\.stop="onTreeDrop\(\$event\)"/)
  assert.match(source, /writeWebProjectEntries/)
  assert.match(source, /importWebProject/)
  assert.match(source, /showDirectoryPicker/)
  assert.match(source, /showDirectoryPicker\(\{ mode: 'readwrite' \}\)/)
  assert.match(source, /webProjectFiles\.readBinary\(/)
  assert.match(source, /saveGeneratedFile\(/)
  assert.doesNotMatch(source, /fetchBlobForExport/)
  assert.match(source, /<MediaViewer/)
  assert.match(source, /mode="file"/)
  assert.match(
    source,
    /function emitMediaToCanvas[\s\S]*?'canvas:add-media', \{\s+projectId: resource\.owner,\s+path: resource\.path,\s+kind/,
  )
  assert.match(source, /node\.mimeType\?\.startsWith\('audio\/'\)/)
  assert.match(viewer, /mode\?: 'creation' \| 'file'/)
  assert.match(viewer, /props\.mode !== 'file'/)
})

test('memory file-tree canvas action bypasses preview and opens the creation host', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )
  const action = source.match(/async function ctxOpenInCanvas[\s\S]*?\n}/)?.[0] || ''

  assert.match(action, /openProjectResource/)
  assert.match(action, /emitMediaToCanvas/)
  assert.doesNotMatch(action, /openFile\(/)
  assert.match(source, /application\/x-jc-media-reference/)
})

test('top toolbar creates inside the selected directory before falling back to project root', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )
  const open = source.match(/async function openFile[\s\S]*?\n}\n\n\/\* ─── 右键菜单/)?.[0] || ''

  assert.match(
    open,
    /if \(node\.isDir\) \{\s*selectedPath\.value = node\.path\s*focusedPath\.value = node\.path\s*await toggleNode\(node\)/,
  )
  assert.match(source, /function selectedDirectoryNode\(\): TreeNode \| null/)
  assert.match(source, /function ctxNewFileFromSelection\(\)/)
  assert.match(source, /function ctxNewFolderFromSelection\(\)/)
  assert.match(source, /@click="ctxNewFileFromSelection"/)
  assert.match(source, /@click="ctxNewFolderFromSelection"/)
  assert.doesNotMatch(source, /function ctxNewFileRoot\(\) \{ selectRoot\(\); ctxNewFile\(\) \}/)
})

test('top toolbar creates beside a selected file instead of falling back to project root', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )
  const selectedDirectory =
    source.match(
      /function selectedDirectoryNode\(\): TreeNode \| null \{[\s\S]*?\n}\nfunction useSelectedDirectoryAsCreationTarget/,
    )?.[0] || ''

  assert.match(
    selectedDirectory,
    /const targetPath = selected\.isDir \? path : path\.split\('\/'\)\.slice\(0, -1\)\.join\('\/'\)/,
  )
})

test('memory file tree has no dead editor command host', () => {
  const tree = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )
  const creation = readFileSync(
    join(process.cwd(), 'src/components/creation/CreationPanel.vue'),
    'utf8',
  )

  assert.doesNotMatch(tree, /project:new-document|open-in-editor/)
  assert.doesNotMatch(creation, /emitEvent\('project:new-document'\)/)
})

test('project export requests survive until the file tree command host mounts', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )

  assert.match(source, /consumeLastEvent\('project:export-resources'\)/)
  assert.match(source, /handleProjectResourceExport\(pendingProjectResourceExport\[0\]\)/)
})

test('desktop exposes memory file import and project export without the old folder-upload branch', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )

  assert.match(source, /async function importDesktopFiles\(\)/)
  assert.match(source, /async function exportDesktopProject\(\)/)
  assert.match(source, /dev_import_project_files/)
  assert.match(source, /dev_export_project/)
  assert.doesNotMatch(source, /importDesktopDirectory|dev_import_project_folder|ctxUploadDirectory/)
  assert.doesNotMatch(
    source,
    /<template v-if="!isDesktop">\s*<button class="pft-ctx-item" @click="ctxUploadFiles">/,
  )
  assert.doesNotMatch(source, /<button v-if="!isDesktop" class="pft-icon-btn" title="上传文件"/)
  assert.match(
    source,
    /<button class="pft-ctx-item" @click="ctxExportProject">\s+<JcIcon name="download" \/><span>导出项目<\/span>\s+<\/button>/,
  )
})

test('project tree deletion uses one themed dialog and cannot submit the same resource twice', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )
  const remove =
    source.match(/function ctxDelete\(\)[\s\S]*?\n}\n\nfunction relativePathForFile/)?.[0] || ''

  assert.match(source, /const pendingDelete = ref<ProjectResource\[\]>\(\[\]\)/)
  assert.match(source, /const deletingResourceKeys = new Set<string>\(\)/)
  assert.match(
    remove,
    /resources\.some\(resource => deletingResourceKeys\.has\(resourceKey\(resource\)\)\)/,
  )
  assert.match(remove, /pendingDelete\.value = resources/)
  assert.match(source, /async function confirmDelete\(\)/)
  assert.match(source, /await projectFiles\.planBatch\(\{ kind: 'delete', resources \}\)/)
  assert.match(source, /function isMissingProjectResourceError\(error: unknown\): boolean/)
  assert.match(
    source,
    /if \(isMissingProjectResourceError\(error\)\) \{\s+await refreshLoadedDirectories\(\)\s+pendingDelete\.value = \[\]\s+return/,
  )
  assert.match(source, /class="pft-delete-dialog"/)
  assert.match(source, /移入废纸篓/)
})

test('project tree supports multi-selection and an internal resource clipboard', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )

  assert.match(source, /const selectedPaths = ref<Set<string>>\(new Set\(\)\)/)
  assert.match(source, /interface ProjectResourceClipboard/)
  assert.match(source, /function selectTreeNode\(node: TreeNode, event\?: MouseEvent\)/)
  assert.match(source, /metaKey \|\| event\.ctrlKey/)
  assert.match(source, /function ctxCopyResources\(\)/)
  assert.match(source, /function ctxCutResources\(\)/)
  assert.match(source, /function isCutResource\(path: string\)/)
  assert.match(source, /cutting: isCutResource\(item\.node\.path\)/)
  assert.match(source, /\.pft-node\.cutting \{\s+opacity: 0\.48;\s+\}/)
  assert.match(source, /function ctxPasteResources\(/)
  assert.doesNotMatch(source, /画布请使用“复制画布”/)
  assert.match(source, /e\.metaKey \|\| e\.ctrlKey/)
  assert.match(source, /application\/x-jc-project-resources/)
})

test('project tree can clear selection and create directly in the project root', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )

  assert.match(source, /function clearProjectSelection\(\)/)
  assert.match(
    source,
    /function onEmptyContextMenu\(e: MouseEvent\) \{\s+clearProjectSelection\(\)/,
  )
  assert.match(source, /@click\.self="clearProjectSelection"/)
  const rootMenu =
    source.match(/<template v-if="ctxMenu\.node === null">[\s\S]*?<\/template>/)?.[0] || ''
  assert.match(
    rootMenu,
    /@click="ctxNewFile"[^>]*>\s+<JcIcon name="note-add" \/><span>新建文件<\/span>/,
  )
  assert.match(
    rootMenu,
    /@click="ctxNewFolder"[^>]*>\s+<JcIcon name="create-new-folder" \/><span>新建文件夹<\/span>/,
  )
})

test('project export resolves external file collisions before opening a writable', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )
  const write =
    source.match(
      /async function writeProjectExportEntry[\s\S]*?\n}\nasync function ctxExportProject/,
    )?.[0] || ''

  assert.match(
    source,
    /async function existingExportFile[\s\S]*?getFileHandle\(filename, \{ create: false \}\)/,
  )
  assert.match(write, /let file = await existingExportFile\(directory, filename\)/)
  assert.match(write, /const collision = await requestCollision\(entry\.path\)/)
  assert.match(write, /if \(collision === 'cancel'\) return/)
  assert.match(write, /if \(collision === 'keep-both'\)/)
  assert.match(write, /\$\{base\} \(\$\{index\}\)\$\{extension\}/)
  assert.match(write, /await writer\.write\(entry\.blob\)\s+await writer\.close\(\)/)
  assert.match(write, /await writer\.abort\(\)\.catch\(\(\) => \{\}\)/)
})

test('new project files open in the memory workbench', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )
  const createFile =
    source.match(
      /async function createFileAt\(relPath: string\)[\s\S]*?\n}\nasync function ctxRename/,
    )?.[0] || ''

  assert.match(
    createFile,
    /const resource = await projectFiles\.createText\(projectKey\.value, relPath, ''\)/,
  )
  assert.match(createFile, /emitEvent\('memory:open-resource', await openProjectResource\(projectFiles, resource\)\)/)
  assert.doesNotMatch(source, /projectTextEditorMode|project:new-document/)
})

test('a project tree only consumes the still-supported pending export request after remount', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )
  const mounted =
    source.match(/onMounted\(async \(\) => \{[\s\S]*?\n}\)\nonBeforeUnmount/)?.[0] || ''

  assert.doesNotMatch(mounted, /project:new-document/)
  assert.match(mounted, /consumeLastEvent\('project:export-resources'\)/)
})

test('project switches remove stale tree actions before the replacement tree loads', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )
  const projectWatch =
    source.match(
      /watch\(\s+projectKey,\s+\(\) => \{[\s\S]*?\n  \},\s+\{ flush: 'sync' \},?\s+\)\s+watch\(filterQuery/,
    )?.[0] || ''

  assert.match(projectWatch, /treeRoot\.value = null/)
  assert.match(projectWatch, /selectedPath\.value = null/)
  assert.match(projectWatch, /focusedPath\.value = null/)
  assert.match(projectWatch, /ctxMenu\.value = \{ show: false, x: 0, y: 0, node: null \}/)
  assert.match(projectWatch, /treeDropActive\.value = false/)
})

test('project save as captures its owner across asynchronous Web reads', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )
  const saveAs =
    source.match(/async function saveNodeAs[\s\S]*?\n}\nasync function ctxSaveAs/)?.[0] || ''

  assert.match(saveAs, /const owner = projectKey\.value/)
  assert.match(saveAs, /webProjectFiles\.read\(owner, node\.path\)/)
  assert.match(saveAs, /webProjectFiles\.readBinary\(owner, node\.path\)/)
  assert.ok((saveAs.match(/if \(owner !== projectKey\.value\) return/g) || []).length >= 2)
})

test('project file preview ignores stale OPFS reads and revokes stale object URLs', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )
  const preview =
    source.match(/async function openFilePreview[\s\S]*?\n}\nfunction ctxPreview/)?.[0] || ''

  assert.match(source, /let filePreviewRequestId = 0/)
  assert.match(source, /function closeFilePreview\(\) \{\s+filePreviewRequestId\+\+/)
  assert.match(preview, /const requestId = \+\+filePreviewRequestId/)
  assert.match(
    preview,
    /if \(requestId !== filePreviewRequestId\) \{\s+URL\.revokeObjectURL\(objectUrl\)\s+return\s+}/,
  )
  assert.match(preview, /if \(requestId !== filePreviewRequestId\) return/)
})

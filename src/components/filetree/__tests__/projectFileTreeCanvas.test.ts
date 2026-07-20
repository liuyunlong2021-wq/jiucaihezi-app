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
  assert.match(source, /if \(result\.type === 'media'\)/)
  assert.match(source, /kind: result\.mediaKind/)
  assert.match(
    source,
    /function isCanvasAddableMediaResource\(node: TreeNode \| null \| undefined\): boolean/,
  )
  assert.match(source, /return resourceForNode\(node\)\.kind === 'media'/)
})

test('project file tree virtualizes rows and only queues thumbnails for rendered media', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )
  const load =
    source.match(
      /async function loadMediaThumbnail[\s\S]*?\n}\nfunction pumpMediaThumbnailQueue/,
    )?.[0] || ''

  assert.match(source, /import \{ useVirtualizer \} from '@tanstack\/vue-virtual'/)
  assert.match(source, /const fileTreeVirtualizer = useVirtualizer/)
  assert.match(source, /const virtualVisibleNodes = computed/)
  assert.match(source, /fileTreeVirtualizer\.getTotalSize\(\)/)
  assert.match(source, /v-for="\{ row, item \} in virtualVisibleNodes"/)
  assert.match(source, /resolveProjectVideoThumbnail/)
  assert.match(source, /class="pft-media-thumb"/)
  assert.match(source, /const MAX_CONCURRENT_THUMBNAILS = 1/)
  assert.match(source, /function enqueueMediaThumbnail\(node: TreeNode\)/)
  assert.match(
    source,
    /function enqueueMediaThumbnail\(node: TreeNode\) \{\s+const owner = projectKey\.value/,
  )
  assert.match(load, /async function loadMediaThumbnail\(node: TreeNode, owner: string\)/)
  assert.match(load, /if \(\s*!isDesktop \|\|\s*!owner \|\|\s*!isCanvasMediaFile/)
  assert.match(load, /resolveProjectVideoThumbnail\(owner, node\.path\)/)
  assert.match(load, /if \(owner !== projectKey\.value\) return/)
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
  const panelSource = readFileSync(
    join(process.cwd(), 'src/components/filetree/FileTreePanel.vue'),
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
  assert.match(panelSource, /\{ key: 'project' as const, icon: 'folder', label: '项目' \}/)
  assert.doesNotMatch(panelSource, /\.\.\.\(isDesktop \? \[/)
  assert.doesNotMatch(panelSource, /tab === 'project'\) return isDesktop/)
  assert.doesNotMatch(panelSource, /has && isDesktop/)
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
    /'canvas:add-media', \{\s+projectId: projectKey\.value,\s+path: result\.resource\.path,\s+kind: result\.mediaKind/,
  )
  assert.match(source, /node\.mimeType\?\.startsWith\('audio\/'\)/)
  assert.match(viewer, /mode\?: 'creation' \| 'file'/)
  assert.match(viewer, /props\.mode !== 'file'/)
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

test('editor and creation panel request new project documents through the tree command host', () => {
  const tree = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )
  const creation = readFileSync(
    join(process.cwd(), 'src/components/creation/CreationPanel.vue'),
    'utf8',
  )

  assert.match(tree, /onEvent\('project:new-document'/)
  assert.match(
    tree,
    /emitEvent\('open-in-editor', \{\s+resource,\s+content: '',\s+revision: text\.revision/,
  )
  assert.match(creation, /emitEvent\('project:new-document'\)/)
})

test('project export requests survive until the file tree command host mounts', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )

  assert.match(source, /consumeLastEvent\('project:export-resources'\)/)
  assert.match(source, /handleProjectResourceExport\(pendingProjectResourceExport\[0\]\)/)
})

test('desktop exposes the same upload import and export actions as Web', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )

  assert.match(source, /async function importDesktopFiles\(targetPath = ''\)/)
  assert.match(source, /async function importDesktopDirectory\(targetPath = ''\)/)
  assert.match(source, /async function exportDesktopProject\(\)/)
  assert.match(source, /dev_import_project_files/)
  assert.match(source, /dev_import_project_folder/)
  assert.match(source, /dev_export_project/)
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
    /if \(isMissingProjectResourceError\(error\)\) \{\s+await loadFileTree\(\)\s+pendingDelete\.value = \[\]\s+return/,
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

test('new project files are opened in the editor from the same creation path', () => {
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
  assert.match(
    createFile,
    /emitEvent\('open-in-editor', \{\s+resource,\s+content: '',\s+revision: text\.revision,\s+editorMode: projectTextEditorMode\(resource\),?\s+\}\)/,
  )
  assert.match(source, /const offNewProjectDocument = onEvent\('project:new-document'/)
})

test('a project tree consumes a pending new-document request after it remounts', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
    'utf8',
  )
  const mounted =
    source.match(/onMounted\(async \(\) => \{[\s\S]*?\n}\)\nonBeforeUnmount/)?.[0] || ''

  assert.match(
    mounted,
    /const pendingNewProjectDocument = consumeLastEvent\('project:new-document'\)/,
  )
  assert.match(mounted, /if \(pendingNewProjectDocument\) void ctxNewFileFromSelection\(\)/)
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

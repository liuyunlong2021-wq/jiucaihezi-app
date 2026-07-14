import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

test('project file tree exposes canvas create, copy, rename, and delete actions', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'), 'utf8')

  assert.match(source, /新建画布/)
  assert.match(source, /复制画布/)
  assert.match(source, /ctxNewCanvas/)
  assert.match(source, /ctxCopyCanvas/)
  assert.match(source, /renameCanvasFile/)
  assert.match(source, /deleteCanvasFile/)
})

test('project file tree waits for pending canvas persistence before rename or delete', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'), 'utf8')

  assert.match(source, /import \{ emitEvent, emitEventAsync, onEvent \} from '@\/utils\/eventBus'/)
  assert.match(source, /import \{ useMediaTaskStore \} from '@\/stores\/mediaTaskStore'/)
  assert.match(source, /const mediaTaskStore = useMediaTaskStore\(\)/)
  assert.ok((source.match(/const lifecycle: \{ path: string; owner: string; lifecycleId: string; release\?: \(\) => void \} = \{ path: n\.path, owner, lifecycleId: crypto\.randomUUID\(\) \}/g) || []).length === 2)
  assert.match(source, /await emitEventAsync\('canvas:before-rename', lifecycle\)\s+if \(owner !== projectKey\.value\) throw new Error\('项目已切换，请重试'\)\s+if \(mediaTaskStore\.hasPendingCanvasWrite\(owner, n\.path\)\) throw new Error\('画布有待写入的生成结果，请稍候'\)\s+const file = await renameCanvasFile\(n\.path, name, owner\)\s+completed = true\s+emitEvent\('canvas:renamed', \{ oldPath: n\.path, newPath: file\.path, owner, lifecycleId: lifecycle\.lifecycleId, release: lifecycle\.release \}\)/)
  assert.match(source, /await emitEventAsync\('canvas:before-delete', lifecycle\)\s+if \(owner !== projectKey\.value\) throw new Error\('项目已切换，请重试'\)\s+if \(mediaTaskStore\.hasPendingCanvasWrite\(owner, n\.path\)\) throw new Error\('画布有待写入的生成结果，请稍候'\)\s+await deleteCanvasFile\(n\.path, owner\)\s+completed = true\s+emitEvent\('canvas:deleted', \{ path: n\.path, owner, lifecycleId: lifecycle\.lifecycleId, release: lifecycle\.release \}\)/)
  assert.ok((source.match(/if \(!completed\) emitEvent\('canvas:lifecycle-failed', lifecycle\)/g) || []).length === 2)
})

test('project file tree adds images and videos to canvas as selectable media', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'), 'utf8')

  assert.match(source, /if \(IMAGE_EXTS\.has\(ext\) \|\| VIDEO_EXTS\.has\(ext\)\)/)
  assert.match(source, /kind: VIDEO_EXTS\.has\(ext\) \? 'video' : 'image'/)
  assert.match(source, /return IMAGE_EXTS\.has\(ext\) \|\| VIDEO_EXTS\.has\(ext\)/)
})

test('project file tree shows lazy media thumbnails', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'), 'utf8')

  assert.match(source, /IntersectionObserver/)
  assert.match(source, /extractVideoFirstFrameThumbnail/)
  assert.match(source, /class="pft-media-thumb"/)
  assert.match(source, /const MAX_CONCURRENT_THUMBNAILS = 1/)
  assert.match(source, /function enqueueMediaThumbnail\(node: TreeNode\)/)
})

test('project file tree adapts the existing UI to IndexedDB on Web', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'), 'utf8')
  const panelSource = readFileSync(join(process.cwd(), 'src/components/filetree/FileTreePanel.vue'), 'utf8')

  assert.match(source, /webProjectFiles/)
  assert.match(source, /await webProjectFiles\.list\(/)
  assert.match(source, /await webProjectFiles\.createProject\(/)
  assert.match(source, /await webProjectFiles\.createFolder\(/)
  assert.match(source, /await webProjectFiles\.rename\(/)
  assert.match(source, /await webProjectFiles\.remove\(/)
  assert.match(source, /fileId: node\.id/)
  assert.match(panelSource, /\{ key: 'project' as const, icon: 'folder', label: '项目' \}/)
  assert.doesNotMatch(panelSource, /\.\.\.\(isDesktop \? \[/)
  assert.doesNotMatch(panelSource, /tab === 'project'\) return isDesktop/)
  assert.doesNotMatch(panelSource, /has && isDesktop/)
})

test('project file tree recovers stale Web projects and supports save as on both runtimes', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'), 'utf8')

  assert.match(source, /async function refreshWebProjects/)
  assert.match(source, /projectStore\.clearWebProject\(\)/)
  assert.match(source, /onEvent\('web-project-files-changed'/)
  assert.match(source, /new BroadcastChannel\(WEB_PROJECT_FILES_CHANNEL\)/)
  assert.match(source, /const requestId = \+\+loadFileTreeRequestId/)
  assert.match(source, /requestId !== loadFileTreeRequestId/)
  assert.match(source, /dev_save_project_file_as/)
  assert.match(source, /<button class="pft-ctx-item" @click="ctxSaveAs"/)
})

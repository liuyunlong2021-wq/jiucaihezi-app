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

  assert.match(source, /webProjectFiles/)
  assert.match(source, /await webProjectFiles\.list\(/)
  assert.match(source, /await webProjectFiles\.createProject\(/)
  assert.match(source, /await webProjectFiles\.createFolder\(/)
  assert.match(source, /await webProjectFiles\.rename\(/)
  assert.match(source, /await webProjectFiles\.remove\(/)
  assert.match(source, /fileId: node\.id/)
})

test('project file tree recovers stale Web projects and supports save as on both runtimes', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'), 'utf8')

  assert.match(source, /async function refreshWebProjects/)
  assert.match(source, /projectStore\.clearWebProject\(\)/)
  assert.match(source, /onEvent\('web-project-files-changed'/)
  assert.match(source, /dev_save_project_file_as/)
  assert.match(source, /<button class="pft-ctx-item" @click="ctxSaveAs"/)
})

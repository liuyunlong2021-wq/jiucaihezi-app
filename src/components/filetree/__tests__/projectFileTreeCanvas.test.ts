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

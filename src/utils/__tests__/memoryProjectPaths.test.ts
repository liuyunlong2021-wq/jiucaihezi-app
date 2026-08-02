import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  isMemoryMediaFilePath,
  isMemoryProjectHiddenPath,
  isMemoryProjectMutationBlocked,
  MEMORY_PROJECT_SKELETON_DIRECTORIES,
  memoryMediaDirectoryFor,
} from '../memoryProjectPaths'

test('memory project paths keep one protected skeleton and four media categories', () => {
  assert.deepEqual(MEMORY_PROJECT_SKELETON_DIRECTORIES, [
    '.raw',
    '.raw/jc-media',
    '.raw/jc-media/文档',
    '.raw/jc-media/图片',
    '.raw/jc-media/视频',
    '.raw/jc-media/音频',
    '.raw/对话记录',
    '.raw/.sync',
    'jc-canvas',
    'wiki',
  ])
  assert.equal(memoryMediaDirectoryFor('cover.png'), '.raw/jc-media/图片')
  assert.equal(memoryMediaDirectoryFor('movie.bin', 'video/mp4'), '.raw/jc-media/视频')
  assert.equal(memoryMediaDirectoryFor('voice.mp3'), '.raw/jc-media/音频')
  assert.equal(memoryMediaDirectoryFor('scene.glb', 'model/gltf-binary'), '.raw/jc-media/文档')
  assert.equal(isMemoryMediaFilePath('.raw/jc-media/图片/cover.png', 'image/png'), true)
  assert.equal(isMemoryMediaFilePath('.raw/jc-media/文档/cover.png', 'image/png'), false)
})

test('memory project paths hide selector records and protect only the fixed skeleton', () => {
  for (const path of ['.raw/对话记录', '.raw/对话记录/a.md', '.raw/.sync/state.json', 'jc-canvas/a.jccanvas', 'wiki/.DS_Store']) {
    assert.equal(isMemoryProjectHiddenPath(path), true, path)
  }
  for (const path of ['.raw', '.raw/jc-media', '.raw/jc-media/图片', 'wiki', '.raw/对话记录/a.md', 'jc-canvas/a.jccanvas']) {
    assert.equal(isMemoryProjectMutationBlocked(path), true, path)
  }
  for (const path of ['.raw/自建资料/笔记.md', '.raw/jc-media/图片/a.png', '.raw/jc-media/文档/a.md', 'wiki/hot.md']) {
    assert.equal(isMemoryProjectMutationBlocked(path), false, path)
  }
  assert.equal(isMemoryProjectMutationBlocked('.raw/jc-media/图片/a.png', 'text'), true)
  assert.equal(isMemoryProjectMutationBlocked('.raw/jc-media/文档/a.md', 'text'), false)
  assert.equal(isMemoryProjectMutationBlocked('.raw/jc-media/generated', 'directory'), true)
})

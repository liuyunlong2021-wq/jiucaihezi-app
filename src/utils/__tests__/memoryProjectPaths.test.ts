import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  isMemoryConversationPath,
  isMemoryMediaFilePath,
  isMemoryProjectHiddenPath,
  isMemoryProjectMutationBlocked,
  legacyCanvasMediaCandidates,
  MEMORY_PROJECT_SKELETON_DIRECTORIES,
  memoryMediaDirectoryFor,
} from '../memoryProjectPaths'

test('legacy canvas media paths map into the .raw media directories', () => {
  assert.deepEqual(legacyCanvasMediaCandidates('jc-media/images/a.png'), ['.raw/jc-media/图片/a.png'])
  assert.deepEqual(legacyCanvasMediaCandidates('jc-media/videos/b.mp4'), ['.raw/jc-media/视频/b.mp4'])
  assert.deepEqual(legacyCanvasMediaCandidates('jc-media/audios/c.mp3'), ['.raw/jc-media/音频/c.mp3'])
  assert.deepEqual(legacyCanvasMediaCandidates('jc-media/uploads/d.png'), [
    '.raw/jc-media/图片/d.png',
    '.raw/jc-media/视频/d.png',
    '.raw/jc-media/音频/d.png',
    '.raw/jc-media/文档/d.png',
  ])
  assert.deepEqual(legacyCanvasMediaCandidates('.raw/jc-media/图片/e.png'), [])
  assert.deepEqual(legacyCanvasMediaCandidates('随便/路径/f.png'), [])
})

test('memory conversation paths match relative, absolute, and Windows paths only', () => {
  for (const path of [
    '.raw/对话记录/a.md',
    '/Users/test/project/.raw/对话记录/a.md',
    'C:\\Users\\test\\project\\.raw\\对话记录\\a.md',
  ]) assert.equal(isMemoryConversationPath(path), true, path)

  for (const path of ['.raw/jc-media/文档/a.md', '.raw/对话记录副本/a.md']) {
    assert.equal(isMemoryConversationPath(path), false, path)
  }
})

test('memory project paths keep one protected skeleton and four media categories', () => {
  assert.deepEqual(MEMORY_PROJECT_SKELETON_DIRECTORIES, [
    '.raw',
    '.raw/jc-media',
    '.raw/jc-media/文档',
    '.raw/jc-media/图片',
    '.raw/jc-media/视频',
    '.raw/jc-media/音频',
    '.raw/对话记录',
    '.raw/记忆索引',
    '.raw/.sync',
    'jc-canvas',
  ])
  assert.equal(memoryMediaDirectoryFor('cover.png'), '.raw/jc-media/图片')
  assert.equal(memoryMediaDirectoryFor('movie.bin', 'video/mp4'), '.raw/jc-media/视频')
  assert.equal(memoryMediaDirectoryFor('voice.mp3'), '.raw/jc-media/音频')
  assert.equal(memoryMediaDirectoryFor('scene.glb', 'model/gltf-binary'), '.raw/jc-media/文档')
  assert.equal(isMemoryMediaFilePath('.raw/jc-media/图片/cover.png', 'image/png'), true)
  assert.equal(isMemoryMediaFilePath('.raw/jc-media/文档/cover.png', 'image/png'), false)
})

test('memory project paths hide selector records and protect only the fixed skeleton', () => {
  for (const path of ['.raw/对话记录', '.raw/对话记录/a.md', '.raw/记忆索引', '.raw/记忆索引/a.md', '.raw/.sync/state.json', 'jc-canvas/a.jccanvas', 'wiki/.DS_Store']) {
    assert.equal(isMemoryProjectHiddenPath(path), true, path)
  }
  for (const path of ['.raw', '.raw/jc-media', '.raw/jc-media/图片', '.raw/对话记录/a.md', '.raw/记忆索引/a.md', 'jc-canvas/a.jccanvas']) {
    assert.equal(isMemoryProjectMutationBlocked(path), true, path)
  }
  for (const path of ['.raw/自建资料/笔记.md', '.raw/jc-media/图片/a.png', '.raw/jc-media/文档/a.md', 'wiki/hot.md']) {
    assert.equal(isMemoryProjectMutationBlocked(path), false, path)
  }
  assert.equal(isMemoryProjectMutationBlocked('.raw/jc-media/图片/a.png', 'text'), true)
  assert.equal(isMemoryProjectMutationBlocked('.raw/jc-media/文档/a.md', 'text'), false)
  assert.equal(isMemoryProjectMutationBlocked('.raw/jc-media/generated', 'directory'), true)
  // 文档区的子目录归用户/模型管（Skill 草稿就是个目录）：模型 mkdir 草稿目录不能被拦，
  // 否则它只能拿到一句「系统骨架…只能由 App 管理」的误导报错。
  assert.equal(isMemoryProjectMutationBlocked('.raw/jc-media/文档/skill-demo', 'directory'), false)
  assert.equal(isMemoryProjectMutationBlocked('.raw/jc-media/文档/skill-demo/references', 'directory'), false)
  // 骨架目录自己仍然只有 App 能建删
  assert.equal(isMemoryProjectMutationBlocked('.raw/jc-media/文档', 'directory'), true)
  assert.equal(isMemoryProjectMutationBlocked('.raw/jc-media/图片', 'directory'), true)
  assert.equal(isMemoryProjectMutationBlocked('.raw/jc-media', 'directory'), true)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { openProjectResource } from '../projectExplorerService'
import type { ProjectFileService } from '../projectFileService'
import type { ProjectResource } from '@/utils/projectResource'

function resource(kind: ProjectResource['kind'], path: string): ProjectResource {
  return {
    runtime: 'web', owner: 'project_1', path, name: path.split('/').pop()!, isDirectory: false, kind,
  }
}

function fileService(content = '# note', truncated = false): Pick<ProjectFileService, 'readText'> {
  return {
    async readText() {
      return { content, size: content.length, truncated, revision: { value: 'r1', size: content.length } }
    },
  }
}

test('resource open routing reads complete documents only for the editor', async () => {
  const result = await openProjectResource(fileService('# complete'), resource('document', 'wiki/note.md'))

  assert.equal(result.type, 'editor')
  if (result.type === 'editor') {
    assert.equal(result.text.content, '# complete')
    assert.equal(result.editorMode, 'rich')
  }
})

test('resource open routing keeps non-Markdown project text in raw mode', async () => {
  const result = await openProjectResource(fileService('lockfileVersion: 9\nsettings: {}'), resource('document', 'pnpm-lock.yaml'))

  assert.equal(result.type, 'editor')
  if (result.type === 'editor') {
    assert.equal(result.editorMode, 'plain')
    assert.equal(result.text.content, 'lockfileVersion: 9\nsettings: {}')
  }
})

test('resource open routing only treats marked Raw files as conversations', async () => {
  const transcript = [
    '# 聊聊历史',
    '',
    '<!-- jc:conversation id="chat_fixed" created-at="2026-07-24T10:00:00.000Z" -->',
  ].join('\n')

  const conversation = await openProjectResource(
    fileService(transcript),
    resource('document', '.raw/对话记录/chat_fixed.md'),
  )
  const normalDocument = await openProjectResource(
    fileService(transcript),
    resource('document', 'wiki/chat_fixed.md'),
  )

  assert.equal(conversation.type, 'conversation')
  assert.equal(normalDocument.type, 'editor')
})

test('resource open routing rejects truncated documents before an editor tab exists', async () => {
  const result = await openProjectResource(fileService('# partial', true), resource('document', 'wiki/large.md'))

  assert.equal(result.type, 'unsafe-text')
})

test('resource open routing sends canvas and media to the creation surface and leaves binary outside the editor', async () => {
  assert.equal((await openProjectResource(fileService(), resource('canvas', 'jc-canvas/plan.jccanvas'))).type, 'canvas')
  assert.equal((await openProjectResource(fileService(), resource('media', 'jc-media/voice.mp3'))).type, 'media')
  const model = await openProjectResource(fileService(), resource('media', 'jc-media/models/character.glb'))
  assert.equal(model.type === 'media' ? model.mediaKind : '', 'model3d')
  assert.equal((await openProjectResource(fileService(), resource('binary', 'assets/model.psd'))).type, 'binary')
})

test('resource open routing keeps standard JSON Canvas independent from the creation canvas', async () => {
  const content = JSON.stringify({
    nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 240, height: 120, text: '[[wiki/hot]]' }],
    edges: [],
  })
  const result = await openProjectResource(fileService(content), resource('project-map', 'docs/wiki/关系图.canvas'))
  assert.equal(result.type, 'project-map')
  if (result.type === 'project-map') assert.equal(result.document.nodes[0]?.id, 'a')

  const broken = await openProjectResource(fileService('{'), resource('project-map', 'docs/wiki/损坏.canvas'))
  assert.equal(broken.type, 'editor')
  if (broken.type === 'editor') assert.equal(broken.editorMode, 'plain')
})

test('resource open routing recognizes versioned 3D blockout scenes', async () => {
  const content = JSON.stringify({ version: 1, title: '街道', objects: [], formations: [], groups: [] })
  const result = await openProjectResource(fileService(content), resource('document', '.raw/jc-media/文档/街道.jcscene'))
  assert.equal(result.type, 'scene3d')
  if (result.type === 'scene3d') assert.equal(result.document.title, '街道')
})

test('resource open routing keeps incomplete 3D scenes editable instead of throwing', async () => {
  for (const content of ['', '{"version":1']) {
    const result = await openProjectResource(fileService(content), resource('document', '.raw/jc-media/文档/未完成.jcscene'))
    assert.equal(result.type, 'editor')
    if (result.type === 'editor') assert.equal(result.editorMode, 'plain')
  }
})

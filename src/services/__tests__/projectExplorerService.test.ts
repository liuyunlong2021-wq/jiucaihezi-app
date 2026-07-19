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

test('resource open routing rejects truncated documents before an editor tab exists', async () => {
  const result = await openProjectResource(fileService('# partial', true), resource('document', 'wiki/large.md'))

  assert.equal(result.type, 'unsafe-text')
})

test('resource open routing sends canvas and media to the creation surface and leaves binary outside the editor', async () => {
  assert.equal((await openProjectResource(fileService(), resource('canvas', 'jc-canvas/plan.jccanvas'))).type, 'canvas')
  assert.equal((await openProjectResource(fileService(), resource('media', 'jc-media/voice.mp3'))).type, 'media')
  assert.equal((await openProjectResource(fileService(), resource('binary', 'assets/model.psd'))).type, 'binary')
})

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  canEditProjectText,
  classifyProjectResource,
  isSameProjectResource,
  renamedProjectResource,
  type ProjectResource,
} from '../projectResource'

function resource(path: string, mimeType?: string): ProjectResource {
  return {
    runtime: 'desktop',
    owner: '/project',
    path,
    name: path.split('/').pop() || path,
    isDirectory: false,
    mimeType,
    kind: classifyProjectResource({ path, mimeType }),
  }
}

test('classifies canvas, media, documents, and unknown binary without a permissive fallback', () => {
  assert.equal(classifyProjectResource({ path: 'jc-canvas/plan.jccanvas' }), 'canvas')
  assert.equal(classifyProjectResource({ path: 'jc-media/images/cover.png' }), 'media')
  assert.equal(classifyProjectResource({ path: 'jc-media/audios/voice.mp3' }), 'media')
  assert.equal(classifyProjectResource({ path: 'wiki/outline.md' }), 'document')
  assert.equal(classifyProjectResource({ path: 'scripts/app.ts', mimeType: 'text/plain' }), 'document')
  assert.equal(classifyProjectResource({ path: 'assets/model.psd' }), 'binary')
  assert.equal(classifyProjectResource({ path: 'unknown.payload' }), 'binary')
})

test('only complete NUL-free text may enter a writable editor', () => {
  assert.equal(canEditProjectText({ content: '# outline', size: 9, truncated: false }), true)
  assert.equal(canEditProjectText({ content: '# partial', size: 900_000, truncated: true }), false)
  assert.equal(canEditProjectText({ content: 'text\0bytes', size: 10, truncated: false }), false)
})

test('rename carries the new URI while preserving the Web document identity', () => {
  const source: ProjectResource = {
    ...resource('wiki/old.md', 'text/markdown'),
    runtime: 'web',
    owner: 'webproject_1',
    id: 'webfile_webproject_1_wiki%2Fold.md',
  }
  const renamed = renamedProjectResource(source, 'wiki/new.md')

  assert.equal(renamed.path, 'wiki/new.md')
  assert.equal(renamed.name, 'new.md')
  assert.equal(renamed.id, source.id)
  assert.equal(isSameProjectResource(source, renamed), false)
  assert.equal(isSameProjectResource(renamed, { ...renamed }), true)
})

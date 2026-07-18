import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createEditorSessionStore, createSessionSaveQueue } from '../editorSessionStore'
import type { ProjectResource, ProjectResourceRevision } from '@/utils/projectResource'

const revision: ProjectResourceRevision = { value: 'r1', size: 1 }
const first: ProjectResource = {
  runtime: 'web', owner: 'project_1', path: 'wiki/first.md', id: 'first', name: 'first.md', isDirectory: false, kind: 'document',
}
const second: ProjectResource = {
  runtime: 'web', owner: 'project_1', path: 'wiki/second.md', id: 'second', name: 'second.md', isDirectory: false, kind: 'document',
}

test('editor sessions keep independent document snapshots when tabs switch', () => {
  const store = createEditorSessionStore()
  const firstSession = store.openProject(first, { type: 'doc', content: [{ type: 'paragraph' }] }, 'first', revision)
  store.updateDocument(firstSession.tabId, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first edit' }] }] }, 'first edit')
  const secondSession = store.openProject(second, { type: 'doc', content: [{ type: 'paragraph' }] }, 'second', revision)
  store.updateDocument(secondSession.tabId, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second edit' }] }] }, 'second edit')

  assert.equal(store.select(firstSession.tabId)?.markdown, 'first edit')
  assert.equal(store.select(secondSession.tabId)?.markdown, 'second edit')
  assert.equal(store.get(firstSession.tabId)?.dirty, true)
  assert.equal(store.get(secondSession.tabId)?.dirty, true)
})

test('capturing an unchanged editor snapshot keeps a session clean', () => {
  const store = createEditorSessionStore()
  const document = { type: 'doc', content: [{ type: 'paragraph' }] }
  const session = store.openProject(first, document, 'same', revision)

  store.updateDocument(session.tabId, document, 'same')

  assert.equal(store.get(session.tabId)?.dirty, false)
})

test('a save completion keeps a session dirty when newer edits happened while saving', () => {
  const store = createEditorSessionStore()
  const session = store.openProject(first, { type: 'doc' }, 'before', revision)
  store.updateDocument(session.tabId, { type: 'doc' }, 'saved snapshot')
  const savingVersion = store.get(session.tabId)!.documentVersion
  store.updateDocument(session.tabId, { type: 'doc' }, 'newer edit')

  store.markSaved(session.tabId, { value: 'r2', size: 2 }, savingVersion)

  assert.equal(store.get(session.tabId)?.dirty, true)
  assert.equal(store.get(session.tabId)?.baseRevision?.value, 'r2')
})

test('rename updates every matching tab and deleted dirty tab can only be saved as another resource', () => {
  const store = createEditorSessionStore()
  const session = store.openProject(first, { type: 'doc' }, 'before', revision)
  store.updateDocument(session.tabId, { type: 'doc' }, 'local')
  const renamed = { ...first, path: 'wiki/renamed.md', name: 'renamed.md' }

  store.applyResourceChange({ type: 'renamed', oldResource: first, resource: renamed, transactionId: 'rename', operationId: 'rename', source: 'local' })
  store.applyResourceChange({ type: 'deleted', resource: renamed, transactionId: 'delete', operationId: 'delete', source: 'local' })

  assert.equal(store.get(session.tabId)?.resource?.path, 'wiki/renamed.md')
  assert.equal(store.get(session.tabId)?.state, 'deleted')
  assert.equal(store.canSaveToOriginal(session.tabId), false)
  store.rebindToCreatedResource(session.tabId, second, { value: 'r3', size: 3 })
  assert.equal(store.get(session.tabId)?.resource?.path, 'wiki/second.md')
  assert.equal(store.canSaveToOriginal(session.tabId), true)
})

test('external changes reload clean sessions and put dirty sessions in conflict', () => {
  const store = createEditorSessionStore()
  const clean = store.openProject(first, { type: 'doc' }, 'clean', revision)
  const dirty = store.openProject(second, { type: 'doc' }, 'clean', revision)
  store.updateDocument(dirty.tabId, { type: 'doc' }, 'local')

  const effects = store.applyResourceChange({ type: 'changed', resource: first, transactionId: 'external-first', operationId: 'external-first', source: 'external', revision: { value: 'r2', size: 2 } })
  store.applyResourceChange({ type: 'changed', resource: second, transactionId: 'external-second', operationId: 'external-second', source: 'external', revision: { value: 'r2', size: 2 } })

  assert.deepEqual(effects, [{ type: 'reload', tabId: clean.tabId, resource: first }])
  assert.equal(store.get(dirty.tabId)?.state, 'conflict')
})

test('reloading a clean session replaces its baseline without making it dirty', () => {
  const store = createEditorSessionStore()
  const session = store.openProject(first, { type: 'doc' }, 'old', revision)

  store.replaceLoaded(session.tabId, { type: 'doc' }, 'external', { value: 'r2', size: 8 })

  assert.equal(store.get(session.tabId)?.markdown, 'external')
  assert.equal(store.get(session.tabId)?.baseRevision?.value, 'r2')
  assert.equal(store.get(session.tabId)?.dirty, false)
})

test('editor sessions ignore a duplicate resource operation', () => {
  const store = createEditorSessionStore()
  const session = store.openProject(first, { type: 'doc' }, 'clean', revision)
  const change = { type: 'changed' as const, resource: first, transactionId: 'same-operation', operationId: 'same-operation', source: 'external' as const, revision: { value: 'r2', size: 2 } }

  assert.deepEqual(store.applyResourceChange(change), [{ type: 'reload', tabId: session.tabId, resource: first }])
  assert.deepEqual(store.applyResourceChange(change), [])
})

test('editor sessions apply every descendant transition in a directory batch', () => {
  const store = createEditorSessionStore()
  const session = store.openProject(first, { type: 'doc' }, 'clean', revision)
  const renamed = { ...first, path: 'notes/note.md', name: 'note.md' }

  const effects = store.applyResourceChange({
    type: 'batch', transactionId: 'directory-rename', operationId: 'directory-rename', source: 'local', changes: [
      { type: 'renamed', oldResource: { ...first, path: 'docs', name: 'docs', isDirectory: true, kind: 'binary' }, resource: { ...first, path: 'notes', name: 'notes', isDirectory: true, kind: 'binary' }, transactionId: 'directory-rename', operationId: 'directory-rename', source: 'local' },
      { type: 'renamed', oldResource: first, resource: renamed, transactionId: 'directory-rename', operationId: 'directory-rename', source: 'local' },
    ],
  })

  assert.deepEqual(effects, [])
  assert.equal(store.get(session.tabId)?.resource?.path, 'notes/note.md')
})

test('batch overwrite closes its clean target tab before moving the source tab', () => {
  const store = createEditorSessionStore()
  const source = store.openProject(first, { type: 'doc' }, 'source', revision)
  const target = store.openProject(second, { type: 'doc' }, 'target', revision)
  const moved = { ...first, path: second.path, name: second.name }

  const effects = store.applyResourceChange({
    type: 'batch', transactionId: 'overwrite', operationId: 'overwrite', source: 'local', changes: [
      { type: 'deleted', resource: second, transactionId: 'overwrite', operationId: 'overwrite', source: 'local' },
      { type: 'renamed', oldResource: first, resource: moved, transactionId: 'overwrite', operationId: 'overwrite', source: 'local' },
    ],
  })

  assert.deepEqual(effects, [{ type: 'close', tabId: target.tabId }])
  assert.equal(store.get(source.tabId)?.resource?.path, second.path)
  assert.equal(store.get(target.tabId), undefined)
})

test('session save queue serializes overlapping saves for one tab', async () => {
  const queue = createSessionSaveQueue()
  const order: string[] = []
  let releaseFirst!: () => void
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })
  const first = queue.run('tab_1', async () => {
    order.push('first:start')
    await firstGate
    order.push('first:end')
  })
  const second = queue.run('tab_1', async () => { order.push('second') })

  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(order, ['first:start'])
  releaseFirst()
  await Promise.all([first, second])
  assert.deepEqual(order, ['first:start', 'first:end', 'second'])
})

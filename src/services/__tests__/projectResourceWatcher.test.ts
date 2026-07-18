import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createProjectResourceWatcher } from '../projectResourceWatcher'
import type { ProjectResource } from '@/utils/projectResource'

function resource(updatedAt: number, size = 4, path = 'wiki/note.md', id?: string): ProjectResource {
  return {
    runtime: id ? 'web' : 'desktop', owner: '/project', path, id, name: path.split('/').pop()!,
    isDirectory: false, kind: 'document', updatedAt, size,
  }
}

test('resource watcher emits an external changed event only after its initial snapshot', () => {
  const watcher = createProjectResourceWatcher()
  assert.deepEqual(watcher.observe([resource(10)]), [])

  const changes = watcher.observe([resource(20)])

  assert.equal(changes.length, 1)
  assert.equal(changes[0].type, 'changed')
  assert.equal(changes[0].source, 'external')
  assert.equal(changes[0].revision.value, '20:4')
})

test('resource watcher suppresses the next observed local mutation', () => {
  const watcher = createProjectResourceWatcher()
  watcher.observe([resource(10)])
  watcher.acknowledgeLocal('wiki/note.md')

  assert.deepEqual(watcher.observe([resource(20)]), [])
})

test('resource watcher emits an external deletion for a previously observed resource', () => {
  const watcher = createProjectResourceWatcher()
  watcher.observe([resource(10)])

  const changes = watcher.observe([])

  assert.equal(changes.length, 1)
  assert.equal(changes[0].type, 'deleted')
  assert.equal(changes[0].source, 'external')
})

test('resource watcher turns a stable Web id path change into an external rename', () => {
  const watcher = createProjectResourceWatcher()
  const oldResource = resource(10, 4, 'wiki/old.md', 'web_1')
  const nextResource = resource(11, 4, 'wiki/new.md', 'web_1')
  watcher.observe([oldResource])

  const changes = watcher.observe([nextResource])

  assert.equal(changes.length, 1)
  assert.equal(changes[0].type, 'renamed')
  assert.equal(changes[0].oldResource.path, 'wiki/old.md')
  assert.equal(changes[0].resource.path, 'wiki/new.md')
})

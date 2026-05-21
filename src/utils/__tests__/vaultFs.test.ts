import assert from 'node:assert/strict'
import { test } from 'node:test'

import { inferRelativePath, safeRelativePath, sanitizeName } from '../vaultFs'

test('sanitizeName neutralizes traversal-only path segments', () => {
  assert.equal(sanitizeName('.'), 'unnamed')
  assert.equal(sanitizeName('..'), 'unnamed')
  assert.equal(sanitizeName('../资料'), '.._资料')
  assert.equal(sanitizeName(' a/b:资料?.md '), 'a_b_资料_.md')
})

test('safeRelativePath keeps virtual vault paths inside the vault root', () => {
  const path = safeRelativePath('../wiki/../../evil.md')
  assert.equal(path.startsWith('/'), false)
  assert.equal(path.split('/').includes('..'), false)
  assert.equal(path.split('/').includes('.'), false)
  assert.equal(path, 'unnamed/wiki/unnamed/unnamed/evil.md')
})

test('inferRelativePath sanitizes every folder segment before disk sync', () => {
  const root = {
    id: 'root',
    category: 'knowledge' as const,
    name: '..',
    content: '',
    mimeType: 'folder',
    size: 0,
    createdAt: 1,
    updatedAt: 1,
    vaultId: 'vault_1',
  }
  const child = {
    id: 'child',
    category: 'knowledge' as const,
    name: '.',
    content: '',
    mimeType: 'folder',
    size: 0,
    createdAt: 1,
    updatedAt: 1,
    folderId: 'root',
    vaultId: 'vault_1',
  }
  const file = {
    id: 'file',
    category: 'knowledge' as const,
    name: 'a/b.md',
    content: 'x',
    mimeType: 'text/markdown',
    size: 1,
    createdAt: 1,
    updatedAt: 1,
    folderId: 'child',
    vaultId: 'vault_1',
  }

  assert.equal(inferRelativePath(file, [root, child, file]), 'unnamed/unnamed/a_b.md')
})

test('inferRelativePath stops on folder cycles and ignores parents from other vaults', () => {
  const a = {
    id: 'a',
    category: 'knowledge' as const,
    name: 'A',
    content: '',
    mimeType: 'folder',
    size: 0,
    createdAt: 1,
    updatedAt: 1,
    folderId: 'b',
    vaultId: 'vault_1',
  }
  const b = { ...a, id: 'b', name: 'B', folderId: 'a' }
  const file = {
    id: 'file',
    category: 'knowledge' as const,
    name: 'note',
    content: 'x',
    mimeType: 'text/markdown',
    size: 1,
    createdAt: 1,
    updatedAt: 1,
    folderId: 'a',
    vaultId: 'vault_1',
  }
  const foreignParent = { ...a, id: 'foreign', name: 'Foreign', vaultId: 'vault_2' }
  const foreignChildFile = { ...file, id: 'foreign-file', folderId: 'foreign' }

  assert.equal(inferRelativePath(file, [a, b, file]), 'B/A/note.md')
  assert.equal(inferRelativePath(foreignChildFile, [foreignParent, foreignChildFile]), 'note.md')
})

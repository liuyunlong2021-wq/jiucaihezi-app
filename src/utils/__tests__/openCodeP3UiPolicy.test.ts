import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  closeEditorTabSafely,
  resolveOpenCodeP3KeyAction,
  shouldCloseEditorTabForEvent,
  shouldShowTabCloseCommand,
} from '../openCodeP3UiPolicy.ts'

test('OpenCode P3 shortcuts do not hijack text inputs', () => {
  const shortcuts = [
    { key: 'l', ctrlKey: true, isTauriRuntime: true },
    { key: '[', metaKey: true, altKey: true },
    { key: ']', ctrlKey: true, altKey: true },
    { key: '\\', metaKey: true },
    { key: 'w', metaKey: true, isTauriRuntime: true, hasActiveEditorFile: true },
  ]

  for (const shortcut of shortcuts) {
    assert.equal(resolveOpenCodeP3KeyAction({ ...shortcut, isTextInput: true }), null)
  }
})

test('OpenCode P3 resolves focus shortcut only in Tauri runtime', () => {
  assert.equal(
    resolveOpenCodeP3KeyAction({ key: 'l', ctrlKey: true, isTauriRuntime: true }),
    'focus-input',
  )
  assert.equal(
    resolveOpenCodeP3KeyAction({ key: 'l', ctrlKey: true, isTauriRuntime: false }),
    null,
  )
  assert.equal(
    resolveOpenCodeP3KeyAction({ key: 'l', ctrlKey: true, altKey: true, isTauriRuntime: true }),
    null,
  )
})

test('OpenCode P3 resolves message navigation shortcuts', () => {
  assert.equal(
    resolveOpenCodeP3KeyAction({ key: '[', metaKey: true, altKey: true }),
    'message-previous',
  )
  assert.equal(
    resolveOpenCodeP3KeyAction({ key: ']', ctrlKey: true, altKey: true }),
    'message-next',
  )
  assert.equal(
    resolveOpenCodeP3KeyAction({ key: '[', metaKey: true, altKey: true, shiftKey: true }),
    null,
  )
})

test('OpenCode P3 resolves file tree toggle shortcut', () => {
  assert.equal(
    resolveOpenCodeP3KeyAction({ key: '\\', metaKey: true }),
    'toggle-file-tree',
  )
  assert.equal(
    resolveOpenCodeP3KeyAction({ key: '\\', metaKey: true, altKey: true }),
    null,
  )
})

test('OpenCode P3 resolves tab close only when an editor file is active in Tauri', () => {
  assert.equal(
    resolveOpenCodeP3KeyAction({
      key: 'w',
      metaKey: true,
      isTauriRuntime: true,
      hasActiveEditorFile: true,
    }),
    'close-tab',
  )
  assert.equal(
    resolveOpenCodeP3KeyAction({
      key: 'w',
      metaKey: true,
      isTauriRuntime: false,
      hasActiveEditorFile: true,
    }),
    null,
  )
  assert.equal(
    resolveOpenCodeP3KeyAction({
      key: 'w',
      metaKey: true,
      isTauriRuntime: true,
      hasActiveEditorFile: false,
    }),
    null,
  )
})

test('OpenCode P3 tab close command visibility follows active editor file state', () => {
  assert.equal(shouldShowTabCloseCommand(null), false)
  assert.equal(shouldShowTabCloseCommand(undefined), false)
  assert.equal(shouldShowTabCloseCommand('file-1'), true)
})

test('OpenCode P3 editor close event requires exact current file match', () => {
  assert.equal(shouldCloseEditorTabForEvent('file-1', 'file-1'), true)
  assert.equal(shouldCloseEditorTabForEvent('file-1', 'file-2'), false)
  assert.equal(shouldCloseEditorTabForEvent('file-1', null), false)
  assert.equal(shouldCloseEditorTabForEvent(null, 'file-1'), false)
})

test('OpenCode P3 safe tab close does not clear a newly opened file after async save', async () => {
  let currentFileId: string | null = 'file-1'
  let savedFileId = ''
  let didClear = false

  const closed = await closeEditorTabSafely({
    getCurrentFileId: () => currentFileId,
    payloadFileId: 'file-1',
    saveCurrentFile: async (closingFileId) => {
      savedFileId = closingFileId
      currentFileId = 'file-2'
    },
    clearEditor: () => {
      didClear = true
      currentFileId = null
    },
  })

  assert.equal(savedFileId, 'file-1')
  assert.equal(closed, false)
  assert.equal(didClear, false)
  assert.equal(currentFileId, 'file-2')
})

test('OpenCode P3 safe tab close clears only after saving the same active file', async () => {
  let currentFileId: string | null = 'file-1'
  let savedFileId = ''

  const closed = await closeEditorTabSafely({
    getCurrentFileId: () => currentFileId,
    payloadFileId: 'file-1',
    saveCurrentFile: async (closingFileId) => {
      savedFileId = closingFileId
    },
    clearEditor: () => {
      currentFileId = null
    },
  })

  assert.equal(savedFileId, 'file-1')
  assert.equal(closed, true)
  assert.equal(currentFileId, null)
})

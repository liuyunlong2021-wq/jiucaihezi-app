import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

test('history list restores readable previews from conversations and messages', () => {
  const sessionStoreSource = readFileSync(join(process.cwd(), 'src/stores/sessionStore.ts'), 'utf8')
  const fileTreeSource = readFileSync(join(process.cwd(), 'src/components/filetree/FileTreePanel.vue'), 'utf8')

  assert.equal(sessionStoreSource.includes('preview?: string'), true)
  assert.equal(sessionStoreSource.includes('preview = buildPreview(messages)'), true)
  assert.equal(sessionStoreSource.includes('messagePreviews.get(String(r.id))'), true)
  assert.equal(sessionStoreSource.includes('saveSessionPreview'), true)

  assert.equal(fileTreeSource.includes('conversation.preview || messagePreviews.get(id)'), true)
  assert.equal(fileTreeSource.includes('messagePreview: preview'), true)
  assert.equal(fileTreeSource.includes('historySubtext(f)'), true)
})

test('history rows use a two-line layout instead of overlapping preview text', () => {
  const fileTreeSource = readFileSync(join(process.cwd(), 'src/components/filetree/FileTreePanel.vue'), 'utf8')

  assert.equal(fileTreeSource.includes("history: activeTab === 'history'"), true)
  assert.equal(fileTreeSource.includes('class="fp-item-text"'), true)
  assert.equal(fileTreeSource.includes('class="fp-item-preview"'), true)
  assert.equal(fileTreeSource.includes('.fp-item.history'), true)
  assert.equal(fileTreeSource.includes('-webkit-line-clamp: 2'), true)
})

test('chat sends are preview-saved before waiting for the streamed reply', () => {
  const chatPanelSource = readFileSync(join(process.cwd(), 'src/components/chat/ChatPanel.vue'), 'utf8')

  const sendStart = chatPanelSource.indexOf('const sendPromise = sendMessage')
  const previewSave = chatPanelSource.indexOf('await sessionStore.saveSessionPreview')
  const sendAwait = chatPanelSource.indexOf('await sendPromise')

  assert.ok(sendStart > -1)
  assert.ok(previewSave > sendStart)
  assert.ok(sendAwait > previewSave)
})

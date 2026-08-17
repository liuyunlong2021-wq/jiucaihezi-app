import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = process.cwd()
const source = (path: string) => readFileSync(join(root, path), 'utf8')

test('memory product routes Desktop drops only to explicit targets or the visible chat fallback', () => {
  assert.equal(existsSync(join(root, 'src/services/desktopProjectDrop.ts')), true)
  const dispatcher = source('src/services/desktopProjectDrop.ts')
  const app = source('src/App.vue')
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const creation = source('src/components/creation/CreationPanel.vue')

  assert.match(dispatcher, /onDragDropEvent/)
  assert.match(dispatcher, /elementFromPoint/)
  assert.match(dispatcher, /data-project-drop-target/)
  assert.match(dispatcher, /data-project-drop-target="chat"/)
  assert.doesNotMatch(dispatcher, /creation-focused/)
  assert.match(dispatcher, /emitEvent\('project:desktop-drop'/)
  assert.match(app, /startDesktopProjectDropDispatcher/)
  assert.match(workbench, /data-project-drop-target="chat"/)
  assert.match(workbench, /@drop\.prevent\.stop="onComposerDrop"/)
  assert.match(creation, /data-project-drop-target="canvas"/)
})

test('Desktop path expansion keeps readable files and reports failures and truncation', () => {
  const dispatcher = source('src/services/desktopProjectDrop.ts')
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const creation = source('src/components/creation/CreationPanel.vue')
  const tree = source('src/components/filetree/ProjectFileTree.vue')

  assert.match(dispatcher, /Promise\.allSettled/)
  assert.match(dispatcher, /warnings: string\[\]/)
  assert.match(dispatcher, /entries\.length >= MAX_DESKTOP_DROP_ENTRIES/)
  assert.match(dispatcher, /if \(!drop\.paths\.length && !drop\.warnings\.length\) return/)
  assert.match(workbench, /warnings\?: string\[\]/)
  assert.match(creation, /warnings\?: string\[\]/)
  assert.match(tree, /warnings\?: string\[\]/)
})

test('Desktop and Web drop paths are mutually exclusive at the consumers', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const creation = source('src/components/creation/CreationPanel.vue')
  const tree = source('src/components/filetree/ProjectFileTree.vue')

  assert.match(
    workbench,
    /async function onComposerDrop[\s\S]{0,160}if \(desktopOnlyRuntime \|\| sending\.value\) return/,
  )
  assert.match(creation, /isTauriRuntime\(\) && .*dataTransfer\?\.files/)
  assert.match(tree, /if \(isDesktop\) return/)
})

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = process.cwd()

function source(path: string) {
  return readFileSync(join(root, path), 'utf8')
}

test('Desktop uses one native drop dispatcher and routes panel targets by DOM marker', () => {
  const dispatcherPath = 'src/services/desktopProjectDrop.ts'
  assert.equal(existsSync(join(root, dispatcherPath)), true)
  const dispatcher = source(dispatcherPath)
  const workspace = source('src/layouts/WorkspaceLayout.vue')
  const chat = source('src/components/chat/ChatPanel.vue')
  const uploader = source('src/components/chat/FileUploader.vue')

  assert.match(dispatcher, /onDragDropEvent/)
  assert.match(dispatcher, /data-project-drop-target/)
  assert.match(dispatcher, /emitEvent\('project:desktop-drop'/)
  assert.match(workspace, /startDesktopProjectDropDispatcher/)
  assert.doesNotMatch(chat, /onDragDropEvent/)
  assert.match(
    uploader,
    /async function addProjectResources\(\s*resources: ProjectResource\[\],\s*referenceSource: 'project' \| 'canvas' = 'project'/,
  )
  assert.match(uploader, /projectFiles\.readBinary\(resource\)/)
})

test('each Desktop drop target imports a project resource before presenting it', () => {
  const tree = source('src/components/filetree/ProjectFileTree.vue')
  const canvas = source('src/components/creation/CreationPanel.vue')
  const chat = source('src/components/chat/ChatPanel.vue')
  const editor = source('src/components/editor/EditorPanel.vue')

  assert.match(tree, /data-project-drop-target="project"/)
  assert.match(tree, /projectFileActions\.importDesktopPaths/)
  assert.match(canvas, /data-project-drop-target="canvas"/)
  assert.match(canvas, /projectFileActions\.importDesktopPaths/)
  assert.match(chat, /data-project-drop-target="chat"/)
  assert.match(chat, /projectFileActions\.importDesktopPaths/)
  assert.match(editor, /data-project-drop-target="editor"/)
  assert.match(editor, /projectFileActions\.importDesktopPaths/)
})

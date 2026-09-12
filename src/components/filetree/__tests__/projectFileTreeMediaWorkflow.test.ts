import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const tree = readFileSync(
  join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
  'utf8',
)
const workbench = readFileSync(
  join(process.cwd(), 'src/components/memory/MemoryWorkbench.vue'),
  'utf8',
)

function sliceFunction(source: string, marker: string): string {
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `missing ${marker}`)
  const end = source.indexOf('\n}', start)
  assert.notEqual(end, -1, `unterminated ${marker}`)
  return source.slice(start, end)
}

test('方向键移动焦点时只对媒体文件通知预览跟随', () => {
  const notify = sliceFunction(tree, 'function notifyFocusedMedia()')
  assert.match(notify, /mediaKindOf\(/)
  assert.match(notify, /emitEvent\('filetree:focus-media'/)

  const keydown = sliceFunction(tree, 'function onTreeKeydown(')
  const arrows = keydown.slice(keydown.indexOf("case 'ArrowDown'"), keydown.indexOf("case 'ArrowLeft'"))
  assert.equal((arrows.match(/notifyFocusedMedia\(\)/g) || []).length, 2)
})

test('预览面板只在已经打开媒体预览时跟随焦点', () => {
  assert.match(workbench, /offFocusMedia = onEvent\('filetree:focus-media'/)
  const start = workbench.indexOf("onEvent('filetree:focus-media'")
  const handler = workbench.slice(start, workbench.indexOf("onEvent('toggle-file-tree'", start))
  assert.match(handler, /current\?\.type !== 'media'/)
  assert.match(handler, /openProjectResource\(files, resource\)/)
  assert.match(handler, /openResource\(result\)/)
  assert.match(workbench, /offFocusMedia\?\.\(\)/)
})

test('移动到新建文件夹复用建目录与批量移动合同', () => {
  const executor = sliceFunction(tree, 'async function ctxMoveToNewFolder()')
  assert.match(executor, /safePrompt\('新建文件夹名'/)
  assert.match(executor, /projectFiles\.createFolder\(owner, folderPath\)/)
  assert.match(executor, /kind: 'move'/)
  assert.match(executor, /prepareBatchCanvasLifecycle\(plan\)/)
  assert.match(executor, /executeBatch\(plan\)/)
  assert.match(executor, /isProtectedMemoryPath/)
  assert.match(executor, /MEMORY_MEDIA_DIRECTORY/)
})

test('菜单入口只在有选择时出现且在两个菜单分支都可用', () => {
  const entries =
    tree.match(
      /v-if="hasProjectSelection" class="pft-ctx-item" @click="ctxMoveToNewFolder"/g,
    ) || []
  assert.equal(entries.length, 2)
  assert.match(tree, /const hasProjectSelection = computed\(\(\) => selectedPaths\.value\.size > 0\)/)
})

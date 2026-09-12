import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const source = readFileSync(
  join(process.cwd(), 'src/components/filetree/ProjectFileTree.vue'),
  'utf8',
)

function sliceFunction(marker: string): string {
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `missing ${marker}`)
  const end = source.indexOf('\n}', start)
  assert.notEqual(end, -1, `unterminated ${marker}`)
  return source.slice(start, end)
}

test('媒体排序编号只出现在目录右键菜单里', () => {
  const directoryMenuStart = source.indexOf('v-else-if="ctxMenu.node?.isDir"')
  const fileMenuStart = source.indexOf('── 文件右键菜单 ──')
  assert.notEqual(directoryMenuStart, -1)
  assert.notEqual(fileMenuStart, -1)
  const directoryMenu = source.slice(directoryMenuStart, fileMenuStart)

  assert.match(directoryMenu, /媒体排序编号/)
  assert.match(directoryMenu, /ctxReorderMedia/)
  assert.match(directoryMenu, /mediaReorderAvailable === null \|\| mediaReorderAvailable > 1/)

  const fileMenu = source.slice(fileMenuStart)
  assert.doesNotMatch(fileMenu, /ctxReorderMedia/)
})

test('打开预演不修改任何文件，改名只发生在确认之后', () => {
  const open = sliceFunction('async function ctxReorderMedia()')
  assert.match(open, /planMediaReorder\(|buildMediaReorderPlan\(/)
  assert.doesNotMatch(open, /projectFiles\.rename\(/)

  const confirm = sliceFunction('async function confirmMediaReorder()')
  assert.match(confirm, /projectFiles\.rename\(/)
  assert.match(confirm, /temporaryReorderName\(/)
  assert.doesNotMatch(confirm, /keep-both/)
})

test('编号计划由纯函数产出，并复用现有重命名合同', () => {
  assert.match(source, /import \{[^}]*planMediaReorder[^}]*\} from '@\/utils\/mediaReorder'/)
  assert.match(source, /mediaKindOf\(/)
  assert.match(source, /isProtected: isProtectedMemoryPath/)
  assert.match(source, /getTask|mediaTaskStore\.tasks/)
})

test('编号基础名取当前文件夹名，而不是文件原名', () => {
  const build = sliceFunction('function buildMediaReorderPlan()')
  assert.match(build, /baseName: mediaReorderFolder\.value\?\.name/)

  const open = sliceFunction('async function ctxReorderMedia()')
  const folderReady = open.indexOf('mediaReorderFolder.value = {')
  assert.notEqual(folderReady, -1)
  assert.ok(
    folderReady < open.indexOf('buildMediaReorderPlan()'),
    '文件夹名必须在算计划之前就位',
  )
})

test('预演弹窗沿用现有弹窗的可访问性范式', () => {
  assert.match(source, /class="pft-reorder-overlay"/)
  assert.match(source, /role="dialog" aria-modal="true" aria-label="媒体排序编号"/)
  assert.match(source, /@click="confirmMediaReorder"/)
  assert.match(source, /@click="cancelMediaReorder"/)
})

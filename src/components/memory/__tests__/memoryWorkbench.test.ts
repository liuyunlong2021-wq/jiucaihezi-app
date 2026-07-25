import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

test('memory file tree keeps only the five requested toolbar actions', () => {
  const tree = source('src/components/filetree/ProjectFileTree.vue')
  const toolbar = tree.match(/<template v-if="props\.memoryMode">([\s\S]*?)<\/template>/)?.[1] || ''

  assert.deepEqual(Array.from(toolbar.matchAll(/title="([^"]+)"/g), match => match[1]), [
    '新建文件',
    '新建文件夹',
    '切换项目',
  ])
  assert.match(tree, /title="刷新"/)
  assert.match(tree, /title="隐藏文件树"/)
  assert.doesNotMatch(toolbar, /新建对话|上传|导入|导出/)
  assert.match(tree, /async function selectWebProject[\s\S]*initializeMemoryProject[\s\S]*memory:open-resource/)
})

test('memory workbench accepts text references and uses the adaptive main composer behavior', () => {
  const tree = source('src/components/filetree/ProjectFileTree.vue')
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const runtime = source('src/runtime/memory/memoryChat.ts')

  assert.match(tree, /props\.memoryMode \|\| isCanvasMediaFile/)
  assert.match(tree, /await projectFiles\.readText\(resourceForNode\(node\)\)/)
  assert.match(tree, /emitEvent\('reference-file', \{ name: node\.name, content: text\.content \}\)/)
  assert.match(workbench, /contenteditable="true"/)
  assert.match(workbench, /getPlainText\(event\.currentTarget as HTMLElement\)/)
  assert.match(workbench, /function resizeComposer\(\)/)
  assert.doesNotMatch(workbench, /<textarea/)
  assert.match(workbench, /files: referencedFiles\.value/)
  assert.match(runtime, /files: input\.files/)
})

test('memory Skill picker uses the same installed-user list as the Web warehouse', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const runtime = source('src/runtime/memory/memoryChat.ts')

  assert.match(workbench, /agentStore\.getCustomSkills\(\)/)
  assert.doesNotMatch(workbench, /loadWebSkillCatalog/)
  assert.match(runtime, /agentStore\.getCustomSkills\(\)\.find/)
})

test('memory Skill install card writes only after explicit approval', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const card = source('src/components/chat/SkillInstallCard.vue')

  assert.match(workbench, /parseSkillInstallPlan\(turn\.content\)/)
  assert.match(workbench, /async function approveSkillInstall\(turnId: string\)/)
  assert.match(workbench, /await agentStore\.createAgent\(/)
  assert.match(workbench, /@approve="approveSkillInstall\(turn\.id\)"/)
  assert.doesNotMatch(card, /createAgent|updateSkill|localStorage/)
  assert.match(card, /安装到我的 Skill/)
  assert.match(card, /继续修改/)
})

test('memory settings expose all four shared themes and initialize Web to green once', () => {
  const settings = source('src/components/memory/MemorySettings.vue')
  const theme = source('src/composables/useTheme.ts')

  for (const key of ['white', 'light', 'dark', 'green']) {
    assert.match(settings, new RegExp(`key: '${key}'`))
  }
  assert.match(settings, /theme = option\.key/)
  assert.match(theme, /jcMemoryThemeInitialized/)
  assert.match(theme, /return 'green'/)
})

test('memory file actions use the supported DOM prompt and headers share one baseline', () => {
  const tree = source('src/components/filetree/ProjectFileTree.vue')
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  for (const label of ['新建文件名', '新建文件夹名', '重命名']) {
    assert.match(tree, new RegExp(`safePrompt\\('${label}[\\s\\S]*?forceDom: props\\.memoryMode`))
  }
  assert.match(tree, /'memory-mode': props\.memoryMode/)
  assert.match(tree, /\.pft\.memory-mode \.pft-head[\s\S]*border-bottom: 0/)
  assert.match(workbench, /--memory-header-height: 74px/)
  assert.match(workbench, /grid-template-rows: var\(--memory-header-height\)/)
})

test('memory settings provide and persist three accessible font sizes', () => {
  const settings = source('src/components/memory/MemorySettings.vue')
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const main = source('src/main.ts')

  for (const size of [14, 16, 18]) assert.match(settings, new RegExp(`value: ${size}`))
  assert.match(settings, /localStorage\.setItem\('jcFontSize'/)
  assert.match(settings, /style\.setProperty\('--font-base'/)
  assert.match(workbench, /font-size: var\(--font-base\)/)
  assert.match(main, /localStorage\.getItem\('jcFontSize'\)/)
})

test('memory tree toggle collapses the desktop file tree and exposes reopen control', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(workbench, /'tree-closed': !treeOpen/)
  assert.match(workbench, /v-if="!treeOpen" class="icon-button" title="打开文件树"/)
  assert.match(workbench, /\.memory-workbench\.tree-closed \{ grid-template-columns: 0 minmax\(0, 1fr\); \}/)
  assert.match(workbench, /\.memory-workbench\.tree-closed \.memory-tree \{ overflow: hidden; border-right: 0; \}/)
})

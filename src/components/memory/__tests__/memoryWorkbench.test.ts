import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

test('memory file tree groups project identity above its three file actions', () => {
  const tree = source('src/components/filetree/ProjectFileTree.vue')
  const toolbar = tree.match(/<template v-if="props\.memoryMode">([\s\S]*?)<\/template>/)?.[1] || ''

  assert.deepEqual(Array.from(toolbar.matchAll(/title="([^"]+)"/g), match => match[1]), [
    '`切换项目：${projectStore.projectName.value}`',
    '隐藏文件树',
  ])
  assert.match(toolbar, /:title="`切换项目：\$\{projectStore\.projectName\.value\}`"/)
  assert.match(tree, /<\/header>\s*<div v-if="props\.memoryMode" class="pft-actions pft-memory-actions">[\s\S]*title="新建文件"[\s\S]*title="新建文件夹"[\s\S]*title="刷新"/)
  assert.doesNotMatch(toolbar, /新建对话|上传|导入|导出/)
  assert.doesNotMatch(tree, /async function selectWebProject[\s\S]*initializeMemoryProject/)
})

test('memory space and conversations are created only by their explicit actions', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const project = source('src/runtime/memory/memoryProject.ts')

  assert.match(workbench, /inspectMemoryProject\(owner, files\)/)
  assert.match(workbench, /async function createMemorySpace\(\)[\s\S]*initializeMemoryProject\(owner, files\)/)
  assert.match(workbench, /async function startNewConversation\(\)[\s\S]*createMemoryConversation\(owner, '新对话', files\)/)
  assert.match(workbench, /'新建记忆空间'/)
  assert.match(workbench, /<span>新建对话<\/span>/)
  assert.doesNotMatch(project, /initializeMemoryProject[\s\S]*return conversations\[0\]/)
})

test('memory workbench keeps project identity in the file tree and a native drag region in the header', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const tree = source('src/components/filetree/ProjectFileTree.vue')

  assert.match(workbench, /class="memory-title-drag" data-tauri-drag-region/)
  assert.match(workbench, /class="memory-workbench"[^>]*data-tauri-drag-region/)
  assert.match(workbench, /class="memory-title-drag" data-tauri-drag-region><\/div>/)
  assert.doesNotMatch(workbench, /memory-brand-logo/)
  assert.match(tree, /class="pft-brand-logo" src="\/logo\.svg"/)
  assert.match(tree, /class="pft-project-name"[\s\S]*projectStore\.projectName\.value/)
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

test('memory composer keeps quick and memory execution in one Raw conversation', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const runtime = source('src/runtime/memory/memoryChat.ts')

  assert.match(workbench, /executionMode = ref<ConversationMode>\('memory'\)/)
  assert.match(workbench, /快速[\s\S]*记忆/)
  assert.match(workbench, /appendMemoryTurn\([\s\S]*attachmentMetadata\(pendingAttachments\),[\s\S]*pendingMode/)
  assert.match(runtime, /const memoryMode = input\.mode !== 'quick'/)
  assert.match(runtime, /if \(!memoryMode\)[\s\S]*runDirectChatCompletion\([\s\S]*tools: undefined/)
})

test('memory composer routes pasted images and media plans through the shared attachment references', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(workbench, /@paste="handleComposerPaste"/)
  assert.match(workbench, /clipboardData\?\.items/)
  assert.match(workbench, /buildExplicitMediaReferences/)
  assert.match(workbench, /jc-media\/uploads/)
  assert.match(workbench, /projectPath: resourcePath/)
  assert.match(workbench, /conversationMediaContext/)
  assert.match(workbench, /refreshMediaPlanReferenceValues/)
  assert.match(workbench, /buildMediaReferencePolicy\(mediaContext\)/)
  assert.match(workbench, /parseMediaPlans\(turn\.content\)\s*\.map\(plan => resolveMediaPlanReferences\(plan, mediaContext\)\)/)
  assert.match(workbench, /onEvent\('media-reference:add', payload => void addProjectMediaReferences\(payload\)\)/)
  assert.match(workbench, /fileActions\.readMedia\(resource\)/)
  assert.match(workbench, /attachment\.resourcePath === resource\.path/)
  assert.match(workbench, /resourcePath: resource\.path/)
  assert.match(workbench, /v-for="\(plan, planIndex\) in mediaPlans\[turn\.id\]"/)
  assert.match(workbench, /mediaPlans\.value\[turn\.id\]\?\.length \? stripMediaPlanBlocks\(content\) : content/)
})

test('memory mode follows automatic Skill discovery without a user picker', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const runtime = source('src/runtime/memory/memoryChat.ts')

  assert.doesNotMatch(workbench, /SkillPickerBar|selectedSkillName/)
  assert.match(runtime, /mergeCreativeSkillCatalog\(customSkills, await loadWebSkillCatalog\(\)\)/)
  assert.match(runtime, /根据用户任务自主决定是否加载 Skill/)
  assert.doesNotMatch(runtime, /REQUIRED_SKILL|loadedRequiredSkill|queriedWiki|每次回复必须先调用/)
  assert.match(runtime, /if \(customSkill\?\.skillContent\.trim\(\)\)/)
})

test('memory topbar uses a grouped model popover and a text-only new conversation action', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(workbench, /class="new-conversation-button"[\s\S]*<span>新建对话<\/span>/)
  assert.match(workbench, /memory-conversation-picker[\s\S]*new-conversation-button[\s\S]*memory-title-drag[\s\S]*memory-topbar-actions/)
  assert.doesNotMatch(workbench, /new-conversation-button[\s\S]{0,180}<JcIcon/)
  assert.doesNotMatch(workbench, /<select v-model="agentStore\.currentModel"/)
  assert.match(workbench, /const modelGroups = computed/)
  assert.match(workbench, /Claude[\s\S]*GPT \/ OpenAI[\s\S]*Gemini \/ Google/)
  assert.match(workbench, /agentStore\.textModels\.filter\(model => !isInternalMediaModel\(model\.id\)\)/)
  assert.doesNotMatch(workbench, /runninghub: 'RunningHub'/)
  assert.match(workbench, /class="memory-model-menu" role="listbox"/)
  assert.match(workbench, /\.memory-model-menu \{[\s\S]*left: 0;/)
  assert.match(workbench, /role="option" :aria-selected="model\.id === agentStore\.currentModel"/)
  assert.match(workbench, /agentStore\.setModel\(modelId\)/)
})

test('memory document and file tree keep independent visible scrolling', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const tree = source('src/components/filetree/ProjectFileTree.vue')

  assert.match(workbench, /\.memory-tree \{[\s\S]*min-height: 0;[\s\S]*overflow: hidden;/)
  assert.match(workbench, /\.memory-document \{[\s\S]*height: 100%;[\s\S]*overflow-y: scroll;[\s\S]*scrollbar-gutter: stable;/)
  assert.match(tree, /\.pft-list \{[\s\S]*min-height: 0;[\s\S]*overflow-y: scroll;[\s\S]*scrollbar-gutter: stable;/)
})

test('memory media results stay project-first, downloadable, locatable and theme-aware', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const bubble = source('src/components/chat/MediaTaskBubble.vue')
  const tasks = source('src/stores/mediaTaskStore.ts')
  const writer = source('src/utils/projectMediaWriter.ts')

  assert.match(writer, /projectPath: resource\.path/)
  assert.match(tasks, /task\.projectPath = projectPath/)
  assert.match(workbench, /\u5e76\u4fdd\u5b58\u5230 \$\{projectPath\}/)
  assert.doesNotMatch(workbench, /\$\{result\.url \|\| result\.text \|\| ''\}/)
  assert.match(bubble, /> \u4e0b\u8f7d\s*<\/button>/)
  assert.match(bubble, /project-filetree:locate/)
  assert.match(bubble, /const displayUrl = computed/)
  assert.match(bubble, /:src="displayUrl"/)
  assert.match(bubble, /loading="lazy" decoding="async"/)
  assert.doesNotMatch(bubble, /<video|<audio|preload="metadata"/)
  assert.match(bubble, /class="mtb-media-preview"/)
  assert.match(bubble, /await revealInTree\(\)/)
  assert.doesNotMatch(bubble, /watch\(projectResource|projectMediaUrl|URL\.createObjectURL|URL\.revokeObjectURL/)
  assert.match(bubble, /async function downloadCopy\(\)[\s\S]*readBinary\(resource\)/)
  assert.match(bubble, /> \u5728\u6587\u4ef6\u6811\u4e2d\u67e5\u770b\s*<\/button>/)
  assert.doesNotMatch(bubble, /useFileStore|#6c5ce7|#a29bfe|--accent/)
  assert.match(bubble, /linear-gradient\(90deg, var\(--olive-dark\), var\(--olive\)\)/)
})

test('memory conversation virtualizes historical turns and keeps rich media out of the timeline', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(workbench, /import \{ useVirtualizer \} from '@tanstack\/vue-virtual'/)
  assert.match(workbench, /const memoryTimelineVirtualizer = useVirtualizer/)
  assert.match(workbench, /const virtualConversationTurns = computed/)
  assert.match(workbench, /v-for="\{ row, turn \} in virtualConversationTurns"/)
  assert.match(workbench, /:data-index="row\.index"/)
  assert.match(workbench, /measureMemoryTurn/)
})

test('memory media cards can rerun adjusted parameters and submit up to five image variants', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const card = source('src/components/chat/MediaPlanCard.vue')

  assert.match(workbench, /const mediaTasks = ref<Record<string, string\[\]>>/)
  assert.match(workbench, /for \(let index = 0; index < count; index\+\+\)/)
  assert.match(workbench, /已提交 \$\{taskIds\.length\}\/\$\{count\} 个任务/)
  assert.match(workbench, /mediaTasks\.value\[key\] = \[\.\.\.\(mediaTasks\.value\[key\] \|\| \[\]\), \.\.\.taskIds\]/)
  assert.match(workbench, /v-for="taskId in mediaTasks/)
  assert.match(card, /v-for="count in 5"/)
  assert.match(card, /独立付费任务，按单张价格分别计费/)
  assert.match(card, /status === 'submitted' \|\| status === 'failed' \? '再次生成'/)
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
  assert.match(tree, /\.pft\.memory-mode \.pft-head[\s\S]*border-bottom-color: var\(--line\)/)
  assert.match(workbench, /--memory-header-height: 74px/)
  assert.match(tree, /\.pft\.memory-mode \.pft-head \{[\s\S]*height: var\(--memory-header-height\)/)
  assert.match(tree, /\.pft-brand-logo \{[\s\S]*transform: translateY\(2px\)/)
  assert.match(tree, /\.pft-memory-actions \{[\s\S]*height: 34px/)
  assert.match(workbench, /\.memory-workbench\.desktop-runtime \{ --memory-header-height: 102px/)
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

test('Desktop starts the memory workbench without the legacy OpenCode workspace', () => {
  const app = source('src/App.vue')

  assert.match(app, /<MemoryWorkbench \/>/)
  assert.doesNotMatch(app, /WorkspaceLayout|useOpenCodeSyncStore|projectStoredNewApiForOpenCode/)
})

test('memory workbench follows the current project owner on both runtimes', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(workbench, /const projectOwner = computed\(\(\) => desktopRuntime[\s\S]*projectStore\.projectDir\.value[\s\S]*projectStore\.webProjectId\.value/)
  assert.match(workbench, /watch\(projectOwner, owner => void openProject\(owner\), \{ immediate: true \}\)/)
  assert.match(workbench, /inspectMemoryProject\(owner, files\)/)
  assert.match(workbench, /memoryReady\.value = state\.initialized[\s\S]*void projectTextSync\.open/)
  assert.match(workbench, /initializeMemoryProject\(owner, files\)[\s\S]*memoryReady\.value = true[\s\S]*void projectTextSync\.open/)
})

test('memory text models default to tools unless the gateway explicitly disables them', () => {
  const store = source('src/stores/agentStore.ts')
  const runtime = source('src/runtime/memory/memoryChat.ts')

  assert.match(store, /toolCall: capability === 'text' && item\.tool_call !== false && item\.toolCall !== false/)
  assert.match(runtime, /agentStore\.modelsFetched && model\?\.toolCall === false/)
})

test('memory file actions stay inside the memory resource route on Desktop', () => {
  const tree = source('src/components/filetree/ProjectFileTree.vue')

  assert.match(tree, /if \(props\.memoryMode\) \{\s*emitEvent\('memory:open-resource', result\)\s*return/)
  assert.match(tree, /createText\(projectKey\.value, relPath, ''\)[\s\S]*if \(props\.memoryMode\)[\s\S]*memory:open-resource/)
  assert.match(tree, /isDesktop && props\.memoryMode[\s\S]*用系统默认应用打开/)
})

test('memory navigation separates Raw conversations from project files and transient previews', () => {
  const tree = source('src/components/filetree/ProjectFileTree.vue')
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(tree, /path === '\.raw' \|\| path\.startsWith\('\.raw\/'\)/)
  assert.match(workbench, /const conversations = ref<MemoryConversation\[\]>\(\[\]\)/)
  assert.match(workbench, /class="memory-conversation-trigger"/)
  assert.match(workbench, /filteredConversations/)
  assert.match(workbench, /renameMemoryConversation\(item\.resource, nextTitle, files\)/)
  assert.match(workbench, /files\.planBatch\(\{ kind: 'delete', resources: \[item\.resource\] \}\)/)
  assert.match(workbench, /files\.executeBatch\(plan\)/)
  assert.match(workbench, /const previewResource = ref<ProjectResourceOpenResult \| null>\(null\)/)
  assert.match(workbench, /else \{\s*releaseMediaUrl\(\)\s*previewResource\.value = resource\s*\}/)
  assert.match(workbench, />返回对话</)
  assert.match(workbench, /event\.key === 'Escape' && previewResource\.value/)
  assert.doesNotMatch(workbench, /previewResource\.value = resource[\s\S]{0,100}opened\.value = resource/)
})

test('memory settings expose the existing Desktop local model runtime', () => {
  const settings = source('src/components/memory/MemorySettings.vue')
  const runtime = source('src/runtime/memory/memoryChat.ts')

  assert.match(settings, /connectLocalOllama/)
  assert.match(settings, /getLocalOllamaModels/)
  assert.match(settings, /agentStore\.refreshLocalModels\(\)/)
  assert.match(settings, /v-if="desktopRuntime" class="memory-local-model"/)
  assert.match(runtime, /createDesktopProjectToolExecutor\(\{ projectDir: input\.projectId \}\)/)
  assert.match(runtime, /platform: isTauriRuntime\(\) \? 'desktop' : 'web'/)
  assert.doesNotMatch(runtime, /forceCloud: true/)
})

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

test('memory project entry unifies local and cloud projects while settings only diagnoses sync', () => {
  const tree = source('src/components/filetree/ProjectFileTree.vue')
  const settings = source('src/components/memory/MemorySettings.vue')
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const main = source('src/main.ts')

  assert.match(tree, />项目中心</)
  assert.match(tree, />本机项目</)
  assert.match(tree, />云端项目</)
  assert.match(tree, /上传到云端/)
  assert.match(tree, /projectTextSync\.listCloudProjects\(\)/)
  assert.match(tree, /getGatewaySessionToken\(\) \|\| await initGatewaySessionToken\(\)/)
  assert.match(tree, /gatewaySessionAuthenticated/)
  assert.match(tree, /projectTextSync\.cloudProjectIdFor\(project\.owner\)/)
  assert.match(tree, /webProjectFiles\.createProject\(cloud\.name\)[\s\S]*projectTextSync\.connect\(cloud\.id\)/)
  assert.match(tree, /projectFiles\.list\(dir\)[\s\S]*空文件夹[\s\S]*projectTextSync\.connect\(cloud\.id\)/)
  assert.match(tree, /v-if="isDesktop && !isMobile"[\s\S]*打开本地文件夹[\s\S]*v-else-if="isMobile"[\s\S]*新建项目/)
  assert.match(tree, /createMobileProject\(cloud\.name, false\)[\s\S]*projectTextSync\.connect\(cloud\.id\)[\s\S]*projectStore\.selectProject\(project\.path\)/)
  assert.match(tree, /mobileProjects\.value\.find\(project => project\.name === projectStore\.projectName\.value\)[\s\S]*projectStore\.selectProject\(current\.path\)/)
  assert.match(tree, /onMounted\(async \(\) => \{[\s\S]*if \(isMobile\) await refreshMobileProjects\(\)/)
  assert.match(settings, /立即同步/)
  assert.match(settings, /mobileRuntime = isTauriMobileRuntime\(\)[\s\S]*isTauriRuntime\(\) && !mobileRuntime/)
  assert.match(settings, /:logged-in="gatewaySessionAuthenticated"/)
  assert.match(settings, /:open-url="openExternal"/)
  assert.match(settings, /mobileRuntime && gatewaySessionAuthenticated[\s\S]*退出登录/)
  assert.match(settings, /gatewayLogout\(\)/)
  assert.match(workbench, /\.memory-tree \{[^}]*inset: 0;[^}]*width: auto;/)
  assert.match(workbench, /\.memory-settings-drawer \{[^}]*inset: 0;[^}]*width: auto;/)
  assert.match(tree, /progressCurrent[\s\S]*只同步文字，媒体和空目录不同步/)
  assert.match(settings, /progressCurrent[\s\S]*只同步文字，媒体和空目录不同步/)
  assert.match(settings, /重新登录一次账号/)
  assert.match(main, /await initApiKey\(\)[\s\S]*await initGatewaySessionToken\(\)/)
  assert.doesNotMatch(settings, /selectedCloudProjectId|projectTextSync\.connect|projectTextSync\.enable/)
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
  for (const path of ['.raw/jc-media/文档', '.raw/jc-media/图片', '.raw/jc-media/视频', '.raw/jc-media/音频']) {
    assert.match(project, new RegExp(path))
  }
  assert.match(project, /migrateLegacyMemoryMaterials[\s\S]*kind: 'move'[\s\S]*'keep-both'/)
  assert.match(project, /appendMemoryRound[\s\S]*return mutateConversation[\s\S]*appendConversationTurn\(appendConversationTurn/)
})

test('mobile conversation deletion confirms permanent removal', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const tree = source('src/components/filetree/ProjectFileTree.vue')

  assert.match(workbench, /mobileRuntime[\s\S]*永久删除对话[\s\S]*此操作无法恢复/)
  assert.match(workbench, /okLabel: mobileRuntime \? '永久删除' : '删除'/)
  assert.match(tree, /usesSystemTrash = isDesktop && !isMobile/)
  assert.match(tree, /usesSystemTrash \? '移入废纸篓' : '永久删除'/)
})

test('memory workbench keeps project identity in the file tree and a native drag region in the header', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const tree = source('src/components/filetree/ProjectFileTree.vue')

  assert.match(workbench, /class="memory-title-drag" data-tauri-drag-region/)
  assert.match(workbench, /class="memory-workbench"[^>]*data-tauri-drag-region/)
  assert.match(workbench, /class="memory-title-drag" data-tauri-drag-region><\/div>/)
  assert.doesNotMatch(workbench, /memory-brand-logo/)
  assert.match(tree, /class="pft-brand-logo" src="\/logo\.svg"/)
  assert.match(tree, /class="pft-project-name pft-project-trigger"[\s\S]*projectStore\.projectName\.value/)
})

test('memory messages expose one copy action and project GLB files use the shared 3D viewer', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const viewer = source('src/components/media/Model3DViewer.vue')
  const mediaViewer = source('src/components/media/MediaViewer.vue')

  assert.match(workbench, /writeClipboardText\(displayTurnContent\(turn\)\)/)
  assert.match(workbench, /class="memory-message-copy"/)
  assert.match(workbench, /copiedTurnId === turn\.id \? 'check' : 'content-copy'/)
  assert.match(workbench, /<Model3DViewer[^>]*previewResource\.mediaKind === 'model3d' && modelData[^>]*:data="modelData"/)
  assert.match(workbench, /if \(resource\.mediaKind === 'model3d'\) \{\s+modelData\.value = data\.buffer/)
  assert.match(mediaViewer, /<Model3DViewer[^>]*type === 'model3d'/)
  assert.match(viewer, /GLTFLoader/)
  assert.match(viewer, /OrbitControls/)
  assert.match(viewer, /frameModel/)
  assert.match(viewer, /loader\.parse\(props\.data, '', onLoad, onError\)/)
  assert.match(viewer, /\.model-viewer \{ width: 100%; max-width: 100%; height: 68vh;/)
})

test('memory workbench accepts text references and uses the adaptive main composer behavior', () => {
  const tree = source('src/components/filetree/ProjectFileTree.vue')
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const runtime = source('src/runtime/memory/memoryChat.ts')

  assert.match(tree, /props\.memoryMode \|\| isCanvasMediaFile/)
  assert.match(tree, /props\.memoryMode[\s\S]*emitEvent\('reference-file', \{ resource: resourceForNode\(node\) \}\)/)
  assert.match(tree, /await projectFiles\.readText\(resourceForNode\(node\)\)/)
  assert.match(tree, /emitEvent\('reference-file', \{ name: node\.name, content: text\.content \}\)/)
  assert.match(workbench, /contenteditable="true"/)
  assert.match(workbench, /const editor = event\.currentTarget as HTMLElement[\s\S]*getPlainText\(editor\)/)
  assert.match(workbench, /function resizeComposer\(\)/)
  assert.match(workbench, /<textarea[\s\S]*v-model="markdownDraft"/)
  assert.match(workbench, /files: referencedFiles\.value/)
  assert.match(runtime, /files: input\.files/)
})

test('memory workbench saves Office attachments as durable project materials', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const tree = source('src/components/filetree/ProjectFileTree.vue')
  const runtime = source('src/runtime/memory/memoryChat.ts')

  assert.match(workbench, /type === 'office' \|\| type === 'pdf'/)
  assert.match(workbench, /processFile\(file, \{ maxTextLength: 20_000_000 \}\)/)
  assert.match(workbench, /files\.createText\(owner, readablePath, processed\.textContent\)/)
  assert.match(workbench, /readablePath/)
  assert.match(workbench, /characterCount: processed\.textContent\.length/)
  assert.match(workbench, /!\['image', 'video', 'audio'\]\.includes\(type\)[\s\S]*files\.importBinary/)
  assert.match(workbench, /已保存 · 已解析/)
  assert.doesNotMatch(workbench, /textContent: processed\.textContent/)
  assert.match(workbench, /value: ''/)
  assert.match(workbench, /resource\.runtime === 'desktop'/)
  assert.match(workbench, /document_path_to_markdown_file/)
  assert.match(workbench, /sourcePath: `\$\{resource\.owner\}\/\$\{resource\.path\}`/)
  assert.match(workbench, /outputDir: `\$\{resource\.owner\}\/\.raw\/jc-media\/文档`/)
  assert.match(workbench, /referencingDocuments\.has\(referenceKey\)/)
  assert.match(workbench, /\(resource\.size \|\| 0\) > 20 \* 1024 \* 1024/)
  assert.match(workbench, /await files\.readBinary\(resource\)/)
  assert.match(workbench, /legacyPath = resource\.path\.startsWith/)
  assert.match(workbench, /addProjectFileReference\(option\.resource\)/)
  assert.match(workbench, /\.raw\/jc-media\/文档/)
  assert.doesNotMatch(workbench, /jc-materials/)
  assert.doesNotMatch(tree, /memoryMaterialDisplayName/)
  assert.match(tree, /while \(parts\.length\)[\s\S]*findLoadedDirectory\(parts\.join\('\/'\)\)[\s\S]*parts\.pop\(\)/)
  assert.doesNotMatch(runtime, /只写了尚未执行的脚本不算完成/)
})

test('memory composer keeps quick and memory execution in one Raw conversation', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const runtime = source('src/runtime/memory/memoryChat.ts')

  assert.match(workbench, /executionMode = ref<ConversationMode>\('memory'\)/)
  assert.match(workbench, /快速[\s\S]*记忆/)
  assert.match(workbench, /appendMemoryRound\(active\.resource, userTurn, reply, files, title\)/)
  assert.match(runtime, /messages: \[input\.userTurn\]/)
  assert.match(runtime, /rawPath: string/)
  assert.match(runtime, /const memoryMode = input\.mode !== 'quick'/)
  assert.match(runtime, /READ_ONLY_DOCUMENT_TOOL_DEFINITIONS/)
  assert.match(runtime, /if \(!memoryMode && !hasDocumentSources && !hasDirectUrls\)[\s\S]*tools: undefined/)
  assert.match(runtime, /if \(!memoryMode && !\['read', 'grep', 'read_url'\]\.includes\(call\.function\.name\)\)/)
  assert.match(runtime, /call\.function\.name === 'web_search'[\s\S]*executeJinaWebSearchTool\(call\.function\.arguments\)/)
  assert.match(runtime, /\.\.\.\(input\.webSearchEnabled \? \[WEB_SEARCH_TOOL_DEFINITION\] : \[\]\)/)
})

test('memory composer routes pasted images and media plans into the existing creation panel', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(workbench, /@paste="handleComposerPaste"/)
  assert.match(workbench, /clipboardData\?\.items/)
  assert.match(workbench, /buildExplicitMediaReferences/)
  assert.match(workbench, /\.raw\/jc-media\/\$\{type === 'image' \? '图片'/)
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
  assert.match(workbench, /defineAsyncComponent\(\(\) => import\('@\/components\/creation\/CreationPanel\.vue'\)\)/)
  assert.match(workbench, /emitEvent\('memory-media-plan-load'/)
  assert.match(workbench, /class="memory-creation"/)
  assert.doesNotMatch(workbench, /import MediaPlanCard/)
  assert.doesNotMatch(workbench, /<MediaPlanCard/)
  assert.match(workbench, /mediaPlans\.value\[turn\.id\]\?\.length \? stripMediaPlanBlocks\(content\) : content/)
})

test('memory mode keeps automatic discovery and lets @ explicitly load an installed Skill', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const runtime = source('src/runtime/memory/memoryChat.ts')

  assert.doesNotMatch(workbench, /SkillPickerBar/)
  assert.match(workbench, /agentStore\.getCustomSkills\(\)/)
  assert.match(workbench, /files\.searchPaths\(owner, query\.trim\(\), 40\)/)
  assert.match(workbench, /const selectedSkillNames = ref<string\[\]>\(\[\]\)/)
  assert.match(workbench, /getCursorPosition\(editor\)/)
  assert.match(workbench, /input\.value\.slice\(0, cursorPos \|\| input\.value\.length\)\.match\(\/@\(\\S\*\)\$\/\)/)
  assert.match(workbench, /v-show="mentionOpen"/)
  assert.match(workbench, /addProjectFileReference\(option\.resource\)/)
  assert.match(workbench, /resource\.kind !== 'binary' \|\| isOfficeResource\(resource\)/)
  assert.match(workbench, /selectedSkillNames: selectedSkillNames\.value/)
  assert.match(runtime, /mergeCreativeSkillCatalog\(customSkills, await loadWebSkillCatalog\(\)\)/)
  assert.match(runtime, /根据用户任务自主决定是否加载 Skill/)
  assert.doesNotMatch(runtime, /REQUIRED_SKILL|loadedRequiredSkill|queriedWiki|每次回复必须先调用/)
  assert.match(runtime, /if \(customSkill\?\.skillContent\.trim\(\)\)/)
  assert.match(runtime, /buildToolResultMessages\(/)
  assert.match(runtime, /selectedSkillNames\.map\(\(name, index\)/)
  assert.match(runtime, /function: \{ name: 'skill', arguments: JSON\.stringify\(\{ name \}\) \}/)
  assert.match(runtime, /buildMemoryDesktopToolDefinitions\(\)/)
  assert.match(runtime, /buildMemoryWebProjectToolDefinitions\(\)/)
})

test('memory web search is an explicit removable one-turn @ option', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const runtime = source('src/runtime/memory/memoryChat.ts')

  assert.match(workbench, /const webSearchEnabled = ref\(false\)/)
  assert.match(workbench, /type: 'search'[\s\S]*display: '联网搜索'[\s\S]*仅本轮搜索公开网络/)
  assert.match(workbench, /option\.type === 'search'[\s\S]*webSearchEnabled\.value = true[\s\S]*executionMode\.value = 'memory'/)
  assert.match(workbench, /v-if="webSearchEnabled"[\s\S]*<JcIcon name="search"[\s\S]*联网搜索[\s\S]*webSearchEnabled = false/)
  assert.match(workbench, /webSearchEnabled: webSearchEnabled\.value/)
  assert.match(workbench, /selectedSkillNames\.value = \[\][\s\S]*webSearchEnabled\.value = false/)
  assert.match(workbench, /mode === 'quick'[\s\S]*webSearchEnabled\.value = false/)
  assert.match(runtime, /webSearchEnabled\?: boolean/)
  assert.match(runtime, /\.\.\.\(input\.webSearchEnabled \? \[WEB_SEARCH_TOOL_DEFINITION\] : \[\]\)/)
  assert.doesNotMatch(runtime, /tools: \[\.\.\.buildWebProjectToolDefinitions\(\), WEB_SEARCH_TOOL_DEFINITION\]/)
})

test('memory reads an explicit URL without enabling web search', () => {
  const runtime = source('src/runtime/memory/memoryChat.ts')

  assert.match(runtime, /extractPublicHttpUrls\(latestUserText\)/)
  assert.match(runtime, /hasDirectUrls \? \[READ_URL_TOOL_DEFINITION\] : \[\]/)
  assert.match(runtime, /call\.function\.name === 'read_url'/)
  assert.match(runtime, /不要把读网址说成联网搜索/)
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
  assert.match(workbench, /id === 'jina-search' \|\| id === 'jina-reader'/)
  assert.doesNotMatch(workbench, /runninghub: 'RunningHub'/)
  assert.match(workbench, /class="memory-model-menu" role="listbox"/)
  assert.match(workbench, /\.memory-model-menu \{[\s\S]*left: 0;/)
  assert.match(workbench, /role="option" :aria-selected="model\.id === agentStore\.currentModel"/)
  assert.match(workbench, /agentStore\.setModel\(modelId\)/)
})

test('memory message copy stays compact and copies the original markdown', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(workbench, /writeClipboardText\(displayTurnContent\(turn\)\)/)
  assert.match(workbench, /\.memory-message-copy \{ position: absolute; top: 0; right: 0;[\s\S]*width: 26px; height: 26px;/)
})

test('markdown editor keeps pre and textarea under the shared stylesheet', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const markdownCss = source('src/styles/markdown.css')

  assert.doesNotMatch(workbench, /\.memory-document pre\s*\{/)
  assert.match(markdownCss, /\.memory-markdown-editor pre,\s*\n\.memory-markdown-editor textarea\s*\{[\s\S]*font: \.92em\/1\.6/)
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
  assert.match(workbench, /mediaTaskIdForPlan/)
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

test('iPhone release metadata declares Photos permission and exempt encryption use', () => {
  const infoPlist = source('src-tauri/Info.ios.plist')

  assert.match(infoPlist, /<key>NSPhotoLibraryAddUsageDescription<\/key>\s*<string>[^<]+<\/string>/)
  assert.match(infoPlist, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/)
})

test('memory conversation uses one natural document flow for saved and streaming turns', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const scrollNav = source('src/components/chat/ChatScrollNav.vue')

  assert.match(workbench, /const timelineTurns = computed<ConversationTurn\[\]>/)
  assert.match(workbench, /id: 'streaming-assistant'/)
  assert.match(workbench, /v-for="turn in timelineTurns"/)
  assert.match(workbench, /turn\.id === 'streaming-assistant' \? renderStreamingText\(content\) : renderMemoryMarkdown\(content\)/)
  assert.match(workbench, /watch\(streamingText,[\s\S]*scheduleAutoScrollIfNeeded\(\)/)
  assert.match(workbench, /const complete = await appendMemoryRound[\s\S]*const completeResource = await openProjectResource[\s\S]*opened\.value = completeResource\s*\n\s*streamingText\.value = ''/)
  assert.match(workbench, /pendingUserTurn\.value = userTurn/)
  assert.match(workbench, /executionMode\.value =[\s\S]*await nextTick\(\)[\s\S]*startStickyFollow\(\)/)
  assert.match(workbench, /\.memory-messages \{[^}]*overflow-y: scroll;/)
  assert.match(scrollNav, /querySelectorAll\('\.msg, \.memory-message'\)/)
  assert.doesNotMatch(workbench, /useVirtualizer|estimateSize|measureElement|getTotalSize|translateY\(/)
  assert.doesNotMatch(workbench, /\.memory-message-list > \.memory-message \{[^}]*position: absolute/)
})

test('memory run status follows real tool start and end events without entering Raw', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const runtime = source('src/runtime/memory/memoryChat.ts')

  assert.match(runtime, /onToolEvent\?: \(event: DirectToolExecutionEvent\) => void/)
  assert.equal((runtime.match(/input\.onToolEvent\?\.\(event\)/g) || []).length, 2)
  assert.doesNotMatch(runtime, /event\.type === 'tool_execution_start'\) input\.onToolEvent/)
  assert.match(workbench, /onToolEvent: updateRunTool/)
  assert.match(workbench, /event\.type === 'tool_execution_start'[\s\S]*status\.value = `正在\$\{label\}`/)
  assert.match(workbench, /event\.status === 'succeeded' \? 'done' : 'failed'[\s\S]*正在等待模型继续处理/)
  assert.match(workbench, /v-if="runVisible" class="memory-run-status"/)
  assert.match(workbench, /v-for="step in visibleRunSteps"/)
  assert.match(workbench, /\(sending \|\| error\) && visibleRunSteps\.length/)
  assert.match(workbench, /formatRunElapsed\(runElapsed\)/)
  assert.doesNotMatch(workbench, /opencodeClient|openCodeSyncStore|AgentStatusBar/)
})

test('memory Desktop keeps always-allow for the current conversation in this App session', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const runtime = source('src/runtime/memory/memoryChat.ts')

  assert.match(runtime, /beforeToolCall:/)
  assert.match(runtime, /memoryToolNeedsApproval/)
  assert.match(workbench, /pendingMemoryToolApproval/)
  assert.match(workbench, /<ToolApprovalStrip/)
  assert.match(workbench, /decision === 'always'/)
  assert.match(workbench, /memoryToolAlwaysAllowedConversations\.has\(active\.transcript\.id\)/)
  assert.match(workbench, /memoryToolAlwaysAllowedConversations\.add\(active\.transcript\.id\)/)
  assert.match(workbench, /call\.function\.name !== 'delete'/)
  assert.doesNotMatch(workbench, /localStorage[\s\S]{0,120}始终允许/)
  assert.match(workbench, /memoryRunGeneration\+\+/)
  assert.match(workbench, /settleMemoryToolApproval\('reject'\)[\s\S]*abortController\?\.abort\(\)/)
})

test('memory run status does not render the legacy duplicate status line', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const runtime = source('src/runtime/memory/memoryChat.ts')

  assert.match(workbench, /v-else-if="!runVisible && \(status \|\| error\)" class="memory-status"/)
  assert.doesNotMatch(runtime, /以最后一条用户消息为当前指令/)
})

test('memory settings show the build version at the bottom', () => {
  const settings = source('src/components/memory/MemorySettings.vue')

  assert.match(settings, /const appVersion = __APP_VERSION__/)
  assert.match(settings, /<footer class="memory-settings-version">版本 \{\{ appVersion \}\}<\/footer>/)
})

test('memory media execution stays in the creation panel while settled results return to chat', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(workbench, /emitEvent\('memory-media-plan-load'/)
  assert.match(workbench, /mediaTaskIdForPlan/)
  assert.match(workbench, /mediaResultTaskId/)
  assert.match(workbench, /<MediaTaskBubble/)
  assert.doesNotMatch(workbench, /appendMemoryTurn/)
  assert.doesNotMatch(workbench, /mediaPlanStatus|mediaGenerationCounts|approveMediaPlan/)
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
  assert.match(workbench, /--memory-header-height: 52px/)
  assert.match(tree, /\.pft\.memory-mode \.pft-head \{[\s\S]*height: var\(--memory-header-height\)/)
  assert.match(tree, /\.pft-brand-logo \{[\s\S]*transform: translateY\(3px\)/)
  assert.match(tree, /\.pft-memory-actions \{[\s\S]*height: 34px/)
  assert.match(workbench, /\.memory-workbench\.desktop-runtime \{ padding-top: 28px/)
  assert.match(workbench, /grid-template-rows: var\(--memory-header-height\)/)
})

test('memory creation surface reuses resizable columns, host preview, and sticky scrolling', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const creation = source('src/components/creation/CreationPanel.vue')

  assert.match(workbench, /const creationWidth = ref\(/)
  assert.match(workbench, /localStorage\.setItem\('jcMemoryCreationWidth'/)
  assert.match(workbench, /@pointerdown\.prevent="startCreationResize"/)
  assert.match(workbench, /<ChatScrollNav/)
  assert.match(workbench, /preview-surface="host"/)
  assert.match(workbench, /@preview-resource="previewProjectResource"/)
  assert.match(workbench, /#toolbar-actions/)
  assert.match(workbench, /:title="creationFocused \? '\u9000\u51fa\u4e13\u6ce8\u521b\u4f5c' : '\u4e13\u6ce8\u521b\u4f5c'"/)
  assert.match(workbench, /title="\u6536\u8d77\u521b\u4f5c\u9762\u677f"/)
  assert.match(creation, /<slot name="toolbar-actions"/)
  assert.match(creation, />\u63d0\u793a\u8bcd\u53c2\u8003</)
  assert.doesNotMatch(creation, /title="\u65b0\u5efa\u9879\u76ee\u6587\u6863"/)
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
  const studioApp = source('src/StudioApp.vue')
  const vite = source('vite.config.ts')

  assert.match(app, /<MemoryWorkbench \/>/)
  assert.doesNotMatch(app, /WorkspaceLayout|useOpenCodeSyncStore|projectStoredNewApiForOpenCode/)
  assert.match(studioApp, /<WorkspaceLayout \/>/)
  assert.match(studioApp, /useOpenCodeSyncStore|projectStoredNewApiForOpenCode/)
  assert.match(vite, /mode === 'studio' \? 'src\/StudioApp\.vue' : 'src\/App\.vue'/)
})

test('memory workbench follows the current project owner on both runtimes', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(workbench, /const projectOwner = computed\(\(\) => desktopRuntime[\s\S]*projectStore\.projectDir\.value[\s\S]*projectStore\.webProjectId\.value/)
  assert.match(workbench, /watch\(projectOwner, owner => void openProject\(owner\), \{ immediate: true \}\)/)
  assert.match(workbench, /inspectMemoryProject\(owner, files\)/)
  assert.match(workbench, /memoryReady\.value = state\.initialized[\s\S]*void projectTextSync\.open/)
  assert.match(workbench, /initializeMemoryProject\(owner, files\)[\s\S]*memoryReady\.value = true[\s\S]*void projectTextSync\.open/)
  assert.doesNotMatch(workbench, /syncOnFocus|addEventListener\('focus'/)
  assert.doesNotMatch(workbench, /projectTextSync\.open\([\s\S]{0,180}projectTextSync\.enable\(\)/)
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

  assert.match(tree, /'\.raw\/\.sync'/)
  assert.match(tree, /'\.raw\/对话记录'/)
  assert.match(tree, /isProtectedMemoryPath[\s\S]*path === '\.raw'/)
  assert.match(workbench, /const conversations = ref<MemoryConversation\[\]>\(\[\]\)/)
  assert.match(workbench, /class="memory-conversation-trigger"/)
  assert.match(workbench, /filteredConversations/)
  assert.match(workbench, /renameMemoryConversation\(item\.resource, nextTitle, files\)/)
  assert.match(workbench, /files\.planBatch\(\{ kind: 'delete', resources: \[item\.resource\] \}\)/)
  assert.match(workbench, /files\.executeBatch\(plan\)/)
  assert.match(workbench, /const previewResource = ref<ProjectResourceOpenResult \| null>\(null\)/)
  assert.match(workbench, /else \{\s*releaseMediaUrl\(\)\s*previewResource\.value = resource/)
  assert.match(workbench, />返回对话</)
  assert.match(workbench, /event\.key === 'Escape' && previewResource\.value/)
  assert.doesNotMatch(workbench, /resource\.type === 'canvas'[\s\S]*openCreationHost\(\)/)
  assert.doesNotMatch(workbench, /previewResource\.value = resource[\s\S]{0,100}opened\.value = resource/)
})

test('memory files and conversation turns use the shared safe Markdown renderer', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(workbench, /function renderMemoryTurn\(turn: ConversationTurn\)/)
  assert.match(workbench, /turn\.id === 'streaming-assistant' \? renderStreamingText\(content\) : renderMemoryMarkdown\(content\)/)
  assert.match(workbench, /v-html="renderMemoryTurn\(turn\)"/)
  assert.match(workbench, /renderMemoryMarkdown\(previewResource\.text\.content\)/)
  assert.match(workbench, /v-html="renderMemoryMarkdown\(/)
  assert.doesNotMatch(workbench, /<pre>\{\{ previewResource\.text\.content \}\}<\/pre>/)
})

test('memory Markdown supports forward links and scanned backlink sources', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const links = source('src/runtime/memory/markdownLinks.ts')

  assert.match(workbench, /resolveWikiLinkTarget\(target, sourcePath, await files\.list\(owner\)\)/)
  assert.match(workbench, /findWikiBacklinks\(target, sources\)/)
  assert.match(workbench, /被以下文件引用/)
  assert.match(workbench, /文件不存在：\$\{target\}/)
  assert.doesNotMatch(workbench, /wiki.*index.*database/i)
  assert.match(links, /parseWikiLinks/)
  assert.match(links, /resources: ProjectResource\[\]/)
})

test('memory Markdown editing keeps source text and protects revision conflicts', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(workbench, /const markdownDraft = ref\(''\)/)
  assert.match(workbench, /files\.writeText\(current\.resource, markdownDraft\.value, current\.text\.revision\)/)
  assert.match(workbench, /result\.status === 'conflict'/)
  assert.match(workbench, /当前草稿已保留/)
  assert.match(workbench, /v-model="markdownDraft"/)
  assert.match(workbench, /highlightCode\(markdownDraft, 'markdown'\)/)
  assert.match(workbench, /title="编辑 Markdown"/)
})

test('Windows startup does not infer WebView2 availability from the browser user agent', () => {
  const main = source('src/main.ts')

  assert.doesNotMatch(main, /当前使用的浏览器不是 Edge|LinkId=2124703|\/Edg\\\//)
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

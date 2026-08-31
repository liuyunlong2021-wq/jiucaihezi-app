import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { shouldReadNativeClipboardImage } from '@/utils/clipboard'

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

test('memory right chat dock separates preview layout and collapses to a compact rail', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const markdown = source('src/components/memory/MemoryMarkdown.vue')

  assert.match(workbench, /class="memory-main memory-chat-dock"/)
  assert.doesNotMatch(workbench, /<Teleport to="\.memory-workbench">/)
  assert.match(workbench, /const MEMORY_CHAT_DEFAULT = 360/)
  assert.match(workbench, /const MEMORY_CHAT_FULL_MIN = 220/)
  assert.match(workbench, /const MEMORY_CHAT_COMPACT = 56/)
  assert.match(workbench, /chatDockMode.*expanded.*compact|chatDockMode.*compact.*expanded/)
  assert.doesNotMatch(workbench, /minmax\(420px, 1fr\)/)
  assert.match(
    workbench,
    /\.memory-preview[^}]*position: relative|\.memory-preview[^}]*position: static/,
  )
  assert.match(workbench, /if \(previewResource\.value\) closePreview\(\)/)
  assert.match(workbench, /creationMounted\.value && !\(await closeCreationHost\(\)\)/)
  assert.match(workbench, /if \(creationClosePromise\) return creationClosePromise/)
  assert.match(
    workbench,
    /if \(generation !== resourceOpenGeneration\) return\s*prepareDockLayout\(\)/,
  )
  assert.match(
    workbench,
    /function prepareDockLayout\(\) \{\s*if \(window\.innerWidth < 940\) return/,
  )
  assert.match(
    workbench,
    /\.memory-workbench\.creation-open \{ grid-template-columns: 280px minmax\(0, 1fr\) var\(--memory-chat-width\); \}/,
  )
  assert.doesNotMatch(
    workbench,
    /jcMemoryCreationWidth|startCreationResize|memory-creation-resizer/,
  )
  assert.match(workbench, /'chat-dock-narrow': viewportWidth >= 940[\s\S]*chatDockWidth < 560/)
  assert.match(workbench, /viewportWidth\.value = window\.innerWidth/)
  assert.match(workbench, /class="memory-new-conversation-icon"/)
  assert.match(workbench, /class="memory-model-icon"/)
  assert.doesNotMatch(workbench, /memory-mobile-creation/)
  assert.equal(workbench.match(/title="创作面板"/g)?.length, 1)
  assert.match(workbench, /\.memory-chat-dock-resizer::after/)
  assert.match(workbench, /\.memory-document \{[^}]*container-type: inline-size;/)
  assert.match(markdown, /@container \(max-width: 700px\)/)
  assert.match(markdown, /'outline-collapsed': !outlineOpen/)
  assert.match(
    markdown,
    /\.memory-markdown-renderer\.with-outline\.outline-collapsed\{grid-template-columns:minmax\(0,1fr\);gap:0\}/,
  )
  assert.match(markdown, /\.outline-collapsed \.memory-document-outline\{position:absolute;/)
  assert.match(markdown, /<JcIcon v-else name="view-list" \/>/)
})

test('memory file tree groups project identity above its three file actions', () => {
  const tree = source('src/components/filetree/ProjectFileTree.vue')
  const toolbar = tree.match(/<header class="pft-head">([\s\S]*?)<\/header>/)?.[1] || ''

  assert.deepEqual(
    Array.from(toolbar.matchAll(/title="([^"]+)"/g), match => match[1]),
    ['`切换项目：${projectStore.projectName.value}`', '隐藏文件树'],
  )
  assert.match(toolbar, /:title="`切换项目：\$\{projectStore\.projectName\.value\}`"/)
  assert.match(
    tree,
    /<\/header>\s*<div class="pft-actions pft-memory-actions">[\s\S]*title="新建文件"[\s\S]*title="新建文件夹"[\s\S]*title="刷新"/,
  )
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
  assert.match(tree, /上传并覆盖云端/)
  assert.match(tree, /下载并覆盖本地/)
  assert.doesNotMatch(tree, /立即同步/)
  assert.match(tree, /projectTextSync\.listCloudProjects\(\)/)
  assert.match(tree, /getGatewaySessionToken\(\) \|\| await initGatewaySessionToken\(\)/)
  assert.match(tree, /gatewaySessionAuthenticated/)
  assert.match(tree, /projectTextSync\.cloudProjectIdFor\(project\.owner\)/)
  assert.match(tree, /project\.name === cloud\.name/)
  assert.match(tree, /@click="openCloudProject\(project\)"/)
  assert.match(
    tree,
    /async function openCloudProject\(cloud: SyncProject\)[\s\S]*confirmAction\([\s\S]*localOwnerForCloud\(cloud\)/,
  )
  assert.doesNotMatch(tree, /downloadCurrentProject/)
  assert.match(
    tree,
    /webProjectFiles\.createProject\(cloud\.name\)[\s\S]*projectTextSync\.connect\(cloud\.id\)/,
  )
  assert.match(
    tree,
    /projectFiles\.list\(dir\)[\s\S]*空文件夹[\s\S]*projectTextSync\.connect\(cloud\.id\)/,
  )
  assert.match(
    tree,
    /v-if="isDesktop && !isMobile"[\s\S]*打开本地文件夹[\s\S]*v-else-if="isMobile"[\s\S]*新建项目/,
  )
  assert.match(
    tree,
    /createMobileProject\(cloud\.name, false\)[\s\S]*projectTextSync\.connect\(cloud\.id(?:, operationId)?\)[\s\S]*projectStore\.selectProject\(project\.path\)/,
  )
  assert.match(
    tree,
    /mobileProjects\.value\.find\(project => project\.name === projectStore\.projectName\.value\)[\s\S]*projectStore\.selectProject\(current\.path\)/,
  )
  assert.match(
    tree,
    /onMounted\(async \(\) => \{[\s\S]*if \(isMobile\) await refreshMobileProjects\(\)/,
  )
  assert.doesNotMatch(settings, /立即同步|projectTextSync\.syncNow/)
  assert.doesNotMatch(settings, /上传并覆盖云端|下载并覆盖本地/)
  assert.match(settings, /请在项目中心选择上传或下载/)
  assert.match(
    settings,
    /mobileRuntime = isTauriMobileRuntime\(\)[\s\S]*isTauriRuntime\(\) && !mobileRuntime/,
  )
  assert.match(settings, /:logged-in="gatewaySessionAuthenticated"/)
  assert.match(settings, /:open-url="openExternal"/)
  assert.match(settings, /mobileRuntime && gatewaySessionAuthenticated[\s\S]*退出登录/)
  assert.match(settings, /gatewayLogout\(\)/)
  assert.match(workbench, /\.memory-tree \{[^}]*inset: 0;[^}]*width: auto;/)
  assert.match(
    workbench,
    /\.memory-settings-drawer \{[^}]*top: env\(safe-area-inset-top, 0\);[^}]*right: 0;[^}]*bottom: 0;[^}]*left: 0;[^}]*width: auto;/,
  )
  assert.match(
    workbench,
    /\.memory-workbench\.preview-open \.memory-preview \{[^}]*inset: env\(safe-area-inset-top, 0\) 0 0;/,
  )
  assert.match(
    workbench,
    /\.memory-workbench\.creation-open \.memory-creation \{[^}]*inset: env\(safe-area-inset-top, 0\) 0 0;[^}]*height: auto;/,
  )
  assert.match(tree, /progressCurrent[\s\S]*只处理文字，媒体和空目录不处理/)
  assert.match(settings, /progressCurrent[\s\S]*只处理文字，媒体和空目录不处理/)
  assert.match(settings, /重新登录一次账号/)
  assert.match(main, /await initApiKey\(\)[\s\S]*await initGatewaySessionToken\(\)/)
  assert.doesNotMatch(
    settings,
    /selectedCloudProjectId|projectTextSync\.connect|projectTextSync\.enable/,
  )
})

test('iPhone account settings reuse login while hiding commercial and key controls only on mobile', () => {
  const settings = source('src/components/memory/MemorySettings.vue')
  const login = source('src/components/auth/JcCloudLoginBox.vue')

  assert.match(settings, /:account-only="mobileRuntime"/)
  assert.match(settings, /gatewayDeleteAccount\(\)/)
  assert.match(settings, /注销账号/)
  assert.match(login, /accountOnly\?: boolean/)
  assert.match(login, /v-if="!accountOnly" class="jc-login-link"[\s\S]*下载APP/)
  assert.match(login, /v-if="!accountOnly"[\s\S]*API Key/)
  assert.match(login, /v-if="!accountOnly" class="jc-login-secondary"[\s\S]*注册账号/)
  assert.match(login, /v-if="!accountOnly" class="jc-login-save"/)
  for (const page of ['privacy', 'support', 'terms']) {
    assert.match(source(`public/${page}/index.html`), /韭菜盒子/)
    assert.match(settings, new RegExp(`https://jiucaihezi\\.studio/${page}/`))
  }
})

test('memory space and conversations are created only by their explicit actions', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const project = source('src/runtime/memory/memoryProject.ts')
  const paths = source('src/utils/memoryProjectPaths.ts')

  assert.match(workbench, /inspectMemoryProject\(owner, files\)/)
  assert.match(
    workbench,
    /async function createMemorySpace\(\)[\s\S]*initializeMemoryProject\(owner, files\)/,
  )
  assert.match(
    workbench,
    /async function startNewConversation\(\)[\s\S]*createMemoryConversation\(owner, '新对话', files\)/,
  )
  assert.match(workbench, /'新建记忆空间'/)
  assert.match(workbench, /<span>新建对话<\/span>/)
  assert.doesNotMatch(project, /initializeMemoryProject[\s\S]*return conversations\[0\]/)
  for (const path of [
    '.raw',
    '.raw/jc-media',
    '文档',
    '图片',
    '视频',
    '音频',
    '对话记录',
    '.sync',
    'jc-canvas',
    'wiki',
  ]) {
    assert.match(paths, new RegExp(path.replace('.', '\\.')))
  }
  assert.match(project, /MEMORY_PROJECT_SKELETON_DIRECTORIES/)
  assert.match(project, /migrateLegacyMemoryMaterials[\s\S]*kind: 'move'[\s\S]*'keep-both'/)
  assert.match(
    project,
    /appendMemoryRound[\s\S]*return mutateConversation[\s\S]*appendConversationTurn\(appendConversationTurn/,
  )
})

test('memory file tree and model tools share the hidden and protected project contract', () => {
  const tree = source('src/components/filetree/ProjectFileTree.vue')
  const runtime = source('src/runtime/memory/memoryChat.ts')

  assert.match(tree, /isMemoryProjectHiddenPath\(path\)/)
  assert.match(tree, /isMemoryProjectMutationBlocked\(path\)/)
  assert.match(tree, /uploadPathForFile\(file, memoryMediaDirectoryFor\(file\.name, file\.type\)\)/)
  assert.doesNotMatch(tree, /ctxUploadDirectory|dev_import_project_folder/)
  assert.match(runtime, /assertMemoryProjectMutationProtected\(call, input\.projectId\)/)
  assert.match(runtime, /isMemoryProjectMutationBlocked\(path, operation\)/)
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
  assert.match(workbench, /class="memory-workbench"[\s\S]*?data-tauri-drag-region/)
  assert.match(workbench, /class="memory-title-drag" data-tauri-drag-region><\/div>/)
  assert.doesNotMatch(workbench, /memory-brand-logo/)
  assert.match(tree, /class="pft-brand-logo" src="\/logo\.svg"/)
  assert.match(
    tree,
    /class="pft-project-name pft-project-trigger"[\s\S]*projectStore\.projectName\.value/,
  )
})

test('memory messages expose one copy action and project GLB files use the shared 3D viewer', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const viewer = source('src/components/media/Model3DViewer.vue')
  const mediaViewer = source('src/components/media/MediaViewer.vue')

  assert.match(workbench, /writeClipboardText\(displayTurnContent\(turn\)\)/)
  assert.match(workbench, /class="memory-message-copy"/)
  assert.match(workbench, /copiedTurnId === turn\.id \? 'check' : 'content-copy'/)
  assert.match(
    workbench,
    /<Model3DViewer[^>]*previewResource\.mediaKind === 'model3d' && modelData[^>]*:data="modelData"/,
  )
  assert.match(
    workbench,
    /if \(resource\.mediaKind === 'model3d'\) \{\s+modelData\.value = data\.buffer/,
  )
  assert.match(mediaViewer, /<Model3DViewer[^>]*type === 'model3d'/)
  assert.match(viewer, /GLTFLoader/)
  assert.match(viewer, /OrbitControls/)
  assert.match(viewer, /frameModel/)
  assert.match(viewer, /loader\.parse\(props\.data, '', onLoad, onError\)/)
  assert.match(viewer, /\.model-viewer \{ width: 100%; max-width: 100%; height: 68vh;/)
})

test('memory opens the latest conversation and keeps message actions at the bottom', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const project = source('src/runtime/memory/memoryProject.ts')
  assert.match(workbench, /const latest = state\.conversations\.at\(-1\)/)
  assert.match(project, /conversationActivityTime\(left\) - conversationActivityTime\(right\)/)
  assert.match(workbench, /class="memory-message-actions"/)
  assert.match(workbench, /\.memory-message-actions \{ display: flex; align-items: center; justify-content: flex-end;/)
  assert.match(workbench, /loadConversationAttachmentPreviews\(resource, generation\)/)
  assert.match(workbench, /createImageBitmap\(new Blob\(\[data\.buffer\]/)
  assert.match(workbench, /URL\.revokeObjectURL\(url\)/)
})

test('memory composer starts at a three-line input height', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  assert.match(workbench, /\.memory-input-area \{ display: flex; min-height: 76px;/)
})

test('memory workbench accepts text references and uses the adaptive main composer behavior', () => {
  const tree = source('src/components/filetree/ProjectFileTree.vue')
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const runtime = source('src/runtime/memory/memoryChat.ts')

  assert.match(tree, /v-if="!ctxMenu\.node\.isDir"[\s\S]*@click="ctxReferenceInChat"/)
  assert.match(tree, /emitEvent\('reference-file', \{ resource: resourceForNode\(node\) \}\)/)
  assert.doesNotMatch(tree, /emitEvent\('reference-file', \{ name:/)
  assert.match(workbench, /:contenteditable="!sending"/)
  assert.match(
    workbench,
    /const editor = event\.currentTarget as HTMLElement[\s\S]*getPlainText\(editor\)/,
  )
  assert.match(workbench, /function resizeComposer\(\)/)
  assert.match(workbench, /<textarea[\s\S]*v-model="markdownDraft"/)
  assert.match(workbench, /files: referencedFiles\.value/)
  assert.match(runtime, /files: input\.files/)
})

test('memory composer ignores IME Enter fallback key events', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(
    workbench,
    /function handleComposerKeydown\(event: KeyboardEvent\) \{\s*if \(event\.isComposing \|\| event\.keyCode === 229\) return/,
  )
})

test('memory workbench saves Office attachments as durable project materials', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const tree = source('src/components/filetree/ProjectFileTree.vue')
  const runtime = source('src/runtime/memory/memoryChat.ts')

  assert.match(workbench, /type === 'office' \|\| type === 'pdf'/)
  assert.match(workbench, /processFile\(file, \{ maxTextLength: 20_000_000 \}\)/)
  assert.match(
    workbench,
    /files\.importText\(\{ owner, path: readablePath, content: processed\.textContent \}\)/,
  )
  assert.match(workbench, /readablePath/)
  assert.match(workbench, /characterCount: readableContent\.length/)
  assert.match(
    workbench,
    /!\['image', 'video', 'audio'\]\.includes\(type\)[\s\S]*files\.importBinary/,
  )
  assert.match(workbench, /已保存 · 已解析/)
  assert.match(workbench, /textContent: readableContent/)
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
  assert.match(
    tree,
    /while \(parts\.length\)[\s\S]*findLoadedDirectory\(parts\.join\('\/'\)\)[\s\S]*parts\.pop\(\)/,
  )
  assert.doesNotMatch(runtime, /只写了尚未执行的脚本不算完成/)
})

test('memory composer uses one workbench mode with beginner-friendly command templates', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const runtime = source('src/runtime/memory/memoryChat.ts')

  assert.doesNotMatch(workbench, /executionMode|ConversationMode/)
  assert.doesNotMatch(workbench, /memory-mode-segment|>快速<|>记忆</)
  assert.match(workbench, /const toolCommands = \[/)
  for (const label of ['@Wiki', '@Skill', '@文件', '@图文', '@影音', '@3D', '@MCP', '@Terminal'])
    assert.match(workbench, new RegExp(`label: '${label}'`))
  assert.doesNotMatch(workbench, /@Skill \+ @Wiki|@Skill \+ @MCP/)
  assert.doesNotMatch(workbench, /const commonCommands = \[/)
  assert.match(workbench, /function insertCommand\(command/)
  assert.match(workbench, /fileToolsSelected = ref\(false\)/)
  assert.match(workbench, /selectedMcpToolNames = ref<string\[\]>\(\[\]\)/)
  assert.match(workbench, /scene3dSelected = ref\(false\)/)
  assert.match(workbench, /appendMemoryRound\(active\.resource, userTurn, reply, files, title\)/)
  assert.match(
    workbench,
    /conversationTurns: editTargetId \? baseTurns : active\.transcript\.turns/,
  )
  assert.match(runtime, /messages: \[\.\.\.input\.conversationTurns, input\.userTurn\]/)
  assert.match(runtime, /onProgramStatus\?: \(status: MemoryProgramStatus\) => void/)
  assert.match(workbench, /programStatuses = ref<Record<string, MemoryProgramStatus>>/)
  assert.match(workbench, /class="memory-program-status"/)
  assert.match(workbench, /索引、双链、日志已同步并验证/)
  assert.doesNotMatch(
    runtime,
    /rawPath: string|input\.rawPath|conversationDocumentSources|historicalDocumentSources/,
  )
  assert.doesNotMatch(runtime, /memoryMode|input\.mode(?:\W|$)|快速模式/)
  assert.doesNotMatch(runtime, /tools: \[WIKI_CONTEXT_TOOL_DEFINITION\]/)
  assert.doesNotMatch(runtime, /maxModelRequests: maxMemorySteps|stopAfterSuccessfulToolNames/)
  assert.match(runtime, /maxToolRounds: 12/)
  assert.match(runtime, /finalizeAtToolRoundLimit: true/)
  assert.match(runtime, /compactToolHistory: selectedSkillNames\.length === 0/)
  assert.doesNotMatch(runtime, /WIKI_SEARCH_TOOL_DEFINITION/)
  assert.doesNotMatch(runtime, /READ_ONLY_DOCUMENT_TOOL_DEFINITIONS|快速模式只能读取/)
  assert.match(runtime, /attachments: input\.attachments/)
  assert.match(runtime, /files: input\.files/)
  assert.match(runtime, /context\.omittedMessages > 0[\s\S]*onContextTrimmed/)
  assert.match(
    workbench,
    /onContextTrimmed\(\)[\s\S]*contextNoticeShownConversations\.has\(active\.transcript\.id\)/,
  )
  assert.match(
    workbench,
    /较早的对话已退出本轮直接上下文，但仍完整保存在 Raw 中。[\s\S]*长期保留的结论请写入 Wiki/,
  )
  assert.match(runtime, /不得查找 Raw 对话记录补充当前任务/)
  assert.match(workbench, /async function addAttachmentFiles\(selected: File\[\]\) \{/)
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
  assert.match(
    workbench,
    /parseMediaPlans\(turn\.content\)\s*\.map\(plan => resolveMediaPlanReferences\(plan, mediaContext\)\)/,
  )
  assert.match(
    workbench,
    /onEvent\('media-reference:add', payload => void addProjectMediaReferences\(payload\)\)/,
  )
  assert.match(workbench, /fileActions\.readMedia\(resource\)/)
  assert.match(workbench, /attachment\.resourcePath === resource\.path/)
  assert.match(workbench, /resourcePath: resource\.path/)
  assert.match(workbench, /v-for="\(plan, planIndex\) in mediaPlans\[turn\.id\]"/)
  assert.match(
    workbench,
    /const loadCreationPanel = \(\) => import\('@\/components\/creation\/CreationPanel\.vue'\)/,
  )
  assert.match(workbench, /const CreationPanel = defineAsyncComponent\(loadCreationPanel\)/)
  assert.match(workbench, /emitEvent\('memory-media-plan-load'/)
  assert.match(workbench, /class="memory-creation"/)
  assert.doesNotMatch(workbench, /import MediaPlanCard/)
  assert.doesNotMatch(workbench, /<MediaPlanCard/)
  assert.match(
    workbench,
    /mediaPlans\.value\[turn\.id\]\?\.length \? stripMediaPlanBlocks\(content\) : content/,
  )
})

test('memory composer reads the native clipboard only for an empty Desktop image paste', () => {
  assert.equal(shouldReadNativeClipboardImage(0, '', true, false), true)
  assert.equal(shouldReadNativeClipboardImage(1, '', true, false), false)
  assert.equal(shouldReadNativeClipboardImage(0, 'text', true, false), false)
  assert.equal(shouldReadNativeClipboardImage(0, '', false, false), false)
  assert.equal(shouldReadNativeClipboardImage(0, '', true, true), false)
})

test('memory mode keeps explicit Skill and Wiki connections', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const runtime = source('src/runtime/memory/memoryChat.ts')

  assert.doesNotMatch(workbench, /SkillPickerBar/)
  assert.match(workbench, /agentStore\.getCustomSkills\(\)/)
  assert.match(workbench, /files\.searchPaths\(owner, query\.trim\(\), 40\)/)
  assert.match(workbench, /const selectedSkillNames = ref<string\[\]>\(\[\]\)/)
  assert.match(workbench, /getCursorPosition\(editor\)/)
  assert.match(
    workbench,
    /input\.value\.slice\(0, cursorPos \|\| input\.value\.length\)\.match\(\/@\(\\S\*\)\$\/\)/,
  )
  assert.match(workbench, /v-show="mentionOpen && !sending"/)
  assert.match(workbench, /addProjectFileReference\(option\.resource\)/)
  assert.match(workbench, /resource\.kind !== 'binary' \|\| isOfficeResource\(resource\)/)
  assert.match(workbench, /selectedSkillNames: selectedSkillNames\.value/)
  assert.match(workbench, /const wikiSelected = ref\(false\)/)
  assert.match(workbench, /wikiSelected: wikiSelected\.value/)
  assert.match(runtime, /selectMemoryTools\(\n\s*allMemoryToolDefinitions/)
  assert.doesNotMatch(runtime, /const explicitWiki =/)
  assert.doesNotMatch(runtime, /REQUIRED_SKILL|loadedRequiredSkill|queriedWiki|每次回复必须先调用/)
  assert.doesNotMatch(runtime, /customSkill\?\.skillContent\.trim\(\)/)
  assert.doesNotMatch(runtime, /selectedSkillNames\.map\(\(name, index\)/)
  assert.match(runtime, /buildSelectedSkillPrompt\(/)
  assert.match(runtime, /selectedSkillPrompt \|\| buildWebSkillCatalogPrompt\(catalog\)/)
  assert.match(runtime, /buildMemoryDesktopToolDefinitions\(\)/)
  assert.match(runtime, /buildMemoryWebProjectToolDefinitions\(\)/)
})

test('memory composer does not expose removed Jina web tools', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const runtime = source('src/runtime/memory/memoryChat.ts')

  assert.doesNotMatch(workbench, /webSearchEnabled|type: 'search'|web_search|read_url/)
  assert.doesNotMatch(
    runtime,
    /webSearchEnabled|WEB_SEARCH_TOOL_DEFINITION|READ_URL_TOOL_DEFINITION|web_search|read_url|Jina/,
  )
})

test('memory topbar uses a grouped model popover and an adaptive new conversation action', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(workbench, /class="new-conversation-button"[\s\S]*<span>新建对话<\/span>/)
  assert.match(
    workbench,
    /memory-conversation-picker[\s\S]*new-conversation-button[\s\S]*memory-title-drag[\s\S]*memory-topbar-actions/,
  )
  assert.match(workbench, /<JcIcon name="add" class="memory-new-conversation-icon" \/>/)
  assert.doesNotMatch(workbench, /<select v-model="agentStore\.currentModel"/)
  assert.match(workbench, /const modelGroups = computed/)
  assert.match(workbench, /Claude[\s\S]*GPT \/ OpenAI[\s\S]*Gemini \/ Google/)
  assert.match(
    workbench,
    /agentStore\.textModels\.filter\(model => !isInternalMediaModel\(model\.id\)\)/,
  )
  assert.match(workbench, /id === 'jina-search' \|\| id === 'jina-reader'/)
  assert.doesNotMatch(workbench, /runninghub: 'RunningHub'/)
  assert.match(workbench, /class="memory-model-menu" role="listbox"/)
  assert.match(workbench, /\.memory-model-menu \{[\s\S]*left: 0;/)
  assert.match(workbench, /role="option" :aria-selected="isSelectedModel\(model\)"/)
  assert.match(workbench, /agentStore\.setModel\(model\.id, model\.providerId\)/)
})

test('memory message copy stays compact and copies the original markdown', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(workbench, /writeClipboardText\(displayTurnContent\(turn\)\)/)
  assert.match(
    workbench,
    /\.memory-message-copy \{ display: flex; width: 26px; height: 26px;/,
  )
})

test('markdown editor keeps pre and textarea under the shared stylesheet', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const markdownCss = source('src/styles/markdown.css')

  assert.doesNotMatch(workbench, /\.memory-document pre\s*\{/)
  assert.match(
    markdownCss,
    /\.memory-markdown-editor pre,\s*\n\.memory-markdown-editor textarea\s*\{[\s\S]*font: \.92em\/1\.6/,
  )
  assert.match(markdownCss, /\.memory-markdown-editor pre \* \{ font: inherit; \}/)
  assert.match(markdownCss, /\.memory-markdown-editor textarea \{[\s\S]*border: 0;/)
})

test('memory document and file tree keep independent visible scrolling', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const tree = source('src/components/filetree/ProjectFileTree.vue')

  assert.match(workbench, /\.memory-tree \{[\s\S]*min-height: 0;[\s\S]*overflow: hidden;/)
  assert.match(
    workbench,
    /\.memory-document \{[\s\S]*height: 100%;[\s\S]*overflow-y: scroll;[\s\S]*scrollbar-gutter: stable;/,
  )
  assert.match(
    tree,
    /\.pft-list \{[\s\S]*min-height: 0;[\s\S]*overflow-y: scroll;[\s\S]*scrollbar-gutter: stable;/,
  )
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
  assert.doesNotMatch(
    bubble,
    /watch\(projectResource|projectMediaUrl|URL\.createObjectURL|URL\.revokeObjectURL/,
  )
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
  assert.match(workbench, /:streaming="turn\.id === 'streaming-assistant'"/)
  assert.match(workbench, /watch\(streamingText,[\s\S]*scheduleAutoScrollIfNeeded\(\)/)
  assert.match(
    workbench,
    /const complete = editTargetId[\s\S]*appendMemoryRound\(active\.resource, userTurn, reply, files, title\)[\s\S]*const completeResource = await openProjectResource[\s\S]*opened\.value = completeResource\s*\n\s*streamingText\.value = ''/,
  )
  assert.match(workbench, /pendingUserTurn\.value = userTurn/)
  assert.match(workbench, /await nextTick\(\)[\s\S]*startStickyFollow\(\)/)
  assert.match(workbench, /\.memory-messages \{[^}]*overflow-y: scroll;/)
  assert.match(workbench, /\.memory-message \{[^}]*content-visibility: auto;/)
  assert.doesNotMatch(workbench, /\.memory-message \{[^}]*contain-intrinsic-size/)
  assert.match(scrollNav, /querySelectorAll\('\.msg, \.memory-message'\)/)
  assert.doesNotMatch(
    workbench,
    /useVirtualizer|estimateSize|measureElement|getTotalSize|translateY\(/,
  )
  assert.doesNotMatch(
    workbench,
    /\.memory-message-list > \.memory-message \{[^}]*position: absolute/,
  )
})

test('memory run status follows real tool start and end events without entering Raw', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const runtime = source('src/runtime/memory/memoryChat.ts')

  assert.match(runtime, /onToolEvent\?: \(event: DirectToolExecutionEvent\) => void/)
  assert.equal((runtime.match(/input\.onToolEvent\?\.\(event\)/g) || []).length, 1)
  assert.doesNotMatch(runtime, /event\.type === 'tool_execution_start'\) input\.onToolEvent/)
  assert.match(
    workbench,
    /event\.type === 'tool_execution_start'[\s\S]*status\.value = `正在\$\{label\}`/,
  )
  assert.match(
    workbench,
    /event\.status === 'succeeded' \? 'done' : 'failed'[\s\S]*runSteps\.value\.find\(item => item\.state === 'running'\)[\s\S]*正在等待模型继续处理/,
  )
  assert.match(workbench, /v-if="runVisible" class="memory-run-status"/)
  assert.match(workbench, /v-for="step in visibleRunSteps"/)
  assert.match(workbench, /\(sending \|\| error\) && visibleRunSteps\.length/)
  assert.match(workbench, /formatRunElapsed\(runElapsed\)/)
  assert.match(workbench, /onMetrics\(metrics\)[\s\S]*runMetrics\.value = metrics/)
  assert.match(workbench, /formatRunMetrics\(runMetrics\)/)
  assert.doesNotMatch(workbench, /opencodeClient|openCodeSyncStore|AgentStatusBar/)
})

test('memory retries transient requests and writes one Raw recovery point only after exhaustion', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const runtime = source('src/runtime/memory/memoryChat.ts')

  assert.match(runtime, /sendDirectRequestWithRetry\(/)
  assert.match(runtime, /onRetry\?: \(attempt: number, total: number\) => void/)
  assert.match(workbench, /onRetry\(attempt, total\)[\s\S]*正在重连 \$\{attempt\}\/\$\{total\}/)
  assert.match(
    workbench,
    /replyCompleted = true[\s\S]*if \(!replyCompleted && isRecoverableDirectTransportFailure\(cause\)\)/,
  )
  assert.match(
    workbench,
    /appendMemoryRound\([\s\S]*继续前请先检查项目现状，避免重复写入或外部操作。/,
  )
  assert.match(
    workbench,
    /if \(runGeneration !== memoryRunGeneration\) return\s*\n\s*const interrupted = await appendMemoryRound[\s\S]*if \(runGeneration !== memoryRunGeneration\) return/,
  )
  assert.match(
    workbench,
    /const aborted = cause instanceof DOMException && cause\.name === 'AbortError'[\s\S]*if \(aborted\) status\.value = '已停止'/,
  )
  assert.match(workbench, /:contenteditable="!sending"/)
  assert.match(workbench, /title="添加附件" :disabled="sending"/)
  assert.match(workbench, /title="移除附件" :disabled="sending"/)
})

test('memory cancellation settles the visible run before invalidating stale callbacks', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(
    workbench,
    /function stop\(\) \{\s*status\.value = '已停止'\s*stopRunTimer\(\)\s*memoryRunGeneration\+\+[\s\S]*abortController\?\.abort\(\)/,
  )
})

test('memory ignores stale streaming callbacks and stale resource loads', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(workbench, /const isCurrentRun = \(\) => runGeneration === memoryRunGeneration/)
  assert.match(workbench, /onRetry\(attempt, total\) \{\s*if \(!isCurrentRun\(\)\) return/)
  assert.match(workbench, /onText\(text\) \{\s*if \(!isCurrentRun\(\)\) return/)
  assert.match(
    workbench,
    /onToolEvent: event => \{\s*if \(isCurrentRun\(\)\) updateRunTool\(event\)/,
  )
  assert.match(workbench, /let resourceOpenGeneration = 0/)
  assert.match(
    workbench,
    /const generation = \+\+resourceOpenGeneration[\s\S]*if \(generation !== resourceOpenGeneration\) return/,
  )
  assert.match(workbench, /let conversationSelectionGeneration = 0/)
})

test('model catalog coalesces concurrent refreshes', () => {
  const store = source('src/stores/agentStore.ts')

  assert.match(store, /let modelsFetchPromise: Promise<void> \| null = null/)
  assert.match(store, /modelsFetchPromise \|\|= fetchModelsOnce\(\)\.finally/)
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
  assert.match(
    settings,
    /<footer class="memory-settings-version">版本 \{\{ appVersion \}\}<\/footer>/,
  )
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
    assert.match(tree, new RegExp(`safePrompt\\('${label}[\\s\\S]*?forceDom: true`))
  }
  assert.match(tree, /class="pft memory-mode"/)
  assert.match(tree, /\.pft\.memory-mode \.pft-head[\s\S]*border-bottom-color: var\(--line\)/)
  assert.match(workbench, /--memory-header-height: 52px/)
  assert.match(tree, /\.pft\.memory-mode \.pft-head \{[\s\S]*height: var\(--memory-header-height\)/)
  assert.match(tree, /\.pft-brand-logo \{[\s\S]*transform: translateY\(3px\)/)
  assert.match(tree, /\.pft-memory-actions \{[\s\S]*height: 34px/)
  assert.match(workbench, /\.memory-workbench\.desktop-runtime \{ padding-top: 28px/)
  assert.match(workbench, /grid-template-rows: var\(--memory-header-height\)/)
})

test('memory creation surface reuses the chat dock resize, host preview, and sticky scrolling', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const creation = source('src/components/creation/CreationPanel.vue')
  const tree = source('src/components/filetree/ProjectFileTree.vue')

  assert.match(
    workbench,
    /async function openCreationHost\(\) \{[\s\S]*?await loadCreationPanel\(\)[\s\S]*?creationMounted\.value = true[\s\S]*?creationOpen\.value = true/,
  )
  assert.match(
    workbench,
    /async function openMediaPlanInCreation[\s\S]*?await openCreationHost\(\)[\s\S]*?emitEvent\('memory-media-plan-load'/,
  )
  assert.match(
    workbench,
    /\.memory-composer \{ min-width: 0; width: calc\(100% - 28px\); max-width: 860px;/,
  )
  assert.match(
    workbench,
    /\.memory-main \{ position: relative; display: grid; grid-template-columns: minmax\(0, 1fr\);/,
  )
  assert.match(workbench, /@pointerdown\.prevent="startChatDockResize"/)
  assert.match(workbench, /<ChatScrollNav/)
  assert.doesNotMatch(workbench, /preview-surface/)
  assert.match(workbench, /@preview-resource="previewProjectResource"/)
  assert.match(workbench, /#toolbar-actions/)
  assert.match(
    workbench,
    /:title="creationFocused \? '\u9000\u51fa\u4e13\u6ce8\u521b\u4f5c' : '\u4e13\u6ce8\u521b\u4f5c'"/,
  )
  assert.match(workbench, /title="\u6536\u8d77\u521b\u4f5c\u9762\u677f"/)
  assert.match(creation, /defineExpose\(\{ flushCanvasSave: \(\) => flushCanvasSave\(true\) \}\)/)
  assert.match(workbench, /ref<\{ flushCanvasSave\?: \(\) => Promise<void> \} \| null>/)
  assert.match(workbench, /await creationPanelRef\.value\?\.flushCanvasSave\?\.\(\)/)
  assert.doesNotMatch(workbench, /creationPanelRef\.value\?\.flushCanvasSave\(\)/)
  assert.match(workbench, /creationMounted\.value = false/)
  assert.doesNotMatch(workbench, /v-show="creationOpen"/)
  assert.match(workbench, /@click="closeCreationHost"/)
  assert.match(
    workbench,
    /\.memory-workbench\.creation-open \.memory-title-drag \{ min-width: 0; \}/,
  )
  assert.match(
    workbench,
    /function resizeCreationForWindow\(\) \{[\s\S]*?prepareDockLayout\(\)[\s\S]*?clampChatDockWidth\(chatDockWidth\.value\)\s*\}/,
  )
  assert.match(
    workbench,
    /@media \(max-width: 939px\) \{[\s\S]*\.memory-workbench\.creation-open \{ grid-template-columns: 280px minmax\(0, 1fr\); \}[\s\S]*\.memory-creation \{ position: fixed;/,
  )
  assert.match(workbench, /desktopOnlyRuntime && turn\.role === 'assistant'/)
  assert.match(
    tree,
    /\(isDesktop && !isMobile\) \|\| !path\.toLowerCase\(\)\.endsWith\('\.jcscene'\)/,
  )
  assert.match(creation, /<slot name="toolbar-actions"/)
  assert.match(creation, />\u63d0\u793a\u8bcd\u53c2\u8003</)
  assert.doesNotMatch(creation, /title="\u65b0\u5efa\u9879\u76ee\u6587\u6863"/)
})

test('single-product UI contains no dormant Studio mode switches or editor session runtime', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const tree = source('src/components/filetree/ProjectFileTree.vue')
  const creation = source('src/components/creation/CreationPanel.vue')
  const bubble = source('src/components/chat/MediaTaskBubble.vue')
  const scroll = source('src/components/chat/ChatScrollNav.vue')
  const attachments = source('src/runtime/direct/newApiAttachments.ts')

  assert.doesNotMatch(workbench, /\smemory-mode(?:\s|\/?>)|preview-surface|workbench-mode/)
  assert.doesNotMatch(tree, /memoryMode|open-in-editor|editor-file-changed|project:new-document/)
  assert.doesNotMatch(creation, /previewSurface/)
  assert.doesNotMatch(
    bubble,
    /workbenchMode|sendToGallery|sendAsReference|send-to-gallery|import-to-creation/,
  )
  assert.doesNotMatch(scroll, /messages\?:/)
  assert.doesNotMatch(attachments, /shouldClearCreativeAttachments/)
  assert.equal(
    existsSync(join(process.cwd(), 'src/components/editor/editorSessionStore.ts')),
    false,
  )
  assert.equal(
    existsSync(join(process.cwd(), 'src/components/editor/__tests__/editorSessionStore.test.ts')),
    false,
  )
  assert.equal(existsSync(join(process.cwd(), 'src/types/mention.ts')), false)
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
  assert.match(
    workbench,
    /\.memory-workbench\.tree-closed \{ grid-template-columns: 0 minmax\(0, 1fr\); \}/,
  )
  assert.match(
    workbench,
    /\.memory-workbench\.tree-closed \.memory-tree \{ overflow: hidden; border-right: 0; \}/,
  )
})

test('3D scene editor clones plain scene data instead of Vue proxies', () => {
  const editor = source('src/components/memory/Scene3DEditor.vue')

  assert.match(editor, /let document = parseScene3DDocument\(props\.document\)/)
  assert.match(editor, /document = parseScene3DDocument\(value\)/)
  assert.match(editor, /sizeAttenuation: false/)
  assert.doesNotMatch(editor, /depthTest: false/)
  assert.match(editor, /camera\('全景'/)
  assert.match(editor, /camera\(`\$\{secondName\}近景`/)
  assert.match(editor, /person\.add\(body, head, leftArm, rightArm, leftLeg, rightLeg, direction\)/)
  assert.match(editor, /if \(pose === 'lying'\)/)
})

test('3D scene editor records manual camera movement without requiring a timeline', () => {
  const editor = source('src/components/memory/Scene3DEditor.vue')
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(editor, /const manualRecording = ref\(false\)/)
  assert.match(editor, /canvas\.value\.captureStream\(30\)/)
  assert.match(editor, /emit\('video', blob, `\$\{document\.title\}-手动运镜`\)/)
  assert.match(editor, /title="开始手动运镜录制"/)
  assert.match(editor, /title="停止并保存录制"/)
  assert.match(editor, /function removeSelectedWithKeyboard/)
  assert.match(editor, /window\.addEventListener\('keydown', removeSelectedWithKeyboard\)/)
  assert.match(editor, /title="删除选中物体（Delete）"/)
  assert.match(editor, /function undo\(\)/)
  assert.match(editor, /function redo\(\)/)
  assert.match(editor, /function copySelection\(\)/)
  assert.match(editor, /function pasteSelection\(\)/)
  assert.match(editor, /title="撤销 Cmd\/Ctrl\+Z"/)
  assert.match(editor, /title="复制选中物体 Cmd\/Ctrl\+C"/)
  assert.match(editor, /function updateSelectedLabel\(label: string\)/)
  assert.match(editor, /function updateSelectedColor\(color: string\)/)
  assert.match(editor, /@contextmenu\.prevent="openContextMenu"/)
  assert.match(editor, /删除显示文字/)
  assert.match(editor, /成年男性/)
  assert.doesNotMatch(editor, /function startManualRecording[\s\S]{0,500}document\.timeline/)
  assert.match(workbench, /@video="saveSceneVideo"/)
  assert.match(workbench, /'dev_export_scene_video'/)
  assert.match(workbench, /'dev_check_ffmpeg'/)
})

test('3D scene editor safely switches and loads Storyboarder characters', () => {
  const editor = source('src/components/memory/Scene3DEditor.vue')
  const assets = source('src/runtime/memory/storyboarderAssets.ts')

  assert.match(
    editor,
    /function setCharacterModel[\s\S]{0,300}delete item\.character\.bones[\s\S]{0,200}buildScene\(\)/,
  )
  assert.match(editor, /const characterLoading = ref\(0\)/)
  assert.match(editor, /const characterLoadError = ref\(''\)/)
  assert.match(editor, /characterLoading\.value\+\+/)
  assert.match(editor, /characterLoading\.value--/)
  assert.match(editor, /v-if="characterLoadError"[^>]*>\{\{ characterLoadError \}\}/)
  assert.match(editor, /:disabled="characterLoading > 0 \|\| Boolean\(characterLoadError\)"/)
  assert.match(editor, /cloneSkeleton\(template\)/)
  assert.match(
    editor,
    /const node = makePrimitive\(item\)[\s\S]{0,900}hydrateCharacter\(node, item, token\)/,
  )
  assert.match(assets, /import poses from '@\/assets\/storyboarder\/poses\.json'/)
  assert.match(assets, /import handPoses from '@\/assets\/storyboarder\/hand-poses\.json'/)
})

test('3D scene editor releases rebuilt scenes and keeps bone selection stable', () => {
  const editor = source('src/components/memory/Scene3DEditor.vue')

  assert.match(editor, /if \(root\) \{ scene\.remove\(root\); disposeObject\(root\) \}/)
  assert.match(editor, /storyboarderSharedResource/)
  assert.match(editor, /disposeObject\(root\)/)
  assert.match(
    editor,
    /ignoreScenePick = true[\s\S]{0,300}queueMicrotask\(\(\) => \{ ignoreScenePick = false \}\)/,
  )
  assert.match(editor, /if \(manualRecording\.value \|\| ignoreScenePick \|\|/)
  assert.match(editor, /class="scene3d-inspector"/)
  assert.match(editor, /class="scene3d-lighting"/)
  assert.match(editor, /'cross arms': '抱臂'/)
  assert.match(editor, /Peace: '耶'/)
  assert.match(editor, /<summary>关节<\/summary>/)
  assert.doesNotMatch(editor, />W<\/button>|>S<\/button>|>T<\/button>/)
})

test('3D scene preview sends edits with the current path and refreshes after completion', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(workbench, /if \(resource\.type === 'scene3d' && !desktopOnlyRuntime\) return/)
  assert.match(workbench, /defineAsyncComponent\(\(\) => import\('\.\/Scene3DEditor\.vue'\)\)/)
  assert.match(workbench, /const sceneInstruction = ref\(''\)/)
  assert.match(workbench, /files\.searchPaths\(owner, path, 20\)/)
  assert.match(workbench, /白膜场景打开失败：/)
  assert.match(workbench, /当前打开的 3D 场景路径是：\$\{current\.resource\.path\}/)
  assert.match(workbench, /data-placeholder="直接说怎么修改当前场景"/)
  assert.match(workbench, /await refreshOpenScene\(current\.resource\.path\)/)
  assert.match(workbench, /class="memory-scene-composer"/)
})

test('Desktop starts the memory workbench without the legacy OpenCode workspace', () => {
  const app = source('src/App.vue')
  const vite = source('vite.config.ts')
  const desktop = source('src-tauri/src/lib.rs')

  assert.match(app, /<MemoryWorkbench \/>/)
  assert.doesNotMatch(app, /WorkspaceLayout|useOpenCodeSyncStore|projectStoredNewApiForOpenCode/)
  assert.match(vite, /'@app-root': resolve\(__dirname, 'src\/App\.vue'\)/)
  assert.doesNotMatch(vite, /StudioApp|mode === 'studio'/)
  assert.match(desktop, /app\.config\(\)\.build\.dev_url/)
  assert.match(desktop, /"http:\/\/localhost:1420"\.parse\(\)/)
  assert.match(
    desktop,
    /#\[cfg\(all\(debug_assertions, not\(mobile\)\)\)\][\s\S]{0,300}"http:\/\/localhost:1420"/,
  )
  assert.doesNotMatch(desktop, /#\[cfg\(dev\)\]/)
  assert.match(desktop, /window_config\.url = tauri::WebviewUrl::External\(dev_url\)/)
})

test('memory workbench follows the current project owner on both runtimes', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(
    workbench,
    /const projectOwner = computed\(\(\) => desktopRuntime[\s\S]*projectStore\.projectDir\.value[\s\S]*projectStore\.webProjectId\.value/,
  )
  assert.match(
    workbench,
    /watch\(projectOwner, owner => void openProject\(owner\), \{ immediate: true \}\)/,
  )
  assert.match(workbench, /inspectMemoryProject\(owner, files\)/)
  assert.match(
    workbench,
    /memoryReady\.value = state\.initialized[\s\S]*void projectTextSync\.open/,
  )
  assert.match(
    workbench,
    /initializeMemoryProject\(owner, files\)[\s\S]*memoryReady\.value = true[\s\S]*void projectTextSync\.open/,
  )
  assert.doesNotMatch(workbench, /syncOnFocus|addEventListener\('focus'/)
  assert.doesNotMatch(workbench, /projectTextSync\.open\([\s\S]{0,180}projectTextSync\.enable\(\)/)
})

test('memory text models default to tools unless the gateway explicitly disables them', () => {
  const store = source('src/stores/agentStore.ts')
  const runtime = source('src/runtime/memory/memoryChat.ts')

  assert.match(
    store,
    /toolCall: capability === 'text' && item\.tool_call !== false && item\.toolCall !== false/,
  )
  assert.match(
    runtime,
    /explicitCapabilitySelected && agentStore\.modelsFetched && model\?\.toolCall === false/,
  )
})

test('memory file actions stay inside the memory resource route on Desktop', () => {
  const tree = source('src/components/filetree/ProjectFileTree.vue')

  assert.match(
    tree,
    /const result = await openProjectResource\(projectFiles, resource\)\s*emitEvent\('memory:open-resource', result\)/,
  )
  assert.match(tree, /createText\(projectKey\.value, relPath, ''\)[\s\S]*memory:open-resource/)
  assert.match(tree, /v-if="isDesktop"[\s\S]*用系统默认应用打开/)
})

test('memory navigation separates Raw conversations from project files and transient previews', () => {
  const tree = source('src/components/filetree/ProjectFileTree.vue')
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const paths = source('src/utils/memoryProjectPaths.ts')

  assert.match(paths, /MEMORY_SYNC_DIRECTORY = '\.raw\/\.sync'/)
  assert.match(paths, /MEMORY_CONVERSATION_DIRECTORY = '\.raw\/对话记录'/)
  assert.match(paths, /MEMORY_CANVAS_DIRECTORY = 'jc-canvas'/)
  assert.match(tree, /isMemoryProjectHiddenPath\(path\)/)
  assert.match(tree, /isProtectedMemoryPath[\s\S]*isMemoryProjectMutationBlocked\(path\)/)
  assert.match(workbench, /const conversations = ref<MemoryConversation\[\]>\(\[\]\)/)
  assert.match(workbench, /class="memory-conversation-trigger"/)
  assert.match(workbench, /filteredConversations/)
  assert.match(workbench, /renameMemoryConversation\(item\.resource, nextTitle, files\)/)
  assert.match(workbench, /files\.planBatch\(\{ kind: 'delete', resources: \[item\.resource\] \}\)/)
  assert.match(workbench, /files\.executeBatch\(plan\)/)
  assert.match(workbench, /const previewResource = ref<ProjectResourceOpenResult \| null>\(null\)/)
  assert.match(workbench, /releaseMediaUrl\(\)\s*previewResource\.value = resource/)
  assert.match(workbench, /projectMapReturn \? '返回项目地图' : '返回对话'/)
  assert.match(workbench, /event\.key === 'Escape' && previewResource\.value/)
  assert.match(workbench, /resource\.type === 'canvas'[\s\S]{0,160}openCreationHost\(\)/)
  assert.doesNotMatch(
    workbench,
    /previewResource\.value = resource[\s\S]{0,100}opened\.value = resource/,
  )
})

test('global search opens current Raw conversations through the memory resource route', () => {
  const search = source('src/components/search/GlobalSearch.vue')

  assert.match(search, /inspectMemoryProject\(projectOwner\.value, files\)/)
  assert.match(search, /openProjectResource\(files, item\.resource\)/)
  assert.match(search, /emitEvent\('memory:open-resource', resource\)/)
  assert.match(search, /\(e\.metaKey \|\| e\.ctrlKey\) && e\.key === 'k'/)
  assert.doesNotMatch(
    search,
    /useSessionStore|projectSessions|switchSession|emitEvent\('switch-panel', 'chat'\)/,
  )
})

test('memory files and conversation turns use the shared safe Markdown renderer', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const renderer = source('src/components/memory/MemoryMarkdown.vue')

  assert.match(workbench, /<MemoryMarkdown/)
  assert.match(renderer, /renderMessageMarkdown\(renderWikiLinks\(props\.content\), 'assistant'\)/)
  assert.match(renderer, /renderStreamingText\(props\.content\)/)
  assert.match(renderer, /renderMermaidBlocks\(base,/)
  assert.match(renderer, /querySelectorAll<HTMLElement>\('h1,h2,h3'\)/)
  assert.match(renderer, /window\.innerWidth > 760/)
  assert.doesNotMatch(workbench, /<pre>\{\{ previewResource\.text\.content \}\}<\/pre>/)
})

test('memory project maps stay separate from the creation canvas and preserve return navigation', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const viewer = source('src/components/memory/ProjectMapViewer.vue')

  assert.match(workbench, /previewResource\.type === 'project-map'/)
  assert.match(workbench, /serializeJsonCanvas\(next\)/)
  assert.match(workbench, /projectMapReturn\.value = \{ resource: current, viewport \}/)
  assert.doesNotMatch(viewer, /CreationPanel|CanvasDocumentV3|\.jccanvas/)
  assert.match(viewer, /emit\('save', structuredClone\(document\.value\)\)/)
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
  assert.match(
    workbench,
    /files\.writeText\(current\.resource, markdownDraft\.value, current\.text\.revision\)/,
  )
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
  const mlxRuntime = source('src/utils/localMlxRuntime.ts')
  const store = source('src/stores/agentStore.ts')

  assert.match(settings, /connectLocalOllama/)
  assert.match(settings, /getLocalOllamaModels/)
  assert.match(settings, /connectLocalMlx/)
  assert.match(settings, /startLocalMlx/)
  assert.match(settings, /v-model="localMlxApiBase"/)
  assert.match(settings, /v-model="localMlxModelPath"/)
  assert.match(settings, /启动并连接/)
  assert.match(settings, /placeholder="http:\/\/127\.0\.0\.1:8081"/)
  assert.match(settings, /本机 MLX/)
  assert.match(mlxRuntime, /fetcher: typeof fetch = safeFetch/)
  assert.match(
    store,
    /x\.id === modelId && x\.providerId === \(explicitProviderId \|\| storedProviderId\)/,
  )
  assert.match(settings, /agentStore\.refreshLocalModels\(\)/)
  assert.match(settings, /v-if="desktopRuntime" class="memory-local-model"/)
  assert.match(settings, /v-if="desktopRuntime" :class="\{ active: tab === 'skills' \}"/)
  assert.match(settings, /v-if="desktopRuntime" :class="\{ active: tab === 'mcp' \}"/)
  assert.match(
    runtime,
    /recordSceneVideo: input\.recordSceneVideo[\s\S]{0,120}document => input\.recordSceneVideo!\(document, input\.signal\)[\s\S]{0,40}: undefined/,
  )
  assert.match(runtime, /platform: isTauriRuntime\(\) \? 'desktop' : 'web'/)
  assert.doesNotMatch(runtime, /forceCloud: true/)
})

test('aggregate MCP mentions remain searchable by their internal tool prefix', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(workbench, /filterKeys: \['id', 'display', 'description'\]/)
  assert.match(workbench, /mentionOnInput\('mcp__'\)/)
})

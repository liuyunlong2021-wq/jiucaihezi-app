import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { shouldReadNativeClipboardImage } from '@/utils/clipboard'

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

test('@DH is a desktop runtime that accepts selected Skills and bypasses legacy execution', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  assert.match(workbench, /id: 'dh', label: '@DH'/)
  assert.match(workbench, /function selectDeepSeekHarness\(\)/)
  assert.match(workbench, /dhSnapshot\s*\?\s*await runDeepSeekHarness/)
  assert.match(workbench, /sessionId: active\.transcript\.id/)
  assert.match(workbench, /cwd: active\.resource\.owner/)
  assert.match(workbench, /if \(run\.runtime === 'dh'\) void stopDeepSeekHarness\(\)/)
  assert.match(workbench, /deepSeekHandoffTurns\(baseTurns\)/)
  assert.match(workbench, /ids\.push\('dh', DEEPSEEK_HARNESS_SESSION_MARKER\)/)
  assert.match(workbench, /maxHistoryRounds: Number\.MAX_SAFE_INTEGER/)
  assert.match(workbench, /message: deepSeekPrompt\(userTurn\.content, skillSnapshot, dhHandoffTurns\)/)
  assert.match(workbench, /runDeepSeekHarness\(\{[\s\S]*?attachments: requestAttachments/)
  assert.match(workbench, /runDeepSeekHarness\(\{[\s\S]*?onProgress\(progress\)[\s\S]*?run\.steps\.push/)
  assert.doesNotMatch(workbench, /const skillSnapshot = dhSnapshot \? \[\]/)
  assert.doesNotMatch(workbench, /function selectDeepSeekHarness\(\)[\s\S]{0,400}selectedSkillNames\.value = \[\]/)
})

test('@DH executor composes with the @文件 full-access capability in either click order', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const selectDh = workbench.match(/function selectDeepSeekHarness\(\) \{([\s\S]*?)\n\}/)?.[1] || ''
  const enableTool = workbench.match(/function enableTool\(id: string\) \{([\s\S]*?)\n\}/)?.[1] || ''
  const restoreTools = workbench.match(/function applyToolChipIds\(ids\?: string\[\]\) \{([\s\S]*?)\n\}/)?.[1] || ''
  assert.doesNotMatch(selectDh, /fileToolsSelected\.value = false/)
  assert.doesNotMatch(enableTool, /dhSelected\.value = false\s*\n\s*if \(id === 'file'\)/)
  assert.match(restoreTools, /dhSelected\.value = next\.has\('dh'\)/)
  assert.match(restoreTools, /fileToolsSelected\.value = next\.has\('file'\)/)
  assert.match(workbench, /runDeepSeekHarness\(\{[\s\S]*?fileAccessEnabled: fileToolsSelected\.value/)
})

test('image and video attachments display their project paths while models receive the saved original', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  assert.match(workbench, /attachment\.previewUrl = await createProjectMediaPreview\(resource\)/)
  assert.match(workbench, /:src="file\.previewUrl \|\| file\.value"/)
  assert.match(workbench, /file\.kind !== 'image' && file\.kind !== 'video'/)
  assert.match(workbench, /<video v-else-if="file\.kind === 'video'/)
  assert.match(workbench, /attachment\.previewUrl \|\| attachment\.value/)
  assert.match(workbench, /const binary = await files\.readBinary\(resource\)/)
  assert.match(workbench, /function revokeAttachmentPreview/)
  assert.doesNotMatch(workbench, /createImageThumbnail|canvas\.toBlob/)
  assert.match(workbench, /detectImageMimeFromBytes\(data\)/)
  assert.match(workbench, /detectImageMimeFromBytes\(new Uint8Array\(await file\.slice\(0, 16\)\.arrayBuffer\(\)\)\)/)
  assert.doesNotMatch(workbench, /DeepSeek Harness 正在执行/)
})

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
  // 媒体区行高必须显式 1fr，否则 max-height: 100% 失效，竖屏视频会溢出容器并偏到下方
  assert.match(
    workbench,
    /\.memory-media \{ display: grid; grid-template-rows: minmax\(0, 1fr\); min-height: 0; padding: 20px; place-items: center; overflow: hidden; \}/,
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

test('skill edit requests select Skill Creator and prefill the Skill ID and path', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  assert.match(workbench, /onEvent\('skill-creator-edit'/)
  assert.match(workbench, /skillId\?: unknown/)
  assert.match(workbench, /Skill 目录：\\n/)
  assert.match(workbench, /fileToolsSelected\.value = true/)
  assert.match(workbench, /修改要求：\\n/)
  assert.match(workbench, /selectedSkillNames\.value = \[\.\.\.new Set\(\[\.\.\.selectedSkillNames\.value, 'skill-creator'\]\)\]/)
})

test('skill creation requests prefill the central Skill root and open file tools', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  assert.match(workbench, /onEvent\('skill-creator-create'/)
  assert.match(workbench, /consumeLastEvent\('skill-creator-create'\)/)
  assert.match(workbench, /offSkillCreatorCreate\?\.\(\)/)
  assert.match(workbench, /skillsRoot\?: unknown/)
  assert.match(workbench, /Skill 根目录：\\n/)
  assert.match(workbench, /新建要求：\\n/)
  assert.match(workbench, /fileToolsSelected\.value = true/)
})

test('switching conversations keeps the middle document preview open', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const conversationBranch = workbench.match(
    /if \(resource\.type === 'conversation'\) \{([\s\S]*?)\n  \} else \{/,
  )?.[1]

  assert.ok(conversationBranch, 'conversation resource branch should exist')
  assert.doesNotMatch(conversationBranch, /closePreview\(\)/)
  assert.doesNotMatch(conversationBranch, /editingMarkdown\.value\s*=\s*false/)
  assert.doesNotMatch(conversationBranch, /markdownSaveError\.value\s*=\s*''/)
  assert.match(workbench, /function closePreview\(\)[\s\S]*previewResource\.value = null/)
  assert.match(workbench, /<button[^>]*title="关闭预览"[^>]*@click="closePreview"/)
})

test('closing a project preview restores the creation panel that opened it', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  assert.match(workbench, /const restoreCreationAfterPreview = ref\(false\)/)
  assert.match(workbench, /const shouldRestoreCreation = creationOpen\.value \|\| creationMounted\.value/)
  assert.match(workbench, /restoreCreationAfterPreview\.value = shouldRestoreCreation/)
  assert.match(workbench, /const shouldRestoreCreation = restoreCreationAfterPreview\.value[\s\S]*?restoreCreationAfterPreview\.value = false/)
  assert.match(workbench, /if \(shouldRestoreCreation\) void openCreationHost\(\)/)
})

test('memory composer keeps long Chinese input inside the available width', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  assert.match(workbench, /\.memory-input-row \{[^}]*min-width: 0;/)
  assert.match(workbench, /\.memory-input-area \{[^}]*min-width: 0;/)
  assert.match(workbench, /\.memory-composer-editable \{[^}]*white-space: pre-wrap;/)
  assert.match(workbench, /\.memory-composer-editable \{[^}]*word-break: break-word;/)
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
  assert.match(
    tree,
    /return isMobile\s*\?\s*null\s*:\s*availableLocalProjects\.find\(project\s*=>\s*project\.name\s*===\s*cloud\.name\)/,
  )
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

test('iPhone account settings reuse login while hiding commercial entries only', () => {
  const settings = source('src/components/memory/MemorySettings.vue')
  const login = source('src/components/auth/JcCloudLoginBox.vue')

  assert.match(settings, /:account-only="mobileRuntime"/)
  assert.match(settings, /gatewayDeleteAccount\(\)/)
  assert.match(settings, /注销账号/)
  assert.match(login, /accountOnly\?: boolean/)
  // accountOnly 只管商业入口：充值/邀请/签到/下载页都依赖账号，移动端必须藏掉（2.1(b)）。
  assert.match(login, /v-if="!accountOnly" class="jc-login-link"[\s\S]*下载APP/)
  assert.match(login, /v-if="!accountOnly" class="jc-login-secondary"[\s\S]*注册账号/)
  // 但 API Key 与保存不能被 accountOnly 藏：移动端只留一个需要账号的登录按钮，
  // 审核员没有账号就走不进去，2.1(a) 就是这么来的。
  assert.match(login, /<div v-else>\s*<label class="jc-login-label">API Key<\/label>/)
  assert.match(login, /<button class="jc-login-save" :disabled="busy"/)
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
  assert.match(
    project,
    /const result = await mutateConversation[\s\S]*return \{ \.\.\.result, lastAssistantTurnId: assistantTurn\.id \}/,
  )
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
  ]) {
    assert.match(paths, new RegExp(path.replace('.', '\\.')))
  }
  assert.match(project, /MEMORY_PROJECT_SKELETON_DIRECTORIES/)
  assert.match(project, /migrateLegacyMemoryMaterials[\s\S]*kind: 'move'[\s\S]*'keep-both'/)
  assert.match(
    project,
    /appendMemoryRound[\s\S]*const result = await mutateConversation[\s\S]*appendConversationTurn\(appendConversationTurn/,
  )
})

test('conversation lifecycle restores the latest Skill selection and clears it for new chats', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  assert.ok(workbench.includes("const latestUserTurn = [...resource.transcript.turns].reverse().find(turn => turn.role === 'user')"))
  assert.ok(workbench.includes('await restoreComposerSkills(latestUserTurn?.skillNames)'))
  assert.ok(workbench.includes('async function availableSkillNamesForComposer(): Promise<Set<string>> {'))
  assert.ok(workbench.includes('(await loadWebSkillCatalog().catch(() => [])).map(skill => skill.name)'))
  assert.ok(workbench.includes('selectedSkillNames.value = [...new Set((names || []).filter(name => available.has(name)))]'))
  assert.ok(workbench.includes("const created = await createMemoryConversation(owner, '新对话', files)"))
  assert.ok(workbench.includes('selectedSkillNames.value = []'))
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
    /if \(resource\.mediaKind === 'model3d'\) \{[\s\S]*?modelData\.value = data\.buffer/,
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
  assert.match(workbench, /loadConversationAttachmentPreviews[\s\S]*acquireProjectMediaDisplay/)
  assert.match(workbench, /conversationPreviewLeases\.set\(lease\.url, lease\)/)
  assert.match(workbench, /for \(const lease of conversationPreviewLeases\.values\(\)\) lease\.release\(\)/)
})

test('memory composer starts at a three-line input height', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  assert.match(workbench, /\.memory-input-area \{[^}]*min-height: 76px;/)
})

test('memory workbench accepts text references and uses the adaptive main composer behavior', () => {
  const tree = source('src/components/filetree/ProjectFileTree.vue')
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const runtime = source('src/runtime/memory/memoryChat.ts')

  assert.match(tree, /v-if="!ctxMenu\.node\.isDir"[\s\S]*@click="ctxReferenceInChat"/)
  assert.match(tree, /emitEvent\('reference-file', \{ resource: resourceForNode\(node\) \}\)/)
  assert.doesNotMatch(tree, /emitEvent\('reference-file', \{ name:/)
  assert.match(workbench, /contenteditable="true"/)
  assert.match(
    workbench,
    /const editor = event\.currentTarget as HTMLElement[\s\S]*getPlainText\(editor\)/,
  )
  assert.match(workbench, /function resizeComposer\(\)/)
  assert.match(workbench, /<PromptSelectionRevision[\s\S]*v-model="markdownDraft"[\s\S]*:revise="reviseMarkdownSelection"/)
  const revision = source('src/components/memory/PromptSelectionRevision.vue')
  assert.match(revision, /selectedText: string; instruction: string/)
  assert.match(revision, /内容已变化，请重新选择/)
  assert.match(revision, /textarea::selection/)
  assert.match(revision, /selection-mirror \{[^}]*color: transparent/)
  assert.match(revision, /selection-mirror mark \{[^}]*background: color-mix/)
  assert.doesNotMatch(revision, /selection-input-hidden[^}]*color: transparent/)
  assert.doesNotMatch(revision, /v-html="highlightedValue"/)
  assert.match(revision, /<mark>\{\{ modelValue\.slice\(start, end\) \}\}<\/mark>/)
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

test('点 @Skill 只列 Skill，不重复芯片排已有的工具入口', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  assert.match(workbench, /skillPickerOnly\.value = true/)
  assert.match(workbench, /if \(skillPickerOnly\.value\) return skills/)
  assert.match(workbench, /sortSkillsForPicker\(/)
  assert.match(workbench, /recordSkillUse\(option\.name\)/)
})

test('memory composer uses one workbench mode with beginner-friendly command templates', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const runtime = source('src/runtime/memory/memoryChat.ts')

  assert.doesNotMatch(workbench, /executionMode|ConversationMode/)
  assert.doesNotMatch(workbench, /memory-mode-segment|>快速</)
  assert.match(workbench, /const toolCommands = \[/)
  for (const label of ['@Skill', '@文件', '@图文', '@影音', '@3D', '@MCP'])
    assert.match(workbench, new RegExp(`label: '${label}'`))
  // @Jev 只留 @ 提及一个入口：输入框下沿的常驻开关用户实测不想要
  // （他自己用 @ 的时候才开）。它仍然要能被开启、被持久化、被回填。
  assert.doesNotMatch(workbench, /label: '@Jev'/)
  assert.match(workbench, /id: 'jev', display: 'Jev'/)
  assert.match(workbench, /if \(id === 'jev'\) jevSelected\.value = true/)
  assert.match(workbench, /if \(id === 'jev'\) jevSelected\.value = false/)
  assert.match(workbench, /if \(jevSelected\.value\) ids\.push\('jev'\)/)
  // @Terminal 已并入 @文件：开关一开就是本机全权，不留第二个终端入口。
  assert.doesNotMatch(workbench, /@Terminal/)
  assert.doesNotMatch(workbench, /terminalSelected/)
  assert.doesNotMatch(workbench, /@Skill \+ @MCP/)
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
  assert.match(workbench, /程序已返回真实执行回执/)
  assert.match(workbench, /programStatus\.kind/)
  assert.doesNotMatch(
    runtime,
    /rawPath: string|input\.rawPath|conversationDocumentSources|historicalDocumentSources/,
  )
  assert.doesNotMatch(runtime, /memoryMode|input\.mode(?:\W|$)|快速模式/)
  assert.doesNotMatch(runtime, /tools: \[WIKI_CONTEXT_TOOL_DEFINITION\]/)
  assert.doesNotMatch(runtime, /maxModelRequests: maxMemorySteps|stopAfterSuccessfulToolNames/)
  assert.match(runtime, /maxToolRounds: 64/)
  assert.match(runtime, /finalizeAtToolRoundLimit: true/)
  assert.match(runtime, /compactToolHistory: selectedSkillNames\.length === 0/)
  assert.doesNotMatch(runtime, /WIKI_SEARCH_TOOL_DEFINITION/)
  assert.doesNotMatch(runtime, /READ_ONLY_DOCUMENT_TOOL_DEFINITIONS|快速模式只能读取/)
  assert.match(runtime, /attachments: input\.attachments/)
  assert.match(runtime, /files: input\.files/)
  assert.match(runtime, /context\.omittedMessages > 0[\s\S]*onContextTrimmed/)
  assert.match(runtime, /reservedTokens: maxOutputTokens \+ Math\.min\(32_768, Math\.max\(2_048, Math\.floor\(contextWindow \* 0\.1\)\)\)/)
  assert.match(
    workbench,
    /onContextTrimmed\(\)[\s\S]*contextNoticeShownConversations\.add\(active\.transcript\.id\)/,
  )
  assert.match(workbench, /recordConversation\(turn\)/)
  assert.doesNotMatch(workbench, /status\.value = `已记录对话：\$\{path\}`/)
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
  assert.doesNotMatch(workbench, /fileActions\.readMedia\(resource\)/)
  assert.match(workbench, /value: '',\s+resourcePath: resource\.path/)
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

test('conversation memory status restores from its persisted index and only failures expose retry', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(workbench, /conversationMemoryIndexPath, parseConversationMemoryIndex/)
  assert.match(workbench, /files\.readTextAt\(resource\.resource\.owner, conversationMemoryIndexPath\(resource\.transcript\.id\)\)/)
  assert.match(workbench, /index\.conversationId !== resource\.transcript\.id/)
  assert.match(workbench, /entry\.rawPath === resource\.resource\.path/)
  assert.match(workbench, /memoryIndexStates\.value = Object\.fromEntries/)
  assert.match(workbench, /v-if="memoryIndexStates\[turn\.id\] === 'writing'"/)
  assert.match(workbench, /v-else-if="memoryIndexStates\[turn\.id\] === 'success'"/)
  assert.match(workbench, /v-if="memoryIndexStates\[turn\.id\] === 'error'" class="memory-index-error"/)
  assert.match(workbench, /<button v-if="memoryIndexStates\[turn\.id\] === 'error'"[\s\S]{0,240}@click="recordConversation\(turn\)"/)
  assert.doesNotMatch(workbench, /shouldSuggestMemoryIndex/)
  assert.doesNotMatch(workbench, /memoryIndexStates\[turn\.id\] \|\| 'idle'/)
})

test('memory composer reads the native clipboard only for an empty Desktop image paste', () => {
  assert.equal(shouldReadNativeClipboardImage(0, '', true, false), true)
  assert.equal(shouldReadNativeClipboardImage(1, '', true, false), false)
  assert.equal(shouldReadNativeClipboardImage(0, 'text', true, false), false)
  assert.equal(shouldReadNativeClipboardImage(0, '', false, false), false)
  assert.equal(shouldReadNativeClipboardImage(0, '', true, true), false)
})

test('memory mode keeps explicit Skill and plugin connections', () => {
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
  assert.match(workbench, /v-show="mentionOpen" ref="mentionPopoverRef"/)
  assert.match(workbench, /addProjectFileReference\(option\.resource\)/)
  assert.match(workbench, /resource\.kind !== 'binary' \|\| isOfficeResource\(resource\)/)
  assert.match(workbench, /selectedSkillNames: skillSnapshot/)
  assert.doesNotMatch(workbench, /wikiSelected|@Wiki/)
  assert.match(runtime, /selectMemoryTools\(\n\s*allMemoryToolDefinitions/)
  assert.doesNotMatch(runtime, /WikiAgent|wikiProtocolTask|runWikiTwoPhase/)
  assert.doesNotMatch(runtime, /customSkill\?\.skillContent\.trim\(\)/)
  assert.doesNotMatch(runtime, /selectedSkillNames\.map\(\(name, index\)/)
  assert.match(runtime, /buildSelectedSkillPrompt\(/)
  assert.match(runtime, /skillAllowedToolNames/)
  assert.match(runtime, /工具未由 Skill 或用户选择授权/)
  assert.match(runtime, /selectedSkillPrompt \|\| buildWebSkillCatalogPrompt\(catalog\)/)
  assert.match(runtime, /buildMemoryDesktopToolDefinitions\(\)/)
  assert.match(runtime, /buildMemoryWebProjectToolDefinitions\(\)/)
  assert.match(runtime, /projectId\?: string/)
  assert.match(runtime, /toolLoopRequired && !input\.projectId/)
  assert.match(workbench, /desktopOnlyRuntime \? \[/)
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
  assert.match(workbench, /memory-toggle-label">记忆<\/span>/)
  assert.match(workbench, /memory-toggle-label">查询<\/span>/)
  assert.doesNotMatch(workbench, /memory-toggle-label">对话(?:记忆|查询)<\/span>/)
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
  assert.match(bubble, /const displayUrl = ref\(''\)/)
  assert.match(bubble, /:src="displayUrl"/)
  assert.match(bubble, /loading="lazy" decoding="async"/)
  assert.doesNotMatch(bubble, /<video|<audio|preload="metadata"/)
  assert.match(bubble, /class="mtb-media-preview"/)
  assert.match(bubble, /await revealInTree\(\)/)
  assert.match(bubble, /watch\(projectResource[\s\S]*acquireProjectMediaDisplay\(resource\)/)
  assert.doesNotMatch(bubble, /URL\.createObjectURL|URL\.revokeObjectURL/)
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
    /const complete = editTargetId[\s\S]*appendMemoryRound\(active\.resource, userTurn, reply, files, title\)[\s\S]*if \(!isOnScreen\(run\)\) return\s*\n\s*opened\.value = await openProjectResource\(files, complete\.resource\)[\s\S]*run\.streamingText = ''/,
  )
  assert.match(workbench, /const pendingUserTurn = computed\(\(\) => activeRun\.value\?\.userTurn \?\? null\)/)
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
    /event\.type === 'tool_execution_start'[\s\S]*run\.status = `正在\$\{label\}`/,
  )
  assert.match(
    workbench,
    /event\.status === 'succeeded' \? 'done' : 'failed'[\s\S]*run\.steps\.find\(item => item\.state === 'running'\)[\s\S]*正在等待模型继续处理/,
  )
  assert.match(workbench, /v-if="runVisible" class="memory-run-status"/)
  assert.match(workbench, /v-for="step in visibleRunSteps"/)
  assert.match(workbench, /\(sending \|\| displayedError\) && visibleRunSteps\.length/)
  assert.match(workbench, /formatRunElapsed\(runElapsed\)/)
  assert.match(workbench, /onMetrics\(metrics\)[\s\S]*run\.metrics = metrics/)
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
    /const interrupted = await appendMemoryRound\(active\.resource, userTurn, interruptedReply, files, title\)[\s\S]*if \(!isCurrentRun\(\) \|\| !isOnScreen\(run\)\) return/,
  )
  assert.match(
    workbench,
    /const aborted = cause instanceof DOMException && cause\.name === 'AbortError'[\s\S]*if \(aborted\) \{\s*run\.phase = 'stopped'\s*run\.status = '已停止'/,
  )
  // 运行中 composer 仍然可用：只有发送键变成停止键，草稿属于下一轮。
  assert.match(workbench, /contenteditable="true"/)
  assert.match(workbench, /title="添加附件" @click="fileInput\?\.click\(\)"/)
  assert.match(workbench, /title="移除附件" @click="removeAttachment\(file\.id\)"/)
  assert.match(workbench, /<button v-if="sending" class="send-button" title="本条对话正在运行/)
  // 唯一还按运行态禁用的控件是消息级「编辑并重新发送」；输入下一轮的入口全部放开。
  assert.equal((workbench.match(/:disabled="sending"/g) || []).length, 1)
})

test('memory composer keeps project file references until the user cancels them', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(workbench, /const persistentAttachments = ref<ResolvedDirectAttachment\[\]>\(\[\]\)/)
  assert.match(workbench, /const activeAttachments = \[\.\.\.persistentAttachments\.value, \.\.\.attachments\.value\]/)
  assert.match(workbench, /persistentAttachments\.value = \(resource\.transcript\.persistentAttachments \|\| \[\]\)/)
  assert.match(workbench, /if \(attachment\.kind === 'file' && attachment\.readablePath\)[\s\S]*files\.readText\([\s\S]*path: attachment\.readablePath[\s\S]*textContent: text\.content\.slice\(0, MAX_INLINE_ATTACHMENT_CHARS\)/)
  assert.match(workbench, /title="取消持续引用"/)
})

test('memory cancellation settles the visible run before invalidating stale callbacks', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(
    workbench,
    /function stopRun\(run: MemoryRun\) \{\s*if \(run\.phase === 'running'\) run\.phase = 'stopped'\s*run\.status = '已停止'\s*stopRunTimer\(run\)\s*settleApproval\(run, 'reject'\)\s*run\.controller\.abort\(\)/,
  )
})

test('memory runs belong to their conversation instead of the visible one', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const openProject = workbench.match(/async function openProject\(owner: string\) \{([\s\S]*?)\n\}/)?.[1]
  const selectConversation = workbench.match(/async function selectConversation\(item: MemoryConversation\) \{([\s\S]*?)\n\}/)?.[1]
  const deleteConversation = workbench.match(/async function deleteConversation\(item: MemoryConversation\) \{([\s\S]*?)const message = /)?.[1]

  // 运行表按 owner::路径 索引：不同项目的对话 Raw 可能同名，只按路径索引会串项目。
  assert.match(workbench, /const runs = reactive\(new Map<string, MemoryRun>\(\)\)/)
  assert.match(workbench, /const memoryRunKey = \(owner: string, path: string\) => `\$\{owner\}::\$\{path\}`/)
  assert.match(workbench, /const sending = computed\(\(\) => activeRun\.value\?\.phase === 'running'\)/)
  // 派发那一刻就清空草稿，不必等这一轮跑完才能输入下一段。
  assert.match(
    workbench,
    /const isCurrentRun = \(\) => runs\.get\(runKey\) === run[\s\S]*input\.value = ''\n  editingTurnId\.value = ''\n  setEditorText\(composerRef\.value, ''\)[\s\S]*await runMemoryChat\(/,
  )
  // 切项目、切对话都不再中断运行。
  assert.ok(openProject && selectConversation, 'openProject and selectConversation should exist')
  assert.doesNotMatch(openProject, /stop\(\)/)
  assert.doesNotMatch(selectConversation, /stop\(\)/)
  // 删除对话仍然只停它自己的运行：授权随对话消失，继续跑会用旧授权落盘。
  assert.ok(deleteConversation, 'deleteConversation should exist')
  assert.match(deleteConversation, /const deletedRun = runs\.get\(memoryRunKey\(item\.resource\.owner, item\.resource\.path\)\)/)
  assert.match(deleteConversation, /if \(deletedRun\) stopRun\(deletedRun\)/)
  // 落盘无条件，改视图有条件：切走了也要写完，但界面不被别的对话的运行改写。
  assert.match(workbench, /const isOnScreen = \(run: MemoryRun\) => run\.owner === projectOwner\.value && conversation\.value\?\.resource\.path === run\.resourcePath/)
  assert.match(workbench, /if \(run\.owner === projectOwner\.value\) rememberConversation\(complete\)/)
  assert.match(workbench, /if \(!isOnScreen\(run\)\) return\n\s*opened\.value = await openProjectResource/)
  // 审批跟着 run 走，后台对话的审批不会弹到当前对话上。
  assert.match(workbench, /const pendingMemoryToolApproval = computed\(\(\) => activeRun\.value\?\.approval \?\? null\)/)
  assert.match(workbench, /run\.approval = \{\n\s*message: memoryToolApprovalMessage\(call\)/)
})

test('memory ignores stale streaming callbacks and stale resource loads', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(workbench, /const isCurrentRun = \(\) => runs\.get\(runKey\) === run && run\.phase === 'running'/)
  assert.match(workbench, /onRetry\(attempt, total\) \{\s*if \(!isCurrentRun\(\)\) return/)
  assert.match(workbench, /onText\(text\) \{\s*if \(!isCurrentRun\(\)\) return/)
  assert.match(
    workbench,
    /onToolEvent: event => \{\s*if \(isCurrentRun\(\)\) updateRunTool\(run, event\)/,
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
  assert.match(workbench, /const run = runs\.get\(runKey\) as MemoryRun/)
  assert.match(workbench, /settleApproval\(run, 'reject'\)[\s\S]*run\.controller\.abort\(\)/)
})

test('memory run status does not render the legacy duplicate status line', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const runtime = source('src/runtime/memory/memoryChat.ts')

  assert.match(workbench, /v-else-if="!runVisible && \(displayedStatus \|\| displayedError\) && !displayedStatus\.startsWith\('已记录对话'\)" class="memory-status"/)
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
  assert.doesNotMatch(workbench, /persistSkillPackageDraft/)
  assert.match(workbench, /@approve="approveSkillInstall\(turn\.id\)"/)
  assert.doesNotMatch(card, /createAgent|updateSkill|localStorage/)
  assert.match(card, /安装到我的 Skill/)
  assert.match(card, /继续修改/)
})

test('memory settings expose all shared themes and initialize Web to green once', () => {
  const settings = source('src/components/memory/MemorySettings.vue')
  const theme = source('src/composables/useTheme.ts')

  for (const key of ['white', 'light', 'dark', 'green', 'nord', 'dracula']) {
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
  assert.match(workbench, /fileWriteSearch = ref\(''\)/)
  assert.match(workbench, /v-for="resource in filteredFileWriteTargets"/)
  assert.match(workbench, /await appendFileWriteIndex\(owner, target\.path, savedPath\)/)
  assert.match(workbench, /appendProjectDirectoryIndex\(files, owner, directoryPath, savedPath\)/)
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
  assert.match(workbench, /if \(resource\.type === 'conversation'\) \{[\s\S]*if \(creationMounted\.value\) \{[\s\S]*flushCanvasSave/)
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
  assert.match(creation, /flushCanvasSave: \(\) => flushCanvasSave\(true\)/)
  assert.match(workbench, /ref<\{\s*flushCanvasSave\?: \(\) => Promise<void>/)
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

test('memory settings provide and persist accessible font sizes', () => {
  const settings = source('src/components/memory/MemorySettings.vue')
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const main = source('src/main.ts')

  for (const size of [14, 16, 18, 30]) assert.match(settings, new RegExp(`value: ${size}`))
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
  assert.match(editor, /scenePeople\.slice\(0, PERSON_BUTTON_LIMIT\)/)
  assert.match(editor, /function applyCloseShot\(index: number\)/)
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

test('3D scene editor keeps fine movement precision instead of teleporting one unit', () => {
  const editor = source('src/components/memory/Scene3DEditor.vue')

  assert.match(editor, /const snapStep = ref\(0\.1\)/)
  assert.match(editor, /const SNAP_STEPS = \[1, 0\.5, 0\.25, 0\.1\]/)
  assert.match(editor, /transform\.setTranslationSnap\(document\.canvas\.snap \? snapStep\.value : null\)/)
  assert.doesNotMatch(editor, /setTranslationSnap\(document\.canvas\.snap \? 1 : null\)/)
  assert.match(editor, /v-model\.number="snapStep"/)
  assert.match(editor, /function updateSelectedPosition\(axis: number, raw: string\)/)
  assert.match(editor, /function nudgeSelection\(offset: \[number, number, number\]\)/)
  assert.match(editor, /function handleNudgeKeys\(event: KeyboardEvent\)/)
  assert.match(editor, /window\.addEventListener\('keydown', handleNudgeKeys\)/)
  assert.match(editor, /window\.removeEventListener\('keydown', handleNudgeKeys\)/)
  assert.match(editor, /class="scene3d-inspector-grid scene3d-position-grid"/)
  assert.match(editor, /v-for="\(axis, index\) in \['x', 'y', 'z'\]"/)
})

test('3D scene editor frames what it captures and moves framing without moving the scene', () => {
  const editor = source('src/components/memory/Scene3DEditor.vue')

  assert.match(editor, /function cropRect\(width: number, height: number\)/)
  assert.match(editor, /const frameRect = computed\(\(\) => cropRect\(stageSize\.value\.width, stageSize\.value\.height\)\)/)
  assert.match(editor, /const crop = cropRect\(width, height\)/)
  assert.match(editor, /stageSize\.value = \{ width: canvas\.value\.clientWidth, height: canvas\.value\.clientHeight \}/)
  assert.match(editor, /:style="\{ width: `\$\{frameRect\.width\}px`, height: `\$\{frameRect\.height\}px` \}"/)
  assert.doesNotMatch(editor, /72vh/)
  assert.doesNotMatch(editor, /aspect-ratio: var\(--scene-aspect\)/)
  assert.match(editor, /function panCamera\(right: number, up: number\)/)
  assert.match(editor, /function toggleFrameMode\(\)/)
  assert.match(editor, /orbit\.mouseButtons = frameMode\.value/)
  assert.match(editor, /function applyCloseShot\(index: number\)/)
})

test('3D scene editor keeps the live camera, the focal length and the canvas aspect stable', () => {
  const editor = source('src/components/memory/Scene3DEditor.vue')

  assert.match(editor, /orbit\.addEventListener\('end', syncCameraState\)/)
  assert.match(editor, /function syncCameraState\(\) \{\s*if \(!camera \|\| !orbit \|\| playing\.value \|\| manualRecording\.value\) return/)
  assert.match(editor, /const position = tuple\(camera\.position\)/)
  assert.match(editor, /if \(samePoint\(position, document\.camera\.position\) && samePoint\(target, document\.camera\.target\)\) return/)
  assert.match(editor, /persist\(\{ history: false \}\)/)
  assert.match(editor, /document\.camera = \{ \.\.\.structuredClone\(source\), aspect: document\.canvas\.aspect \}/)
  assert.doesNotMatch(editor, /document\.canvas\.aspect = source\.aspect/)
  assert.match(editor, /const FOCAL_STEPS = \[24, 35, 50, 85, 135\]/)
  assert.match(editor, /function focalFov\(focal: number, aspect: number\)/)
  assert.match(editor, /function cameraFov\(canvasRatio: number\)/)
  assert.match(editor, /const HEAD_FILL_MEDIUM = 0\.2/)
  assert.match(editor, /const PERSON_BUTTON_LIMIT = 6/)
  assert.match(editor, /scenePeople\.slice\(0, PERSON_BUTTON_LIMIT\)/)
  assert.match(editor, /function personForward\(person: Scene3DPersonShot\)/)
  assert.match(editor, /const distance = shotDistance\(person\.scale, HEAD_FILL_MEDIUM\)/)
  // 机位行的预设不能再依赖写死的世界坐标
  assert.doesNotMatch(editor, /defaultCameras/)
  assert.doesNotMatch(editor, /camera\('俯拍'/)
  // 取景框必须和舞台边缘留出可见间距，否则边框会和面板边框粘在一起
  assert.match(editor, /\.scene3d-stage \{ position: relative; min-height: 320px; overflow: hidden; padding: 8px; \}/)
  assert.match(editor, /perspective\.fov = cameraFov\(perspective\.aspect\)/)
  assert.match(editor, /perspective\.aspect = renderRatio; perspective\.fov = cameraFov\(renderRatio\)/)
  assert.match(editor, /v-for="focal in FOCAL_STEPS"/)
  assert.doesNotMatch(editor, /lensFov|setLens\(/)
  assert.match(editor, /function setProjection\(projection: Scene3DCamera\['projection'\]\) \{\s*if \(document\.camera\.projection === projection\) return/)
})

test('3D scene editor marks camera points and records the move through the hidden recorder', () => {
  const editor = source('src/components/memory/Scene3DEditor.vue')
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(editor, /const cameraPoints = computed\(\(\) => \{ renderRevision\.value; return cameraPointsFromDocument\(document\) \}\)/)
  assert.match(editor, /document = applyCameraPoints\(document, points\)/)
  assert.match(editor, /function markCameraPoint\(\)/)
  assert.match(editor, /function removeCameraPoint\(index: number\)/)
  assert.match(editor, /function updateCameraPoint\(index: number, patch: Partial<Scene3DCameraPoint>\)/)
  assert.match(editor, /function useCameraPoint\(index: number\)/)
  assert.match(editor, /function replaceCameraPoint\(\)/)
  // 运镜必须交给隐藏录制器：可见编辑器的画布是舞台形状，直接录会带上取景框外的画面
  assert.match(editor, /emit\('record', structuredClone\(document\), /)
  assert.match(editor, /function requestCameraPathRecording\(\)/)
  assert.match(editor, /<span>运镜<\/span>/)
  assert.match(editor, /title="把当前机位打成一个点"/)
  assert.match(editor, /watch\(playing, value => \{ if \(!value\) restoreLens\(\) \}\)/)
  assert.match(editor, /applyAnimation\(currentTime\.value, false\)/)
  assert.match(editor, /function cameraFovFor\(focal: number, canvasRatio: number\)/)
  assert.match(workbench, /@record="recordScenePath"/)
  assert.match(workbench, /async function recordScenePath\(document: Scene3DDocument, title: string\)/)
  assert.match(workbench, /await saveSceneVideo\(await recordSceneVideo\(document\), title\)/)
})

test('3D scene editor hides the inspector with no selection and surfaces recording results', () => {
  const editor = source('src/components/memory/Scene3DEditor.vue')

  // 没选中对象时检视栏隐藏且不再占一列宽度
  assert.match(editor, /<div class="scene3d-workspace" :class="\{ 'inspector-open': Boolean\(selectedEntry\) \}">/)
  assert.match(editor, /\.scene3d-workspace \{ min-height: 0; display: grid; grid-template-columns: minmax\(0, 1fr\); \}/)
  assert.match(editor, /\.scene3d-workspace\.inspector-open \{ grid-template-columns: minmax\(0, 1fr\) 260px; \}/)
  assert.match(editor, /\.scene3d-workspace, \.scene3d-workspace\.inspector-open \{ grid-template-columns: minmax\(0, 1fr\); grid-template-rows:/)
  // 录制/截图结果改成画面上可读的浮动提示（工具栏里会横向滚动被截断）
  assert.match(editor, /function showNotice\(text: string\)/)
  assert.match(editor, /function noticeTone\(text: string\)/)
  assert.match(editor, /watch\(\(\) => props\.videoStatus, value => \{ if \(value\) showNotice\(value\) \}, \{ immediate: true \}\)/)
  assert.match(editor, /watch\(recordingError, value => \{ if \(value\) showNotice\(value\) \}\)/)
  assert.match(editor, /class="scene3d-notice"/)
  assert.doesNotMatch(editor, /\{\{ videoStatus \}\}/)
})

test('memory chat dock keeps its rail only while a third column exists', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  // 曾经：对话框拖成窄条后关掉预览，主列变满宽但窄条仍铺满整列且内容被隐藏 → 只剩一片空白
  assert.doesNotMatch(workbench, /chat-dock-compact \.memory-main > :not\(\.memory-chat-compact-bar\) \{ visibility: hidden/)
  assert.match(workbench, /\.memory-workbench\.chat-dock-compact:is\(\.preview-open, \.creation-open\) \.memory-main > :not\(\.memory-chat-compact-bar\) \{ visibility: hidden; \}/)
  assert.match(workbench, /v-if="chatDockMode === 'compact' && \(previewResource \|\| creationOpen\)"/)
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
    /toolLoopRequired && agentStore\.modelsFetched && model\?\.toolCall === false/,
  )
})

test('memory file actions stay inside the memory resource route on Desktop', () => {
  const tree = source('src/components/filetree/ProjectFileTree.vue')

  assert.match(
    tree,
    /const result = await openProjectResource\(projectFiles, resource\)\s*emitEvent\('memory:open-resource', result\)/,
  )
  assert.match(tree, /createText\(projectKey\.value, relPath, ''\)[\s\S]*memory:open-resource/)
  assert.match(tree, /v-if="isDesktop && !isMobile"[\s\S]*用系统默认应用打开/)
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
  assert.match(renderer, /renderMessageMarkdown\(renderMarkdownFileLinks\(props\.content\), 'assistant'\)/)
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
  const links = source('src/runtime/memory/markdownFileLinks.ts')

  assert.match(workbench, /resolveMarkdownFileLinkTarget\(target, sourcePath, await files\.list\(owner\)\)/)
  assert.match(
    workbench,
    /emitEvent\('project-filetree:locate', \{ path: resource\.path \}\)\n\s*await openProjectFile\(resource\)/,
  )
  assert.match(workbench, /memory-preview-path/)
  assert.match(workbench, /findMarkdownFileBacklinks\(target, sources\)/)
  assert.match(workbench, /被以下文件引用/)
  assert.match(workbench, /文件不存在：\$\{target\}/)
  assert.doesNotMatch(workbench, /wiki.*index.*database/i)
  assert.match(links, /parseMarkdownFileLinks/)
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
  assert.match(workbench, /<PromptSelectionRevision[\s\S]*v-model="markdownDraft"/)
  assert.match(workbench, /async function reviseMarkdownSelection\(/)
  assert.match(workbench, /title="编辑 Markdown"/)
})

test('Windows startup does not infer WebView2 availability from the browser user agent', () => {
  const main = source('src/main.ts')

  assert.doesNotMatch(main, /当前使用的浏览器不是 Edge|LinkId=2124703|\/Edg\\\//)
})

test('memory Markdown editing supplies project files to one shared WikiLink picker', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const editor = source('src/components/memory/PromptSelectionRevision.vue')
  const picker = source('src/components/memory/WikiLinkPicker.vue')
  assert.match(workbench, /const markdownWikiLinkResources = ref/)
  assert.match(workbench, /files\.list\(previewResource\.value\.resource\.owner\)/)
  assert.match(workbench, /:wiki-link-resources="markdownWikiLinkResources"/)
  assert.ok(editor.includes('插入双链（Command/Ctrl + Shift + K）'))
  assert.ok(editor.includes('event.metaKey || event.ctrlKey'))
  assert.ok(editor.includes("event.shiftKey && event.key.toLowerCase() === 'k'"))
  assert.ok(editor.includes('findOpenWikiLink'))
  assert.ok(editor.includes('searchWikiLinkCandidates'))
  assert.ok(editor.includes('completeWikiLink'))
  assert.match(editor, /import WikiLinkPicker from/)
  assert.match(editor, /event\.stopPropagation\(\)/)
  assert.match(editor, /updateWikiLinkAnchor/)
  assert.match(editor, /emit\('cancel-edit'\)/)
  assert.doesNotMatch(editor, /class="wiki-link-picker"/)
  assert.match(picker, /class="wiki-link-picker"/)
  assert.match(workbench, /event\.defaultPrevented/)
  assert.match(workbench, /closest\('\.prompt-selection-editor'\)/)
  assert.match(workbench, /@cancel-edit="cancelMarkdownEdit"/)
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
  assert.match(settings, /placeholder="http:\/\/127\.0\.0\.1:9523"/)
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

  assert.match(workbench, /selectedMcpToolNames\.value\.map\(id => \{[\s\S]*mcpStore\.servers\.find\(server => server\.id === serverId\)\?\.name \|\| serverId/)
  assert.match(workbench, /if \(id\.startsWith\('mcp__'\)\) \{[\s\S]*selectedMcpToolNames\.value = selectedMcpToolNames\.value\.filter\(item => item !== id\)/)
  assert.match(workbench, /filterKeys: \['id', 'display', 'description'\]/)
  assert.match(workbench, /mentionOnInput\('mcp__'\)/)
  assert.match(workbench, /if \(query\.trim\(\)\.startsWith\('mcp__'\)\) return mcpTools/)
  assert.doesNotMatch(workbench, /if \(query\.trim\(\)\.startsWith\('mcp__'\)\) return \[\.\.\.skills/)
})

test('capability chips survive a completed round and come back with the conversation', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  // 一轮跑完只清一次性状态（输入框、当轮附件）；清掉 @文件 等于静默收权，用户要再点一次才能继续。
  assert.doesNotMatch(workbench, /clearToolSelections/)
  // 派发瞬间清草稿（不然要等整轮跑完才能输入下一段）；当轮附件在落盘成功与中断收尾各清一次，中间不夹带清开关/清引用。
  const sendBody = workbench.match(/async function send\(\) \{([\s\S]*?)\n\}/)?.[1]
  assert.ok(sendBody, 'send should exist')
  assert.match(sendBody, /input\.value = ''\n  editingTurnId\.value = ''\n  setEditorText\(composerRef\.value, ''\)/)
  assert.equal((sendBody.match(/attachments\.value = \[\]/g) || []).length, 2)
  // 本轮开关随用户消息落盘，重开这个对话时按最后一轮用户消息恢复。
  assert.match(workbench, /toolChips: toolChipIds\(\)/)
  assert.match(workbench, /applyToolChipIds\(latestUserToolChips\(resource\.transcript\.turns\)\)/)
  assert.match(workbench, /function applyToolChipIds\(ids\?: string\[\]\) \{/)
  // 开关手动关掉时可以有个说法，变成可解释的提醒。
  assert.match(workbench, /!fileToolsSelected\.value && authorizedPaths\.value\.length/)
  assert.match(workbench, /但 @文件 已关闭/)
})

test('editing a turn restores the Skill it was sent with and keeps its referenced files', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const editTurn = workbench.match(/async function editTurn\(turn: ConversationTurn\) \{([\s\S]*?)\n\}/)?.[1]
  const cancelEdit = workbench.match(/async function cancelEdit\(\) \{([\s\S]*?)\n\}/)?.[1]

  assert.ok(editTurn, 'editTurn should exist')
  assert.ok(cancelEdit, 'cancelEdit should exist')
  // 轮次上存了 skillNames 就必须恢复：丢了它，模型重发时一个 skill-creator 工具都没有。
  assert.match(editTurn, /restoreComposerSkills\(turn\.skillNames\)/)
  assert.match(cancelEdit, /restoreComposerSkills\(latestUserTurnToolNames\(/)
  assert.match(workbench, /async function restoreComposerSkills\(names\?: string\[\]\) \{/)
  // 恢复要过滤掉已卸载的 Skill：坏引用会污染整段会话的 Skill 加载。
  assert.match(workbench, /selectedSkillNames\.value = \[\.\.\.new Set\(\(names \|\| \[\]\)\.filter\(name => available\.has\(name\)\)\)\]/)
  // 引用文件已经跨轮保留，编辑时不该再把它清空。
  assert.doesNotMatch(editTurn, /referencedFiles\.value = \[\]/)
  assert.doesNotMatch(cancelEdit, /referencedFiles\.value = \[\]/)
})

test('the eval review report opens inside the app instead of the system browser', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(workbench, /parseEvalReviewPath,\n  parseSkillInstallPlan,/)
  // 重新打开对话、跑完一轮都要重新认一遍报告路径。
  assert.equal(workbench.match(/if \(evalReviewPath\) evalReports\.value\[turn\.id\] = evalReviewPath/g)?.length, 2)
  assert.match(workbench, /async function openEvalReport\(path: string\) \{/)
  // 报告是模型输出驱动的 HTML：沙箱 iframe 不给脚本权限，也不走外部浏览器。
  // 报告整页由自带脚本渲染，所以要放脚本；但不给 allow-same-origin，保持不透明源。
  // 报告落进项目的 JC Media 文档，再用现成的预览打开；不再自建浮层。
  assert.match(workbench, /const projectPath = `\.raw\/jc-media\/文档\/评测报告-\$\{dirName\}\.html`/)
  assert.match(workbench, /await files\.createText\(owner, projectPath, await readTextFile\(path\)\)/)
  assert.match(workbench, /await openProjectFile\(resource\)/)
  assert.doesNotMatch(workbench, /srcdoc="evalReport\.html"/)
  assert.match(workbench, /revealItemInDir/)
  // 渲染器会把报告链接标成 #jc-eval-review=，点击时就认这个标记（比靠 href/title/文字猜可靠）。
  assert.match(workbench, /closest<HTMLAnchorElement>\('a\[href\^="#jc-eval-review="\]'\)/)
  assert.match(workbench, /await openEvalReport\(decodeURIComponent\(reportLink\.getAttribute\('href'\)!\.slice\('#jc-eval-review='\.length\)\)\)/)
  // 消息正文里那条链接也要接管：解析出报告路径就拦下来，在应用内打开。
  assert.match(workbench, /const reportAnchor = \(event\.target as Element \| null\)\?\.closest<HTMLAnchorElement>\('a\[href\]'\)/)
  assert.match(workbench, /if \(reportPath\) \{\n    event\.preventDefault\(\)\n    await openEvalReport\(reportPath\)/)
  assert.match(workbench, /v-if="evalReports\[turn\.id\]" class="memory-eval-report-actions"/)
  assert.doesNotMatch(workbench, /openEvalReport[\s\S]{0,240}openUrl/)
})

test('the preview panel renders project HTML in a sandboxed frame', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')
  const explorer = source('src/services/projectExplorerService.ts')

  // HTML 是基本可读格式，opener 必须给它一条自己的类型，而不是落到“不支持预览”。
  assert.match(explorer, /\| \{ type: 'html'; resource: ProjectResource; text: ProjectTextRead \}/)
  assert.match(explorer, /if \(\/\\\.html\?\$\/i\.test\(resource\.path\)\) \{/)
  // 报告这类 HTML 靠自带脚本渲染，要放脚本，但不给同源。
  assert.match(workbench, /v-else-if="previewResource\.type === 'html'"/)
  // 预览走 srcdoc：报告生成时已预渲染静态快照，脚本被 CSP 拦住也看得见内容；
  // blob: 在打包后的 tauri:// 源下加载不出来。
  assert.match(workbench, /title="HTML 预览"\s+sandbox="allow-scripts"\s+:srcdoc="htmlPreview"/)
  assert.doesNotMatch(workbench, /createObjectURL\(new Blob/)
  // 评测报告不走 iframe：iframe 里脚本进不来（翻页/切页点不动），也拿不到应用的 CSS 变量（颜色不跟主题）。
  assert.match(explorer, /\| \{ type: 'eval-report'; resource: ProjectResource; text: ProjectTextRead; data: EvalViewerData \}/)
  assert.match(explorer, /parseEvalViewerData\(text\.content\)/)
  assert.match(workbench, /v-else-if="previewResource\.type === 'eval-report'"/)
  assert.match(workbench, /<EvalReportViewer :data="previewResource\.data" \/>/)
})

test('stopping a send gives the draft back to the composer instead of losing it', () => {
  const workbench = source('src/components/memory/MemoryWorkbench.vue')

  assert.match(workbench, /点发送即完成：立刻清空草稿/)
  assert.match(workbench, /const restoreDraft = \(\) => \{/)
  assert.match(workbench, /if \(roundPersisted \|\| !isOnScreen\(run\)\) return/)
  assert.match(workbench, /if \(runs\.get\(runKey\) !== run\) return/)
  assert.equal(workbench.match(/restoreDraft\(\)/g)?.length, 2)
  assert.match(workbench, /attachments\.value = \[\.\.\.byPath\.values\(\)\]/)
  assert.match(workbench, /if \(editTargetId\) editingTurnId\.value = editTargetId/)
})

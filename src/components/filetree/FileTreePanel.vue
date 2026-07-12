<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useFileStore, type FileEntry } from '@/composables/useFileStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useProjectStore } from '@/stores/projectStore'
import { emitEvent, onEvent } from '@/utils/eventBus'
import { confirmAction } from '@/utils/confirmAction'
import { safePrompt } from '@/utils/safePrompt'
import { isTauriRuntime } from '@/utils/tauriEnv'
import { searchItems } from '@/utils/generalSearch'
import ProjectFileTree from './ProjectFileTree.vue'

defineProps<{ isMember?: boolean }>()

type Tab = 'history' | 'project'

const isDesktop = isTauriRuntime()

const fileStore = useFileStore()
const sessionStore = useSessionStore()
const projectStore = useProjectStore()
const activeTab = ref<Tab>('history')
const searchQuery = ref('')
const items = ref<FileEntry[]>([])
const isRefreshing = ref(false)
const activeEditorFileId = ref<string | null>(null)
let loadRequestId = 0

const tabItems = computed(() => [
  // ponytail: 项目在左（跟 VS Code 一致），桌面端始终显示
  ...(isDesktop ? [
    { key: 'project' as const, icon: 'folder', label: '项目' },
  ] : []),
  { key: 'history' as const, icon: 'chat', label: '会话' },
])

const historyItems = computed<FileEntry[]>(() =>
  sessionStore.projectSessions.map(session => ({
    id: `history_ref_${session.id}`,
    category: 'history' as const,
    name: session.title || '历史会话',
    content: session.preview || '',
    mimeType: 'application/x-jiucaihezi-session',
    size: 0,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    sourceSessionId: session.id,
    metadata: {
      kind: 'session-history-ref',
      originalId: session.id,
      messagePreview: session.preview || '',
    },
  }))
)

const filteredItems = computed(() => {
  const source = activeTab.value === 'history' ? historyItems.value : items.value
  const filtered = searchItems(searchQuery.value, source, (item) =>
    [item.name, item.content].filter(Boolean).join(' ')
  )
  return [...filtered].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
})

function canUseTab(tab: Tab): boolean {
  if (tab === 'project') return isDesktop
  return tab === 'history'
}

function formatTime(ts: number) {
  if (!ts) return ''
  const date = new Date(ts)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

function iconFor(item: FileEntry) {
  if (item.category === 'history') return 'forum'
  if (item.mimeType === 'folder') return 'folder'
  return 'description'
}

function historySubtext(item: FileEntry): string {
  const preview = String(item.metadata?.messagePreview || item.content || '').trim()
  if (preview) return preview
  return `${item.metadata?.messageCount || 0} 条消息`
}

async function loadTab() {
  if (activeTab.value === 'project') return // ProjectFileTree handles its own loading
  const requestId = ++loadRequestId
  isRefreshing.value = true
  try {
    if (activeTab.value === 'history') {
      await sessionStore.loadAllSessions()
      return
    }
    const list = await fileStore.loadByCategory(activeTab.value)
    if (requestId === loadRequestId) items.value = list
  } finally {
    if (requestId === loadRequestId) isRefreshing.value = false
  }
}

function switchTab(tab: Tab) {
  if (!canUseTab(tab)) return
  if (tab === 'project') {
    activeTab.value = tab
    return
  }
  activeTab.value = tab
}

const listEl = ref<HTMLElement | null>(null)

function openItem(file: FileEntry) {
  // ponytail: 保存滚动位置，防止 Vue 响应式更新导致列表抖动
  const scrollTop = listEl.value?.scrollTop ?? 0
  if (file.category === 'history') {
    const sessionId = String(file.metadata?.originalId || file.sourceSessionId || '')
    if (sessionId) {
      sessionStore.switchSession(sessionId)
      emitEvent('switch-panel', 'chat')
    }
    // ponytail: 恢复滚动位置，避免"点击后跳到顶端"
    nextTick(() => { if (listEl.value) listEl.value.scrollTop = scrollTop })
    return
  }
  emitEvent('open-in-editor', { name: file.name, content: file.content, fileId: file.id })
  emitEvent('switch-panel', 'editor')
}

function referenceItem(file: FileEntry) {
  if (file.category === 'history') {
    sessionStore.loadSessionMessages(String(file.metadata?.originalId || file.sourceSessionId || '')).then(messages => {
      const content = messages
        .filter(message => message.role === 'user' || message.role === 'assistant')
        .map(message => `## ${message.role === 'user' ? '用户' : '助手'}\n${message.content || ''}`)
        .join('\n\n')
      if (content.trim()) emitEvent('reference-file', { name: file.name, content })
    })
    return
  }
  if (file.content) emitEvent('reference-file', { name: file.name, content: file.content })
}

async function deleteItem(file: FileEntry) {
  if (file.category === 'history') {
    const sessionId = String(file.metadata?.originalId || file.sourceSessionId || '')
    if (!sessionId) return
    if (!await confirmAction(`删除会话「${file.name}」？`)) return
    await sessionStore.deleteSession(sessionId)
    await loadTab()
    return
  }
  if (!await confirmAction(`删除文件「${file.name}」？`)) return
  await fileStore.deleteFile(file.id)
  await loadTab()
}

// ─── 右键菜单（P3.3：导出到文件夹） ───
const ctxMenu = ref<{ show: boolean; x: number; y: number; file: FileEntry | null }>({
  show: false, x: 0, y: 0, file: null,
})
// ponytail: 菜单边缘检测，靠近底部/右侧自动翻转
const SESSION_CTX_H = 120
const SESSION_CTX_W = 180
function onItemContextMenu(e: MouseEvent, file: FileEntry) {
  e.preventDefault()
  e.stopPropagation()
  let x = e.clientX
  let y = e.clientY
  if (y + SESSION_CTX_H > window.innerHeight) y = Math.max(0, window.innerHeight - SESSION_CTX_H - 8)
  if (x + SESSION_CTX_W > window.innerWidth) x = Math.max(0, window.innerWidth - SESSION_CTX_W - 8)
  ctxMenu.value = { show: true, x, y, file }
}
function closeCtxMenu() {
  ctxMenu.value.show = false
}
function onCtxMenuClick(e: MouseEvent) {
  // 点击菜单外部关闭
  if (!(e.target as HTMLElement).closest('.fp-ctx-menu')) closeCtxMenu()
}

async function renameCtxSession() {
  const file = ctxMenu.value.file
  if (!file || file.category !== 'history') return
  const ctxFile = file
  closeCtxMenu()
  const sessionId = String(ctxFile.metadata?.originalId || ctxFile.sourceSessionId || '')
  if (!sessionId) return
  // ponytail: safePrompt DOM overlay 在 Tauri 环境偶发不弹窗，加 fallback 到原生 prompt
  let newTitle: string | null = null
  try {
    newTitle = await safePrompt('重命名会话', ctxFile.name)
  } catch {
    // safePrompt 失败 → fallback 原生 prompt
  }
  if (!newTitle) {
    // 延迟调用原生 prompt 避免与 safePrompt overlay 冲突
    await new Promise(r => setTimeout(r, 100))
    newTitle = window.prompt('重命名会话', ctxFile.name)
  }
  if (newTitle && newTitle.trim() && newTitle.trim() !== ctxFile.name) {
    await sessionStore.renameSession(sessionId, newTitle.trim())
    emitEvent('rename-open-code-session', { sessionId, title: newTitle.trim() })
  }
}

async function viewSessionDetail() {
  const file = ctxMenu.value.file
  if (!file || file.category !== 'history') return
  closeCtxMenu()
  emitEvent('view-session-detail', { sessionId: file.metadata?.originalId || file.sourceSessionId || '' })
}

const offRefreshList = onEvent('refresh-file-list', (_payload: unknown) => {
  // ponytail: 只刷新当前 tab 的数据，不切换 tab。
  // 用户手动选择的 tab 不应被 refresh-file-list 事件覆盖。
  // 之前的行为: 收到 { category: 'history' } 就强制切到 history，
  // 导致用户在项目 tab 下发消息后立刻被切回会话列表。
  void loadTab()
})
const offSwitchFileTreeTab = onEvent('switch-filetree-tab', (tab: unknown) => {
  if (tab === 'history' || tab === 'project') switchTab(tab)
})
const offEditorChanged = onEvent('editor-file-changed', (payload: unknown) => {
  const p = payload as { fileId?: string | null }
  activeEditorFileId.value = p?.fileId || null
})

watch(activeTab, () => {
  searchQuery.value = ''
  void loadTab()
})

// 当选择项目后，自动切换到项目 Tab
watch(() => projectStore.hasProject.value, (has) => {
  if (has && isDesktop) {
    activeTab.value = 'project'
  } else if (!has && activeTab.value === 'project') {
    activeTab.value = 'history'
  }
})

onMounted(() => {
  void loadTab()
  document.addEventListener('click', onCtxMenuClick)
})

onBeforeUnmount(() => {
  offRefreshList()
  offSwitchFileTreeTab()
  offEditorChanged()
  document.removeEventListener('click', onCtxMenuClick)
})
</script>

<template>
  <aside class="fp">
    <!-- Tab 导航始终可见 -->
    <nav class="fp-tabs" aria-label="文件分类">
      <button
        v-for="tab in tabItems"
        :key="tab.key"
        class="fp-tab"
        :class="{ active: activeTab === tab.key }"
        @click="switchTab(tab.key)"
      >
        <JcIcon :name="tab.icon" />
        <span>{{ tab.label }}</span>
      </button>
    </nav>

    <!-- 项目 Tab：独立渲染 ProjectFileTree -->
    <ProjectFileTree v-if="activeTab === 'project'" />

    <template v-else>
    <div class="fp-search">
      <JcIcon name="search" />
      <input v-model="searchQuery" type="search" placeholder="搜索会话" />
      <button class="fp-icon-btn" title="刷新" @click="loadTab">
        <JcIcon name="refresh" />
      </button>
    </div>

    <div ref="listEl" class="fp-list">
      <div v-if="isRefreshing && activeTab !== 'history'" class="fp-empty">加载中...</div>
      <div v-else-if="filteredItems.length === 0" class="fp-empty">
        {{ (isRefreshing && activeTab === 'history') ? '加载中...' : (searchQuery ? '没有匹配结果' : '暂无内容') }}
      </div>
      <template v-else>
        <article
          v-for="item in filteredItems"
          :key="item.id"
          class="fp-item"
          :class="{ active: activeTab === 'history' ? item.sourceSessionId === sessionStore.activeSessionId : activeEditorFileId === item.id, history: item.category === 'history' }"
          @dblclick="openItem(item)"
          @contextmenu="onItemContextMenu($event, item)"
        >
          <button class="fp-item-main" @click="openItem(item)">
            <span class="fp-item-text">
              <strong>{{ item.name }}</strong>
              <small>
                {{ item.category === 'history' ? historySubtext(item) : formatTime(item.updatedAt) }}
              </small>
            </span>
          </button>
          <div class="fp-item-actions">
            <button title="引用到对话" @click.stop="referenceItem(item)">
              <JcIcon name="add_comment" />
            </button>
            <button title="删除" @click.stop="deleteItem(item)">
              <JcIcon name="delete" />
            </button>
          </div>
        </article>
      </template>
    </div>

    <!-- P3.3: 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="ctxMenu.show"
        class="fp-ctx-menu"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
        @click.stop
      >
        <button
          v-if="ctxMenu.file?.category === 'history'"
          class="fp-ctx-item"
          @click="renameCtxSession"
        >
          <JcIcon name="edit" />
          <span>重命名</span>
        </button>
        <button
          v-if="ctxMenu.file?.category === 'history'"
          class="fp-ctx-item"
          @click="viewSessionDetail"
        >
          <JcIcon name="info" />
          <span>查看详情</span>
        </button>
      </div>
    </Teleport>

    </template>
  </aside>
</template>

<style scoped>
.fp {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  color: var(--ink);
  overflow: hidden;
}
.fp-head {
  height: 52px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex: 0 0 auto;
}
.fp-head div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.fp-head strong {
  font-size: 14px;
  font-weight: 900;
}
.fp-head span {
  color: var(--ink3);
  font-size: 11px;
}
.fp-icon-btn,
.fp-item-actions button {
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--ink3);
  cursor: pointer;
}
.fp-icon-btn:hover,
.fp-item-actions button:hover {
  background: var(--olive-pale);
  color: var(--olive-dark);
}
.fp-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid var(--border);
}
.fp-tab {
  height: 34px;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--ink3);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}
.fp-tab .mso {
  font-size: 16px;
}
.fp-tab.active {
  background: rgba(213, 199, 135, 0.16);
  border-color: rgba(185, 171, 110, 0.28);
  color: var(--olive-dark);
}
.fp-search {
  height: 38px;
  margin: 8px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-alt);
}
.fp-search .mso {
  font-size: 16px;
  color: var(--ink3);
}
.fp-search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--ink);
  font-size: 13px;
}
.fp-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 8px 12px;
}
.fp-empty {
  padding: 28px 10px;
  color: var(--ink3);
  font-size: 13px;
  text-align: center;
}
.fp-item {
  display: flex;
  align-items: stretch;
  gap: 4px;
  border: 1px solid transparent;
  border-radius: 8px;
}
.fp-item.history {
  min-height: 66px;
}
.fp-item:hover,
.fp-item.active {
  background: rgba(213, 199, 135, 0.12);
  border-color: rgba(185, 171, 110, 0.2);
}
.fp-item-main {
  flex: 1;
  min-width: 0;
  min-height: 48px;
  padding: 7px 0;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.fp-item-icon {
  width: 26px;
  padding-top: 2px;
  flex: 0 0 auto;
  color: var(--olive-dark);
  font-size: 18px;
}
.fp-item-text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.fp-item-text strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 800;
  line-height: 1.25;
}
.fp-item-text small {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  color: var(--ink3);
  font-size: 11px;
  line-height: 1.32;
  word-break: break-word;
}
.fp-item-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
  padding-right: 4px;
  opacity: 0;
}
.fp-item:hover .fp-item-actions,
.fp-item.active .fp-item-actions {
  opacity: 1;
}
.fp-item-actions .mso {
  font-size: 16px;
}

/* P3.3: 右键菜单 */
.fp-ctx-menu {
  position: fixed;
  z-index: 9999;
  min-width: 160px;
  background: var(--paper);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
  padding: 4px;
  display: flex;
  flex-direction: column;
}
.fp-ctx-item {
  height: 34px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--ink);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}
.fp-ctx-item:hover {
  background: var(--surface-alt);
}
.fp-ctx-item .mso {
  font-size: 16px;
  color: var(--ink3);
}
</style>

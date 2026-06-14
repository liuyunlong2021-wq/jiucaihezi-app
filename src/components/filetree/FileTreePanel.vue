<script setup lang="ts">
/**
 * FileTreePanel — 文件面板（Col 2）
 * 保留会话、文本、画布三类本地文件视图。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useFileStore, type FileEntry } from '@/composables/useFileStore'
import { useSessionStore } from '@/stores/sessionStore'
import { createStarterCanvasDocument } from '@/stores/canvasStore'
import { emitEvent, onEvent } from '@/utils/eventBus'
import { confirmAction } from '@/utils/confirmAction'

const props = withDefaults(defineProps<{
  isMember?: boolean
}>(), {
  isMember: false,
})

type Tab = 'history' | 'text' | 'canvas'

const fileStore = useFileStore()
const sessionStore = useSessionStore()
const activeTab = ref<Tab>('history')
const searchQuery = ref('')
const items = ref<FileEntry[]>([])
const isRefreshing = ref(false)
const activeEditorFileId = ref<string | null>(null)
let loadRequestId = 0

const tabItems = computed(() => [
  { key: 'history' as const, icon: 'chat', label: '会话' },
  ...(props.isMember ? [
    { key: 'text' as const, icon: 'article', label: '文本' },
    { key: 'canvas' as const, icon: 'account_tree', label: '画布' },
  ] : []),
])

const filteredItems = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const source = q
    ? items.value.filter(item =>
      item.name.toLowerCase().includes(q) ||
      String(item.content || '').toLowerCase().includes(q)
    )
    : items.value
  return [...source].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
})

function canUseTab(tab: Tab): boolean {
  return tab === 'history' || props.isMember
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
  if (item.category === 'canvas') return 'account_tree'
  if (item.mimeType === 'folder') return 'folder'
  return 'description'
}

function buildHistoryItems(): FileEntry[] {
  return sessionStore.sessions.map(session => ({
    id: `history_ref_${session.id}`,
    category: 'history',
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
      messageCount: session.messageCount,
      messagePreview: session.preview || '',
    },
  }))
}

function historySubtext(item: FileEntry): string {
  const preview = String(item.metadata?.messagePreview || item.content || '').trim()
  if (preview) return preview
  return `${item.metadata?.messageCount || 0} 条消息`
}

async function loadTab() {
  const requestId = ++loadRequestId
  isRefreshing.value = true
  try {
    if (activeTab.value === 'history') {
      await sessionStore.loadAllSessions()
      if (requestId === loadRequestId) items.value = buildHistoryItems()
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
  activeTab.value = tab
}

async function createTextFile() {
  if (!props.isMember) return
  const name = prompt('新建文本文件名', '未命名.md')?.trim()
  if (!name) return
  const file = await fileStore.addText(name, '')
  await loadTab()
  openItem(file)
}

async function createCanvasFile() {
  if (!props.isMember) return
  const name = prompt('新建画布名称', '我的画布')?.trim() || '我的画布'
  const id = `canvas_${Date.now().toString(36)}`
  const doc = createStarterCanvasDocument(name, id)
  const file = await fileStore.addCanvas(name, JSON.stringify(doc))
  await loadTab()
  openItem(file)
}

function createItem() {
  if (activeTab.value === 'text') void createTextFile()
  if (activeTab.value === 'canvas') void createCanvasFile()
}

function openItem(file: FileEntry) {
  if (file.category === 'history') {
    const sessionId = String(file.metadata?.originalId || file.sourceSessionId || '')
    if (sessionId) {
      sessionStore.switchSession(sessionId)
      emitEvent('switch-panel', 'chat')
    }
    return
  }
  if (file.category === 'canvas') {
    emitEvent('open-canvas-document', { fileId: file.id, name: file.name, content: file.content })
    emitEvent('switch-workspace-mode', 'canvas')
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

const offRefreshList = onEvent('refresh-file-list', (payload: unknown) => {
  const category = (payload as { category?: Tab } | null)?.category
  if (category && canUseTab(category)) {
    if (activeTab.value !== category) {
      activeTab.value = category
    }
  }
  void loadTab()
})
const offSwitchFileTreeTab = onEvent('switch-filetree-tab', (tab: unknown) => {
  if (tab === 'history' || tab === 'text' || tab === 'canvas') switchTab(tab)
})
const offEditorChanged = onEvent('editor-file-changed', (payload: unknown) => {
  const p = payload as { fileId?: string | null }
  activeEditorFileId.value = p?.fileId || null
})

watch(activeTab, () => {
  searchQuery.value = ''
  void loadTab()
})

onMounted(() => {
  void loadTab()
})

onBeforeUnmount(() => {
  offRefreshList()
  offSwitchFileTreeTab()
  offEditorChanged()
})
</script>

<template>
  <aside class="fp">
    <header class="fp-head">
      <div>
        <strong>文件</strong>
        <span>{{ filteredItems.length }} 项</span>
      </div>
      <button class="fp-icon-btn" title="刷新" @click="loadTab">
        <span class="mso">refresh</span>
      </button>
    </header>

    <nav class="fp-tabs" aria-label="文件分类">
      <button
        v-for="tab in tabItems"
        :key="tab.key"
        class="fp-tab"
        :class="{ active: activeTab === tab.key }"
        @click="switchTab(tab.key)"
      >
        <span class="mso">{{ tab.icon }}</span>
        <span>{{ tab.label }}</span>
      </button>
    </nav>

    <div class="fp-search">
      <span class="mso">search</span>
      <input v-model="searchQuery" type="search" placeholder="搜索文件" />
    </div>

    <div v-if="activeTab !== 'history'" class="fp-actions">
      <button class="fp-action" @click="createItem">
        <span class="mso">add</span>
        <span>{{ activeTab === 'canvas' ? '新建画布' : '新建文本' }}</span>
      </button>
    </div>

    <div class="fp-list">
      <div v-if="isRefreshing" class="fp-empty">加载中...</div>
      <div v-else-if="filteredItems.length === 0" class="fp-empty">
        {{ searchQuery ? '没有匹配结果' : '暂无内容' }}
      </div>
      <template v-else>
        <article
          v-for="item in filteredItems"
          :key="item.id"
          class="fp-item"
          :class="{ active: activeEditorFileId === item.id }"
          @dblclick="openItem(item)"
        >
          <button class="fp-item-main" @click="openItem(item)">
            <span class="mso fp-item-icon">{{ iconFor(item) }}</span>
            <span class="fp-item-text">
              <strong>{{ item.name }}</strong>
              <small>
                {{ item.category === 'history' ? historySubtext(item) : formatTime(item.updatedAt) }}
              </small>
            </span>
          </button>
          <div class="fp-item-actions">
            <button title="引用到对话" @click.stop="referenceItem(item)">
              <span class="mso">add_comment</span>
            </button>
            <button title="删除" @click.stop="deleteItem(item)">
              <span class="mso">delete</span>
            </button>
          </div>
        </article>
      </template>
    </div>
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
  grid-template-columns: repeat(3, minmax(0, 1fr));
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
.fp-actions {
  padding: 0 8px 8px;
  flex: 0 0 auto;
}
.fp-action {
  width: 100%;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink2);
  font-weight: 800;
  cursor: pointer;
}
.fp-action:hover {
  border-color: var(--olive);
  color: var(--olive-dark);
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
  align-items: center;
  gap: 4px;
  border: 1px solid transparent;
  border-radius: 8px;
}
.fp-item:hover,
.fp-item.active {
  background: rgba(213, 199, 135, 0.12);
  border-color: rgba(185, 171, 110, 0.2);
}
.fp-item-main {
  flex: 1;
  min-width: 0;
  height: 48px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.fp-item-icon {
  width: 26px;
  flex: 0 0 auto;
  color: var(--olive-dark);
  font-size: 18px;
}
.fp-item-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.fp-item-text strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 800;
}
.fp-item-text small {
  color: var(--ink3);
  font-size: 11px;
}
.fp-item-actions {
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
</style>

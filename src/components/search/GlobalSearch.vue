<script setup lang="ts">
/**
 * GlobalSearch.vue — 全局搜索面板（Cmd/Ctrl+K 唤起）
 * 搜索范围：会话标题
 */
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useProjectStore } from '@/stores/projectStore'
import { emitEvent } from '@/utils/eventBus'
import { searchItems } from '@/utils/generalSearch'
import { createRuntimeProjectFileService } from '@/services/projectFileService'
import { openProjectResource } from '@/services/projectExplorerService'
import { inspectMemoryProject, type MemoryConversation } from '@/runtime/memory/memoryProject'
import type { ProjectResource } from '@/utils/projectResource'
import { isTauriRuntime } from '@/utils/tauriEnv'

const projectStore = useProjectStore()
const files = createRuntimeProjectFileService()

const visible = ref(false)
const query = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
const selectedIndex = ref(0)
const conversations = ref<MemoryConversation[]>([])
let returnFocusElement: HTMLElement | null = null
const projectOwner = computed(() => isTauriRuntime()
  ? projectStore.projectDir.value
  : projectStore.webProjectId.value)

interface SearchResult {
  type: 'conversation'
  id: string
  title: string
  resource: ProjectResource
  subtitle?: string
}

const results = computed<SearchResult[]>(() => {
  if (!query.value.trim()) return []

  const items = conversations.value.map(item => ({ name: item.transcript.title, item }))
  const matched = searchItems(query.value, items) as Array<{ item: MemoryConversation }>

  return matched.slice(0, 12).map(m => ({
    type: 'conversation' as const,
    id: m.item.transcript.id,
    title: m.item.transcript.title,
    resource: m.item.resource,
    subtitle: '',
  }))
})

const groupedResults = computed(() => {
  const groups: Record<string, SearchResult[]> = {
    conversation: [],
  }
  for (const r of results.value) {
    groups[r.type].push(r)
  }
  return groups.conversation.length ? [{ label: '会话', items: groups.conversation }] : []
})

const flatResults = computed(() => groupedResults.value.flatMap(g => g.items))

async function open() {
  returnFocusElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
  visible.value = true
  query.value = ''
  selectedIndex.value = 0
  nextTick(() => inputRef.value?.focus())
  try {
    conversations.value = projectOwner.value
      ? (await inspectMemoryProject(projectOwner.value, files)).conversations
      : []
  } catch {
    conversations.value = []
  }
}

function close() {
  visible.value = false
  query.value = ''
  const target = returnFocusElement
  returnFocusElement = null
  nextTick(() => {
    if (target?.isConnected) target.focus()
  })
}

async function selectItem(item: SearchResult) {
  close()
  const resource = await openProjectResource(files, item.resource)
  emitEvent('memory:open-resource', resource)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    close()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, flatResults.value.length - 1)
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
    return
  }
  if (e.key === 'Enter') {
    const item = flatResults.value[selectedIndex.value]
    if (item) void selectItem(item)
    return
  }
}

function onOverlayClick(e: MouseEvent) {
  if ((e.target as HTMLElement).classList.contains('gs-overlay')) {
    close()
  }
}

// 全局快捷键
function onGlobalKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    if (visible.value) {
      close()
    } else {
      open()
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="gs-overlay" @click="onOverlayClick">
      <div class="gs-panel" role="dialog" aria-modal="true" aria-label="搜索会话">
        <div class="gs-input-wrap">
          <JcIcon name="search" style="font-size:16px;color:var(--ink3)" />
          <input
            ref="inputRef"
            v-model="query"
            class="gs-input"
            placeholder="搜索会话..."
            role="searchbox"
            aria-label="搜索会话"
            aria-controls="global-search-results"
            :aria-activedescendant="flatResults.length ? `global-search-result-${selectedIndex}` : undefined"
            @keydown="onKeydown"
          />
          <kbd class="gs-kbd">esc</kbd>
        </div>

        <div v-if="query && groupedResults.length === 0" class="gs-empty">
          未找到匹配结果
        </div>

        <div v-else id="global-search-results" class="gs-results" role="listbox" aria-label="搜索结果">
          <template v-for="group in groupedResults" :key="group.label">
            <div class="gs-group-label">{{ group.label }}</div>
            <div
              v-for="(item, idx) in group.items"
              :key="item.id"
              :id="`global-search-result-${idx}`"
              class="gs-item"
              :class="{ selected: flatResults.indexOf(item) === selectedIndex }"
              role="option"
              :aria-selected="flatResults.indexOf(item) === selectedIndex"
              @click="selectItem(item)"
              @mouseenter="selectedIndex = flatResults.indexOf(item)"
            >
              <JcIcon name="chat_bubble" class="gs-item-icon" style="font-size:16px" />
              <div class="gs-item-text">
                <span class="gs-item-title">{{ item.title }}</span>
                <span v-if="item.subtitle" class="gs-item-sub">{{ item.subtitle }}</span>
              </div>
            </div>
          </template>
        </div>

        <div v-if="!query" class="gs-hint">
          <span>输入关键词搜索</span>
          <span class="gs-hint-keys"><kbd>↑↓</kbd> 导航 <kbd>↵</kbd> 选择 <kbd>esc</kbd> 关闭</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.gs-overlay {
  position: fixed; inset: 0; z-index: 10000;
  background: color-mix(in srgb, var(--jc-surface-dim) 74%, transparent);
  display: flex; justify-content: center;
  padding: 15vh 14px 20px;
  animation: gs-fade-in .15s ease;
}
@keyframes gs-fade-in { from { opacity: 0; } to { opacity: 1; } }

.gs-panel {
  width: min(520px, 100%); max-height: 60vh;
  border: 1px solid var(--jc-border);
  border-radius: 12px;
  background: var(--paper);
  box-shadow: 0 16px 48px var(--jc-shadow-color);
  display: flex; flex-direction: column;
  overflow: hidden;
  align-self: flex-start;
}

.gs-input-wrap {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
}
.gs-input {
  flex: 1; border: none; outline: none;
  font-size: 15px; font-family: inherit;
  background: transparent; color: var(--ink1);
}
.gs-input::placeholder { color: var(--ink3); }
.gs-kbd {
  padding: 2px 6px; border-radius: 4px;
  background: var(--surface); border: 1px solid var(--line);
  font-size: 10px; color: var(--ink3); font-weight: 600;
  font-family: inherit;
}

.gs-results { overflow-y: auto; flex: 1; }
.gs-group-label {
  padding: 6px 16px 2px;
  font-size: 10px; font-weight: 700; color: var(--ink3);
  text-transform: uppercase; letter-spacing: .5px;
}
.gs-item {
  display: flex; align-items: center; gap: 10px;
  min-height: 40px; padding: 8px 16px; cursor: pointer;
  transition: background var(--jc-transition-fast), color var(--jc-transition-fast);
}
.gs-item:hover, .gs-item.selected { background: color-mix(in srgb, var(--jc-primary) 9%, transparent); }
.gs-item:focus-visible { outline: 2px solid var(--jc-focus-ring); outline-offset: -2px; }
.gs-item-icon { color: var(--olive); flex-shrink: 0; }
.gs-item-text { display: flex; flex-direction: column; min-width: 0; }
.gs-item-title {
  font-size: 13px; font-weight: 600; color: var(--ink1);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.gs-item-sub {
  font-size: 11px; color: var(--ink3);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.gs-empty {
  padding: 32px 16px; text-align: center;
  font-size: 13px; color: var(--ink3);
}

.gs-hint {
  display: flex; justify-content: space-between;
  padding: 8px 16px; border-top: 1px solid var(--line);
  font-size: 11px; color: var(--ink3);
}
.gs-hint-keys { display: flex; align-items: center; gap: 4px; }
.gs-hint kbd {
  padding: 1px 4px; border-radius: 3px;
  background: var(--surface); border: 1px solid var(--line);
  font-size: 10px; color: var(--ink2); font-family: inherit;
}
</style>

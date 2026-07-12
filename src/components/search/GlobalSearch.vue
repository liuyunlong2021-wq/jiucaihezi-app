<script setup lang="ts">
/**
 * GlobalSearch.vue — 全局搜索面板（Cmd/Ctrl+K 唤起）
 * 搜索范围：会话标题
 */
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useSessionStore } from '@/stores/sessionStore'
import { emitEvent } from '@/utils/eventBus'
import { searchItems } from '@/utils/generalSearch'

const sessionStore = useSessionStore()

const visible = ref(false)
const query = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
const selectedIndex = ref(0)

interface SearchResult {
  type: 'session'
  id: string
  title: string
  subtitle?: string
}

const results = computed<SearchResult[]>(() => {
  if (!query.value.trim()) return []

  const sessions = sessionStore.projectSessions.map(s => ({ name: s.title, _s: s }))
  const matched = searchItems(query.value, sessions) as any[]

  return matched.slice(0, 12).map((m: any) => ({
    type: 'session' as const,
    id: m._s.id,
    title: m._s.title,
    subtitle: '',
  }))
})

const groupedResults = computed(() => {
  const groups: Record<string, SearchResult[]> = {
    session: [],
  }
  for (const r of results.value) {
    groups[r.type].push(r)
  }
  return [
    ...(groups.session.length ? [{ label: '会话', items: groups.session }] : []),
  ]
})

const flatResults = computed(() => groupedResults.value.flatMap(g => g.items))

function open() {
  visible.value = true
  query.value = ''
  selectedIndex.value = 0
  nextTick(() => inputRef.value?.focus())
}

function close() {
  visible.value = false
  query.value = ''
}

function selectItem(item: SearchResult) {
  close()
  if (item.type === 'session') {
    sessionStore.switchSession(item.id)
    emitEvent('switch-panel', 'chat')
  }
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
    if (item) selectItem(item)
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
      <div class="gs-panel">
        <div class="gs-input-wrap">
          <JcIcon name="search" style="font-size:16px;color:var(--ink3)" />
          <input
            ref="inputRef"
            v-model="query"
            class="gs-input"
            placeholder="搜索会话..."
            @keydown="onKeydown"
          />
          <kbd class="gs-kbd">esc</kbd>
        </div>

        <div v-if="query && groupedResults.length === 0" class="gs-empty">
          未找到匹配结果
        </div>

        <div v-else class="gs-results">
          <template v-for="group in groupedResults" :key="group.label">
            <div class="gs-group-label">{{ group.label }}</div>
            <div
              v-for="(item, idx) in group.items"
              :key="item.id"
              class="gs-item"
              :class="{ selected: flatResults.indexOf(item) === selectedIndex }"
              @click="selectItem(item)"
              @mouseenter="selectedIndex = flatResults.indexOf(item)"
            >
              <JcIcon :name="item.type === 'session' ? 'chat_bubble' : 'folder_special'" class="gs-item-icon" style="font-size:16px" />
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
  background: rgba(0,0,0,.4);
  display: flex; justify-content: center;
  padding-top: 15vh;
  animation: gs-fade-in .15s ease;
}
@keyframes gs-fade-in { from { opacity: 0; } to { opacity: 1; } }

.gs-panel {
  width: 520px; max-height: 60vh;
  border-radius: 12px;
  background: var(--paper);
  box-shadow: 0 16px 48px rgba(0,0,0,.2);
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
  padding: 8px 16px; cursor: pointer;
  transition: background .1s;
}
.gs-item:hover, .gs-item.selected { background: rgba(107,142,35,.08); }
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

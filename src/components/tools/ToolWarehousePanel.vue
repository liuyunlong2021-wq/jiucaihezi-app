<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useToolStore } from '@/stores/toolStore'
import { clearDevProjectRoot, getDevProjectRoot, selectDevProjectRoot } from '@/utils/devProjectTools'
import { consumeLastEvent, onEvent } from '@/utils/eventBus'
import FormatConverterPanel from './FormatConverterPanel.vue'
import MediaUrlCapturePanel from './MediaUrlCapturePanel.vue'
import MediaWorkbenchPanel from './MediaWorkbenchPanel.vue'
import McpManagerPanel from '@/components/mcp/McpManagerPanel.vue'

type MediaWorkbenchMode = 'info' | 'text' | 'convert' | 'caption'

const props = withDefaults(defineProps<{ isMember?: boolean }>(), { isMember: true })
const toolStore = useToolStore()
const filter = ref('')
const categoryFilter = ref('全部')
const devProjectRoot = ref(getDevProjectRoot())
const activeTool = ref('')
const gateMessage = ref('')
const activeMediaMode = ref<MediaWorkbenchMode>('info')
const OPEN_EXTERNAL_EXTENSIONS_EVENT = 'open-external-tool-extensions'

const mediaWorkbenchModes: Record<string, MediaWorkbenchMode> = {
  local_media_inspect: 'info',
  local_media_transcribe: 'text',
  local_media_process: 'convert',
  local_subtitle_burn: 'caption',
}

const devProjectName = computed(() => {
  const parts = devProjectRoot.value.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) || ''
})

const categories = computed(() => {
  const list = Array.from(new Set(toolStore.cards.map(card => card.category)))
  return ['全部', ...list]
})

const filteredCards = computed(() => {
  const q = filter.value.trim().toLowerCase()
  return toolStore.cards.filter(card => {
    const matchesCategory = categoryFilter.value === '全部' || card.category === categoryFilter.value
    if (!matchesCategory) return false
    if (!q) return true
    return (
      card.name.toLowerCase().includes(q) ||
      card.description.toLowerCase().includes(q) ||
      card.tags.some(tag => tag.toLowerCase().includes(q)) ||
      card.aliases.some(alias => alias.toLowerCase().includes(q))
    )
  })
})

function statusLabel(card: (typeof toolStore.cards)[number]) {
  const activity = card.activity
  if (activity?.active) return '调用中'
  if (activity?.status === 'error') return '上次失败'
  if (activity?.status === 'done') return '可用'
  return '待命'
}

function riskLabel(risk: string) {
  if (risk === 'approval') return '需确认'
  if (risk === 'write') return '可生成'
  return '自动可用'
}

function formatTime(value?: number | null) {
  if (!value) return ''
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function requireMemberAction(): boolean {
  if (props.isMember) return true
  gateMessage.value = '请登录后使用此功能'
  return false
}

async function chooseDevProject() {
  if (!requireMemberAction()) return
  const root = await selectDevProjectRoot()
  devProjectRoot.value = root
}

function clearDevProject() {
  if (!requireMemberAction()) return
  clearDevProjectRoot()
  devProjectRoot.value = ''
}

function runTool(cardId: string) {
  if (!requireMemberAction()) return
  if (cardId === 'document_to_markdown') {
    activeTool.value = cardId
  }
  if (cardId === 'local_media_url_download') {
    activeTool.value = cardId
  }
  const mediaMode = mediaWorkbenchModes[cardId]
  if (mediaMode) {
    activeMediaMode.value = mediaMode
    activeTool.value = 'media_workbench'
  }
}

function openExternalToolExtensions() {
  if (!requireMemberAction()) return
  activeTool.value = 'external_tool_extensions'
}

if (consumeLastEvent(OPEN_EXTERNAL_EXTENSIONS_EVENT)) {
  openExternalToolExtensions()
}

const offOpenExternalExtensions = onEvent(OPEN_EXTERNAL_EXTENSIONS_EVENT, () => {
  openExternalToolExtensions()
})

onBeforeUnmount(() => {
  offOpenExternalExtensions()
})

function canRunDirectly(cardId: string) {
  return cardId === 'document_to_markdown' || cardId === 'local_media_url_download' || Boolean(mediaWorkbenchModes[cardId])
}
</script>

<template>
  <FormatConverterPanel
    v-if="activeTool === 'document_to_markdown'"
    @back="activeTool = ''"
  />
  <MediaUrlCapturePanel
    v-else-if="activeTool === 'local_media_url_download'"
    @back="activeTool = ''"
  />
  <MediaWorkbenchPanel
    v-else-if="activeTool === 'media_workbench'"
    :initial-mode="activeMediaMode"
    @back="activeTool = ''"
  />
  <div v-else-if="activeTool === 'external_tool_extensions'" class="tw-extension-panel">
    <div class="tw-subhead">
      <button class="tw-back" title="返回工具仓库" @click="activeTool = ''">
        <JcIcon name="arrow_back" />
      </button>
      <div>
        <h3>外部工具扩展</h3>
        <p>高级用户入口。连接后仍需显式启用工具，才会进入本轮模型工具池。</p>
      </div>
    </div>
    <McpManagerPanel />
  </div>
  <div v-else class="tw">
    <div class="tw-head">
      <h3>工具仓库</h3>
      <div class="tw-capability" title="OpenCode 被动工具由官方运行时管理；这里只展示能力和提供独立入口。">
        <JcIcon name="account_tree" />
        <span>OpenCode 被动工具由官方运行时管理</span>
      </div>
      <div class="tw-search">
        <JcIcon name="search" />
        <input v-model="filter" type="text" placeholder="搜索工具..." />
      </div>
    </div>

    <div class="tw-tabs" aria-label="工具分类">
      <button
        v-for="category in categories"
        :key="category"
        class="tw-tab"
        :class="{ active: categoryFilter === category }"
        @click="categoryFilter = category"
      >
        {{ category }}
      </button>
    </div>

    <!-- 项目选择已移至对话面板顶栏 -->
    <div v-if="gateMessage" class="tw-gate">{{ gateMessage }}</div>

    <div class="tw-scroll">
      <div class="tw-section">
        <div class="tw-section-title">
          <span>高级扩展</span>
        </div>
        <button class="tw-extension-entry" @click="openExternalToolExtensions">
          <JcIcon name="extension" class="tw-extension-icon" />
          <span class="tw-extension-copy">
            <strong>外部工具扩展</strong>
            <span>连接 GitHub 等外部系统。仅在需要额外工具时配置。</span>
          </span>
          <JcIcon name="chevron_right" class="tw-extension-arrow" />
        </button>
      </div>

      <div class="tw-section">
        <div class="tw-section-title">
          <span>本地与办公能力</span>
          <span v-if="toolStore.activeTools.length" class="tw-active-count">
            {{ toolStore.activeTools.length }} 个调用中
          </span>
        </div>

        <div class="tw-list">
          <div
            v-for="card in filteredCards"
            :key="card.id"
            class="tw-card"
            :class="{
              active: card.activity?.active,
              error: card.activity?.status === 'error',
            }"
          >
            <div class="tw-card-head">
              <JcIcon :name="card.icon" class="tw-icon" />
              <span class="tw-name">{{ card.name }}</span>
              <span class="tw-status" :class="{ running: card.activity?.active, error: card.activity?.status === 'error' }">
                {{ statusLabel(card) }}
              </span>
            </div>

            <div class="tw-desc">{{ card.description }}</div>

            <div class="tw-meta">
              <span class="tw-chip">{{ riskLabel(card.risk) }}</span>
              <span v-if="card.activity?.callCount" class="tw-chip strong">
                {{ card.activity.callCount }} 次
              </span>
              <span v-if="card.activity?.lastFinishedAt" class="tw-chip">
                {{ formatTime(card.activity.lastFinishedAt) }}
              </span>
            </div>

            <div v-if="card.activity?.lastDetail" class="tw-last">
              {{ card.activity.lastDetail }}
            </div>
            <div v-else class="tw-tags">
              <span v-for="tag in card.tags" :key="tag" class="tw-tag">{{ tag }}</span>
            </div>

            <div v-if="card.activity?.lastError" class="tw-error-text">
              {{ card.activity.lastError }}
            </div>

            <button
              v-if="card.id === 'local_media_url_download' || canRunDirectly(card.id)"
              class="tw-run"
              @click="runTool(card.id)"
            >
              运行
            </button>
          </div>

          <div v-if="filteredCards.length === 0" class="tw-empty">没有匹配的工具</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tw {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--surface);
}
.tw-extension-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--surface);
}
.tw-subhead {
  min-height: 58px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  gap: 10px;
  box-sizing: border-box;
  flex-shrink: 0;
}
.tw-subhead h3 {
  margin: 0;
  color: var(--ink1);
  font-size: 15px;
  font-weight: 900;
}
.tw-subhead p {
  margin: 3px 0 0;
  color: var(--ink3);
  font-size: 11px;
  line-height: 1.4;
}
.tw-back {
  width: 32px;
  height: 32px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--paper);
  color: var(--ink2);
  display: grid;
  place-items: center;
  cursor: pointer;
  flex-shrink: 0;
}
.tw-back:hover {
  border-color: var(--olive);
  color: var(--olive-dark);
  background: rgba(213,199,135,.14);
}
.tw-back .mso {
  font-size: 18px;
}
.tw-head {
  min-height: 49px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  gap: 10px;
  box-sizing: border-box;
}
.tw-head h3 {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink1);
  margin: 0;
  flex-shrink: 0;
}
.tw-capability {
  border: 1px solid var(--line);
  background: var(--paper);
  color: var(--ink2);
  border-radius: 6px;
  padding: 4px 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 700;
  font-family: inherit;
  white-space: nowrap;
  cursor: default;
}
.tw-capability .mso {
  font-size: 17px;
  line-height: 1;
}
.tw-search {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--bg);
}
.tw-search .mso {
  font-size: 14px;
  color: var(--ink3);
}
.tw-search input {
  width: 100%;
  min-width: 0;
  border: none;
  background: none;
  outline: none;
  font-size: 12px;
  color: var(--ink1);
  font-family: inherit;
}
.tw-tabs {
  display: flex;
  gap: 6px;
  padding: 8px 12px 0;
  overflow-x: auto;
}
.tw-tab {
  border: 1px solid var(--line);
  background: var(--paper);
  color: var(--ink2);
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 11px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.tw-tab.active,
.tw-tab:hover {
  border-color: var(--olive);
  color: var(--olive-dark);
  background: rgba(213,199,135,.14);
}
.tw-project {
  margin: 8px 12px 0;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  display: flex;
  align-items: center;
  gap: 8px;
}
.tw-project-main {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}
.tw-project-main .mso {
  color: var(--olive-dark);
  font-size: 18px;
  flex-shrink: 0;
}
.tw-project-text {
  min-width: 0;
  display: grid;
  gap: 2px;
}
.tw-project-text strong {
  min-width: 0;
  color: var(--ink1);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tw-project-text span {
  color: var(--ink3);
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tw-project-btn,
.tw-project-icon {
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink2);
  border-radius: 6px;
  font-family: inherit;
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
}
.tw-project-btn {
  padding: 5px 8px;
  font-size: 11px;
}
.tw-project-icon {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
}
.tw-project-icon .mso {
  font-size: 15px;
}
.tw-project-btn:hover,
.tw-project-icon:hover {
  border-color: var(--olive);
  color: var(--olive-dark);
  background: rgba(107,142,35,.06);
}
.tw-gate {
  margin: 8px 12px 0;
  padding: 7px 9px;
  border: 1px solid rgba(185, 28, 28, .22);
  border-radius: 6px;
  background: rgba(185, 28, 28, .06);
  color: var(--jc-error);
  font-size: 12px;
}
.tw-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px 20px;
}
.tw-section {
  margin-bottom: 20px;
}
.tw-section-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--ink1);
  letter-spacing: 0.04em;
  padding: 8px 0;
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 2px solid var(--line);
  margin-bottom: 10px;
}
.tw-extension-entry {
  width: 100%;
  min-height: 76px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink1);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  box-sizing: border-box;
}
.tw-extension-entry:hover {
  border-color: var(--olive);
  background: rgba(213,199,135,.11);
}
.tw-extension-icon {
  width: 34px;
  height: 34px;
  border-radius: 7px;
  background: rgba(107,142,35,.09);
  color: var(--olive-dark);
  display: grid;
  place-items: center;
  font-size: 20px;
  flex-shrink: 0;
}
.tw-extension-copy {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 3px;
}
.tw-extension-copy strong {
  color: var(--ink1);
  font-size: 13px;
  font-weight: 900;
}
.tw-extension-copy span {
  color: var(--ink3);
  font-size: 11px;
  line-height: 1.45;
}
.tw-extension-arrow {
  color: var(--ink3);
  font-size: 18px;
  flex-shrink: 0;
}
.tw-active-count {
  margin-left: auto;
  font-size: 10px;
  color: var(--olive-dark);
  background: rgba(107,142,35,.1);
  padding: 2px 6px;
  border-radius: 4px;
  letter-spacing: 0;
}
.tw-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}
.tw-card {
  min-height: 140px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 2px solid rgba(0,0,0,.12);
  background: var(--paper);
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: all .15s;
  box-shadow: 0 1px 3px rgba(0,0,0,.04);
  box-sizing: border-box;
}
.tw-card:hover {
  border-color: var(--olive);
  box-shadow: 0 4px 12px rgba(0,0,0,.08);
  transform: translateY(-1px);
}
.tw-card.active {
  border-color: var(--olive);
  background: rgba(107,142,35,.07);
  box-shadow: 0 0 0 3px rgba(107,142,35,.08);
}
.tw-card.error {
  border-color: rgba(198,40,40,.45);
}
.tw-card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.tw-icon {
  font-size: 18px;
  color: var(--olive-dark);
  flex-shrink: 0;
}
.tw-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--ink1);
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.tw-status {
  font-size: 10px;
  color: var(--ink3);
  background: var(--surface-alt);
  padding: 2px 5px;
  border-radius: 4px;
  white-space: nowrap;
}
.tw-status.running {
  color: #2e7d32;
  background: #e8f5e9;
}
.tw-status.error {
  color: #c62828;
  background: #ffebee;
}
.tw-desc {
  font-size: 12px;
  color: var(--ink2);
  line-height: 1.5;
}
.tw-meta,
.tw-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.tw-chip,
.tw-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(213,199,135,.12);
  color: var(--olive-dark);
  font-weight: 600;
}
.tw-chip.strong {
  background: rgba(107,142,35,.1);
  color: var(--olive);
}
.tw-last {
  margin-top: auto;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--surface-alt);
  color: var(--ink2);
  font-size: 11px;
  line-height: 1.35;
  overflow-wrap: anywhere;
  max-height: 46px;
  overflow: hidden;
}
.tw-error-text {
  font-size: 11px;
  color: #c62828;
  overflow-wrap: anywhere;
}
.tw-run {
  margin-top: auto;
  width: 100%;
  border: 1px solid rgba(107,142,35,.36);
  background: rgba(107,142,35,.1);
  color: var(--olive-dark);
  border-radius: 7px;
  padding: 7px 10px;
  font-size: 12px;
  font-weight: 800;
  font-family: inherit;
  cursor: pointer;
}
.tw-run:hover {
  background: rgba(107,142,35,.16);
  border-color: var(--olive);
}
.tw-empty {
  text-align: center;
  padding: 20px;
  font-size: 12px;
  color: var(--ink3);
  grid-column: 1 / -1;
}
</style>

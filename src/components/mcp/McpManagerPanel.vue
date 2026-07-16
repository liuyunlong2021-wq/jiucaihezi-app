<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMcpStore, type McpServerConfig } from '@/stores/mcpStore'
import { connectMcpServer, disconnectMcpServer } from '@/services/mcpClient'
import { BUILTIN_MCP_CATALOG, type BuiltinMcpCatalogEntry } from '@/data/mcpCatalog'
import { confirmAction } from '@/utils/confirmAction'

type ViewMode = 'grid' | 'list'
type CatalogCard = BuiltinMcpCatalogEntry & {
  installed: boolean
  server?: McpServerConfig
}

const mcpStore = useMcpStore()
const search = ref('')
const category = ref('全部')
const viewMode = ref<ViewMode>('grid')
const message = ref('')
const connectingId = ref('')

const configuredIds = computed(() => new Set(mcpStore.servers.map(server => server.id)))

const catalogCards = computed<CatalogCard[]>(() =>
  BUILTIN_MCP_CATALOG.map(entry => ({
    ...entry,
    installed: configuredIds.value.has(entry.id),
    server: mcpStore.servers.find(server => server.id === entry.id),
  })),
)

const customServers = computed(() =>
  mcpStore.servers.filter(server => !BUILTIN_MCP_CATALOG.some(entry => entry.id === server.id)),
)

const categories = computed(() => [
  '全部',
  ...Array.from(new Set(BUILTIN_MCP_CATALOG.map(entry => entry.category))),
  ...(customServers.value.length ? ['自定义'] : []),
])

const filteredCatalogCards = computed(() => {
  const q = search.value.trim().toLowerCase()
  return catalogCards.value.filter(card => {
    if (category.value !== '全部' && card.category !== category.value) return false
    if (!q) return true
    return [
      card.name,
      card.description,
      card.category,
      card.transport,
      card.installHint,
      ...card.tasks,
    ].some(value => String(value).toLowerCase().includes(q))
  })
})

const filteredCustomServers = computed(() => {
  if (category.value !== '全部' && category.value !== '自定义') return []
  const q = search.value.trim().toLowerCase()
  if (!q) return customServers.value
  return customServers.value.filter(server =>
    [server.name, server.transport, server.url, server.command, ...(server.args || [])]
      .some(value => String(value || '').toLowerCase().includes(q)),
  )
})

function authLabel(auth: BuiltinMcpCatalogEntry['auth']) {
  if (auth === 'none') return '无需登录'
  if (auth === 'token') return '需要 Token'
  if (auth === 'oauth') return '需要 OAuth'
  return '需要配置'
}

function riskLabel(risk: BuiltinMcpCatalogEntry['risk']) {
  if (risk === 'high') return '高权限'
  if (risk === 'medium') return '需确认'
  return '低风险'
}

function transportLabel(transport: BuiltinMcpCatalogEntry['transport'] | McpServerConfig['transport']) {
  if (transport === 'stdio') return '本地 stdio'
  if (transport === 'sse') return '远程 SSE'
  return '韭菜盒子'
}

function statusLabel(server?: McpServerConfig) {
  if (!server) return '未安装'
  if (server.status === 'connected') return '运行中'
  if (server.status === 'connecting') return '连接中'
  if (server.status === 'error') return '异常'
  return server.enabled ? '已启用' : '已安装'
}

function statusClass(server?: McpServerConfig) {
  if (!server) return 'idle'
  if (server.status === 'connected') return 'running'
  if (server.status === 'connecting') return 'running'
  if (server.status === 'error') return 'error'
  return server.enabled ? 'enabled' : 'idle'
}

async function addFromCatalog(entry: BuiltinMcpCatalogEntry) {
  message.value = ''
  if (configuredIds.value.has(entry.id)) {
    message.value = `「${entry.name}」已经在外部工具扩展中。`
    return
  }

  const { safePrompt } = await import('@/utils/safePrompt')
  let config: Omit<McpServerConfig, 'status' | 'error' | 'enabled'>
  if (entry.transport === 'sse' || entry.transport === 'remote') {
    const url = await safePrompt(`配置「${entry.name}」连接地址`, entry.url || '')
    if (!url) return
    config = {
      id: entry.id,
      name: entry.name,
      transport: 'sse',
      url: url.trim(),
    }
  } else {
    const command = await safePrompt(`配置「${entry.name}」启动命令`, entry.command || '')
    if (!command) return
    const argsText = await safePrompt('启动参数（空格分隔）', (entry.args || []).join(' ')) || ''
    config = {
      id: entry.id,
      name: entry.name,
      transport: 'stdio',
      command: command.trim(),
      args: argsText.split(/\s+/).map(part => part.trim()).filter(Boolean),
    }
  }

  mcpStore.addServer(config)
  message.value = `已加入外部工具扩展：${entry.name}。启用后才会连接并暴露工具。`
}

async function toggleServer(server: McpServerConfig) {
  message.value = ''
  if (connectingId.value) return
  if (server.enabled && server.status === 'connected') {
    await disconnectMcpServer(server.id)
    mcpStore.toggleServer(server.id)
    message.value = `已停用 ${server.name}。`
    return
  }

  if (!server.enabled) mcpStore.toggleServer(server.id)
  connectingId.value = server.id
  mcpStore.setServerStatus(server.id, 'connecting')
  try {
    const tools = await connectMcpServer(server)
    mcpStore.setServerTools(server.id, tools)
    mcpStore.setServerStatus(server.id, 'connected')
    message.value = `${server.name} 已连接，发现 ${tools.length} 个外部工具。`
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    mcpStore.setServerStatus(server.id, 'error', errMsg)
    message.value = `${server.name} 连接失败：${errMsg}`
  } finally {
    connectingId.value = ''
  }
}

async function removeServer(server: McpServerConfig) {
  if (!await confirmAction(`删除外部工具扩展「${server.name}」？`)) return
  await disconnectMcpServer(server.id)
  mcpStore.removeServer(server.id)
  message.value = `已从外部工具扩展删除：${server.name}。`
}
</script>

<template>
  <section class="mcp-panel">
    <header class="mcp-head">
      <div>
        <h3>外部工具扩展</h3>
        <p>连接外部系统提供的工具。安装不等于暴露给模型，启用后才进入工具池。</p>
      </div>
      <div class="mcp-view-toggle" aria-label="视图切换">
        <button :class="{ active: viewMode === 'grid' }" title="卡片视图" @click="viewMode = 'grid'">
          <JcIcon name="grid_view" />
        </button>
        <button :class="{ active: viewMode === 'list' }" title="列表视图" @click="viewMode = 'list'">
          <JcIcon name="view_list" />
        </button>
      </div>
    </header>

    <div class="mcp-controls">
      <div class="mcp-search">
        <JcIcon name="search" />
        <input v-model="search" type="text" placeholder="搜索扩展工具..." />
      </div>
      <select v-model="category" class="mcp-category" aria-label="扩展分类">
        <option v-for="item in categories" :key="item" :value="item">{{ item }}</option>
      </select>
    </div>

    <div v-if="message" class="mcp-message">{{ message }}</div>

    <div class="mcp-scroll">
      <div class="mcp-section">
        <div class="mcp-section-title">
          <span>可添加扩展</span>
          <span>{{ filteredCatalogCards.length }} 个</span>
        </div>
        <div class="mcp-card-list" :class="viewMode">
          <article
            v-for="card in filteredCatalogCards"
            :key="card.id"
            class="mcp-card"
            :class="[statusClass(card.server), { installed: card.installed }]"
          >
            <div class="mcp-card-top">
              <JcIcon :name="card.icon" class="mcp-card-icon" />
              <div class="mcp-card-name">
                <strong>{{ card.name }}</strong>
                <span>{{ card.category }} · {{ transportLabel(card.transport) }}</span>
              </div>
              <span class="mcp-status" :class="statusClass(card.server)">{{ statusLabel(card.server) }}</span>
            </div>

            <p class="mcp-desc">{{ card.description }}</p>

            <div class="mcp-tags">
              <span>{{ authLabel(card.auth) }}</span>
              <span :class="{ danger: card.risk === 'high' }">{{ riskLabel(card.risk) }}</span>
            </div>

            <div class="mcp-tasks">
              <span v-for="task in card.tasks.slice(0, 3)" :key="task">{{ task }}</span>
            </div>

            <div class="mcp-hint">{{ card.installHint }}</div>

            <div class="mcp-actions">
              <button
                v-if="!card.installed"
                class="mcp-primary"
                @click="addFromCatalog(card)"
              >
                加入仓库
              </button>
              <template v-else-if="card.server">
                <button class="mcp-primary" :disabled="connectingId === card.server.id" @click="toggleServer(card.server)">
                  {{ card.server.status === 'connected' ? '停用' : '启用' }}
                </button>
                <button class="mcp-ghost" @click="removeServer(card.server)">删除</button>
              </template>
            </div>
          </article>
        </div>
      </div>

      <div v-if="filteredCustomServers.length" class="mcp-section">
        <div class="mcp-section-title">
          <span>自定义扩展</span>
          <span>{{ filteredCustomServers.length }} 个</span>
        </div>
        <div class="mcp-card-list" :class="viewMode">
          <article v-for="server in filteredCustomServers" :key="server.id" class="mcp-card custom" :class="statusClass(server)">
            <div class="mcp-card-top">
              <JcIcon name="extension" class="mcp-card-icon" />
              <div class="mcp-card-name">
                <strong>{{ server.name }}</strong>
                <span>{{ transportLabel(server.transport) }}</span>
              </div>
              <span class="mcp-status" :class="statusClass(server)">{{ statusLabel(server) }}</span>
            </div>
            <p class="mcp-desc">{{ server.url || [server.command, ...(server.args || [])].filter(Boolean).join(' ') }}</p>
            <div v-if="server.error" class="mcp-error">{{ server.error }}</div>
            <div class="mcp-actions">
              <button class="mcp-primary" :disabled="connectingId === server.id" @click="toggleServer(server)">
                {{ server.status === 'connected' ? '停用' : '启用' }}
              </button>
              <button class="mcp-ghost" @click="removeServer(server)">删除</button>
            </div>
          </article>
        </div>
      </div>

      <div v-if="!filteredCatalogCards.length && !filteredCustomServers.length" class="mcp-empty">
        没有匹配的扩展
      </div>
    </div>
  </section>
</template>

<style scoped>
.mcp-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--surface);
}
.mcp-head {
  min-height: 58px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  gap: 12px;
  box-sizing: border-box;
}
.mcp-head div:first-child {
  min-width: 0;
  flex: 1;
}
.mcp-head h3 {
  margin: 0;
  color: var(--ink1);
  font-size: 15px;
  font-weight: 900;
}
.mcp-head p {
  margin: 3px 0 0;
  color: var(--ink3);
  font-size: 11px;
  line-height: 1.4;
}
.mcp-view-toggle {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--paper);
}
.mcp-view-toggle button {
  width: 28px;
  height: 26px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--ink3);
  cursor: pointer;
}
.mcp-view-toggle button.active,
.mcp-view-toggle button:hover {
  background: rgba(213, 199, 135, 0.16);
  color: var(--olive-dark);
}
.mcp-view-toggle .mso {
  font-size: 16px;
}
.mcp-controls {
  padding: 10px 12px 0;
  display: flex;
  gap: 8px;
}
.mcp-search {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 6px 8px;
  background: var(--bg);
}
.mcp-search .mso {
  color: var(--ink3);
  font-size: 15px;
}
.mcp-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ink1);
  font-size: 12px;
  font-family: inherit;
}
.mcp-category {
  width: 96px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--paper);
  color: var(--ink2);
  font-size: 12px;
  font-weight: 800;
  font-family: inherit;
}
.mcp-message {
  margin: 8px 12px 0;
  padding: 7px 9px;
  border: 1px solid rgba(107, 142, 35, 0.22);
  border-radius: 7px;
  background: rgba(107, 142, 35, 0.07);
  color: var(--olive-dark);
  font-size: 12px;
  line-height: 1.45;
}
.mcp-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px 20px;
}
.mcp-section {
  margin-bottom: 18px;
}
.mcp-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 0;
  margin-bottom: 10px;
  border-bottom: 2px solid var(--line);
  color: var(--ink1);
  font-size: 12px;
  font-weight: 900;
}
.mcp-section-title span:last-child {
  color: var(--ink3);
  font-size: 10px;
  font-weight: 800;
}
.mcp-card-list.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 10px;
}
.mcp-card-list.list {
  display: grid;
  gap: 8px;
}
.mcp-card {
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  padding: 12px;
  display: grid;
  gap: 8px;
  box-sizing: border-box;
}
.mcp-card.running {
  border-color: rgba(46, 125, 50, 0.42);
  background: rgba(46, 125, 50, 0.04);
}
.mcp-card.error {
  border-color: rgba(198, 40, 40, 0.42);
}
.mcp-card-top {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.mcp-card-icon {
  color: var(--olive-dark);
  font-size: 20px;
  flex-shrink: 0;
}
.mcp-card-name {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 2px;
}
.mcp-card-name strong {
  color: var(--ink1);
  font-size: 13px;
  font-weight: 900;
  overflow-wrap: anywhere;
}
.mcp-card-name span {
  color: var(--ink3);
  font-size: 10px;
  font-weight: 800;
}
.mcp-status {
  flex: 0 0 auto;
  padding: 3px 6px;
  border-radius: 999px;
  background: var(--surface-alt);
  color: var(--ink3);
  font-size: 10px;
  font-weight: 900;
  white-space: nowrap;
}
.mcp-status.running,
.mcp-status.enabled {
  background: rgba(46, 125, 50, 0.1);
  color: #2e7d32;
}
.mcp-status.error {
  background: #ffebee;
  color: #c62828;
}
.mcp-desc,
.mcp-hint {
  margin: 0;
  color: var(--ink2);
  font-size: 12px;
  line-height: 1.5;
}
.mcp-hint {
  color: var(--ink3);
  font-size: 11px;
}
.mcp-tags,
.mcp-tasks {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.mcp-tags span,
.mcp-tasks span {
  padding: 2px 6px;
  border-radius: 5px;
  background: rgba(213, 199, 135, 0.12);
  color: var(--olive-dark);
  font-size: 10px;
  font-weight: 800;
}
.mcp-tags span.danger {
  background: rgba(198, 40, 40, 0.08);
  color: #b91c1c;
}
.mcp-actions {
  display: flex;
  gap: 6px;
  margin-top: 2px;
}
.mcp-actions button {
  min-height: 30px;
  border-radius: 7px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}
.mcp-primary {
  flex: 1;
  border: 1px solid rgba(107, 142, 35, 0.36);
  background: rgba(107, 142, 35, 0.1);
  color: var(--olive-dark);
}
.mcp-ghost {
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink2);
  padding: 0 10px;
}
.mcp-actions button:hover:not(:disabled) {
  border-color: var(--olive);
  background: rgba(213, 199, 135, 0.16);
  color: var(--olive-dark);
}
.mcp-actions button:disabled {
  opacity: 0.52;
  cursor: not-allowed;
}
.mcp-error {
  color: #b91c1c;
  font-size: 11px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.mcp-empty {
  padding: 22px;
  text-align: center;
  color: var(--ink3);
  font-size: 12px;
}
</style>

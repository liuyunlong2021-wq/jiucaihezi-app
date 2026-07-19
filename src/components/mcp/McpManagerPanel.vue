<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useMcpStore, type McpServerConfig } from '@/stores/mcpStore'
import {
  completeMcpServerAuthorization,
  connectMcpServer,
  disconnectMcpServer,
  McpAuthorizationRequiredError,
} from '@/services/mcpClient'
import type { McpOAuthCallback } from '@/services/mcpOAuth'
import { BUILTIN_MCP_CATALOG, type BuiltinMcpCatalogEntry } from '@/data/mcpCatalog'
import { confirmAction } from '@/utils/confirmAction'
import { isTauriRuntime } from '@/utils/tauriEnv'

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
const isDesktopRuntime = isTauriRuntime()
const showAddForm = ref(false)
const addFormError = ref('')
const newServer = ref({
  name: '',
  transport: 'streamable-http' as McpServerConfig['transport'],
  url: '',
  command: '',
  args: '',
  cwd: '',
})

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
  if (transport === 'streamable-http') return '远程 MCP'
  if (transport === 'sse') return '远程 SSE'
  return '韭菜盒子'
}

function statusLabel(server?: McpServerConfig) {
  if (!server) return '未安装'
  if (server.status === 'connected') return '已连接'
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

function resetAddForm() {
  newServer.value = {
    name: '',
    transport: 'streamable-http',
    url: '',
    command: '',
    args: '',
    cwd: '',
  }
  addFormError.value = ''
  showAddForm.value = false
}

function customServerId(name: string) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'server'
  return `mcp_${base}_${Date.now().toString(36)}`
}

async function addCustomServer() {
  addFormError.value = ''
  const name = newServer.value.name.trim()
  if (!name) {
    addFormError.value = '请填写 MCP 名称。'
    return
  }

  const config: Omit<McpServerConfig, 'status' | 'error' | 'enabled'> = {
    id: customServerId(name),
    name,
    transport: newServer.value.transport,
  }

  if (config.transport === 'stdio') {
    if (!isDesktopRuntime) {
      addFormError.value = 'Web 版不能运行本地 MCP。'
      return
    }
    const command = newServer.value.command.trim()
    if (!command) {
      addFormError.value = '请填写启动命令。'
      return
    }
    config.command = command
    config.args = newServer.value.args.trim().split(/\s+/).filter(Boolean)
    config.cwd = newServer.value.cwd.trim() || undefined
  } else {
    const url = newServer.value.url.trim()
    try {
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol')
    } catch {
      addFormError.value = '请输入 http:// 或 https:// 开头的 MCP 地址。'
      return
    }
    config.url = url
  }

  const server = mcpStore.addServer(config)
  resetAddForm()
  await toggleServer(server)
}

async function configureSecret(entry: BuiltinMcpCatalogEntry): Promise<boolean> {
  if (!entry.secretEnvVar) return true
  const { safePrompt } = await import('@/utils/safePrompt')
  const legacyValue = entry.id === 'obsidian' ? localStorage.getItem('jc_obsidian_key') || '' : ''
  const value = await safePrompt(`输入 ${entry.name} API Key`, legacyValue, {
    inputType: 'password',
  })
  if (!value?.trim()) return false
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('set_mcp_server_secret', { serverId: entry.id, value: value.trim() })
  if (legacyValue) localStorage.removeItem('jc_obsidian_key')
  return true
}

async function addFromCatalog(entry: BuiltinMcpCatalogEntry) {
  message.value = ''
  if (configuredIds.value.has(entry.id)) {
    message.value = `「${entry.name}」已经在 MCP 扩展中。`
    return
  }

  const { safePrompt } = await import('@/utils/safePrompt')
  let config: Omit<McpServerConfig, 'status' | 'error' | 'enabled'>
  if (entry.auth === 'oauth') {
    if (!entry.url || !entry.oauthClientId) {
      message.value = `${entry.name} 的 OAuth Client ID 尚未配置。`
      return
    }
    config = {
      id: entry.id,
      name: entry.name,
      transport: entry.transport === 'remote' ? 'streamable-http' : entry.transport,
      url: entry.url,
      auth: 'oauth',
      oauthClientId: entry.oauthClientId,
      oauthTokenProxyUrl: entry.oauthTokenProxyUrl,
      oauthAuthorizationServerUrl: entry.oauthAuthorizationServerUrl,
      oauthAuthorizationEndpoint: entry.oauthAuthorizationEndpoint,
      oauthTokenEndpoint: entry.oauthTokenEndpoint,
    }
  } else if (
    entry.transport === 'sse' ||
    entry.transport === 'remote' ||
    entry.transport === 'streamable-http'
  ) {
    const url = await safePrompt(`配置「${entry.name}」连接地址`, entry.url || '')
    if (!url) return
    config = {
      id: entry.id,
      name: entry.name,
      transport: 'sse',
      url: url.trim(),
    }
  } else if (entry.secretEnvVar) {
    if (!(await configureSecret(entry))) return
    config = {
      id: entry.id,
      name: entry.name,
      transport: 'stdio',
      command: entry.command,
      args: entry.args,
      env: entry.env,
      secretEnvVar: entry.secretEnvVar,
    }
  } else {
    const command = await safePrompt(`配置「${entry.name}」启动命令`, entry.command || '')
    if (!command) return
    const argsText = (await safePrompt('启动参数（空格分隔）', (entry.args || []).join(' '))) || ''
    config = {
      id: entry.id,
      name: entry.name,
      transport: 'stdio',
      command: command.trim(),
      args: argsText
        .split(/\s+/)
        .map(part => part.trim())
        .filter(Boolean),
    }
  }

  const server = mcpStore.addServer(config)
  if (entry.auth === 'oauth') {
    await toggleServer(server)
    return
  }
  message.value = `已加入 MCP 扩展：${entry.name}。启用后才会连接并暴露工具。`
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
    if (error instanceof McpAuthorizationRequiredError) {
      message.value = `已打开浏览器，请完成 ${server.name} 授权。`
      return
    }
    const errMsg = error instanceof Error ? error.message : String(error)
    mcpStore.setServerStatus(server.id, 'error', errMsg)
    message.value = `${server.name} 连接失败：${errMsg}`
  } finally {
    connectingId.value = ''
  }
}

async function completeOAuthAuthorization(event: Event) {
  const detail = (event as CustomEvent<McpOAuthCallback>).detail
  const server = mcpStore.servers.find(item => item.id === detail?.serverId)
  if (!server) return
  if ('error' in detail) {
    const reason =
      detail.error === 'access_denied'
        ? '授权已取消。'
        : `授权失败：${detail.errorDescription || detail.error}`
    mcpStore.setServerStatus(server.id, 'error', reason)
    message.value = `${server.name} ${reason}`
    return
  }
  connectingId.value = server.id
  try {
    const tools = await completeMcpServerAuthorization(server.id, detail.code)
    mcpStore.setServerTools(server.id, tools)
    mcpStore.setServerStatus(server.id, 'connected')
    message.value = `${server.name} 已连接，发现 ${tools.length} 个外部工具。`
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    mcpStore.setServerStatus(server.id, 'error', errMsg)
    message.value = `${server.name} 授权失败：${errMsg}`
  } finally {
    connectingId.value = ''
  }
}

onMounted(() => window.addEventListener('jc-mcp-oauth-callback', completeOAuthAuthorization))
onBeforeUnmount(() =>
  window.removeEventListener('jc-mcp-oauth-callback', completeOAuthAuthorization),
)

async function removeServer(server: McpServerConfig) {
  if (!(await confirmAction(`删除 MCP 扩展「${server.name}」？`))) return
  await disconnectMcpServer(server.id)
  mcpStore.removeServer(server.id)
  message.value = `已从 MCP 扩展删除：${server.name}。`
}
</script>

<template>
  <section class="mcp-panel">
    <div class="mcp-controls">
      <div class="mcp-search">
        <JcIcon name="search" />
        <input v-model="search" type="text" placeholder="搜索扩展工具..." />
      </div>
      <select v-model="category" class="mcp-category" aria-label="扩展分类">
        <option v-for="item in categories" :key="item" :value="item">{{ item }}</option>
      </select>
      <div class="mcp-view-toggle" aria-label="视图切换">
        <button
          :class="{ active: viewMode === 'grid' }"
          title="卡片视图"
          @click="viewMode = 'grid'"
        >
          <JcIcon name="grid_view" />
        </button>
        <button
          :class="{ active: viewMode === 'list' }"
          title="列表视图"
          @click="viewMode = 'list'"
        >
          <JcIcon name="view_list" />
        </button>
      </div>
      <button class="mcp-add-button" @click="showAddForm = true">
        <JcIcon name="add" />
        添加 MCP
      </button>
    </div>

    <div v-if="message" class="mcp-message">{{ message }}</div>

    <form v-if="showAddForm" class="mcp-add-form" @submit.prevent="addCustomServer">
      <div class="mcp-add-form-head">
        <strong>添加 MCP</strong>
        <button type="button" title="取消" @click="resetAddForm"><JcIcon name="close" /></button>
      </div>
      <label>
        名称
        <input v-model="newServer.name" autofocus placeholder="例如 GitHub MCP" />
      </label>
      <label>
        连接类型
        <select v-model="newServer.transport">
          <option value="streamable-http">远程 MCP</option>
          <option value="sse">远程 SSE</option>
          <option v-if="isDesktopRuntime" value="stdio">本地命令</option>
        </select>
      </label>
      <template v-if="newServer.transport === 'stdio'">
        <label>
          启动命令
          <input v-model="newServer.command" placeholder="例如 npx" />
        </label>
        <label>
          参数（可选）
          <input
            v-model="newServer.args"
            placeholder="例如 -y @modelcontextprotocol/server-filesystem /路径"
          />
        </label>
        <label>
          工作目录（可选）
          <input v-model="newServer.cwd" placeholder="例如 /Users/你的名字/项目" />
        </label>
      </template>
      <label v-else>
        MCP 地址
        <input v-model="newServer.url" type="url" placeholder="https://example.com/mcp" />
      </label>
      <p v-if="addFormError" class="mcp-error">{{ addFormError }}</p>
      <div class="mcp-add-form-actions">
        <button type="button" class="mcp-ghost" @click="resetAddForm">取消</button>
        <button type="submit" class="mcp-primary">添加并连接</button>
      </div>
    </form>

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
              <span class="mcp-status" :class="statusClass(card.server)">{{
                statusLabel(card.server)
              }}</span>
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
              <button v-if="!card.installed" class="mcp-primary" @click="addFromCatalog(card)">
                {{ card.auth === 'oauth' ? '连接' : '加入仓库' }}
              </button>
              <template v-else-if="card.server">
                <button
                  class="mcp-primary"
                  :disabled="connectingId === card.server.id"
                  @click="toggleServer(card.server)"
                >
                  {{
                    card.server.status === 'connected'
                      ? '停用'
                      : card.server.auth === 'oauth'
                        ? '连接'
                        : '启用'
                  }}
                </button>
                <button
                  v-if="card.secretEnvVar"
                  class="mcp-ghost"
                  @click="
                    configureSecret(card).then(ok => {
                      if (ok) message = `${card.name} API Key 已更新。`
                    })
                  "
                >
                  更新 Key
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
          <article
            v-for="server in filteredCustomServers"
            :key="server.id"
            class="mcp-card custom"
            :class="statusClass(server)"
          >
            <div class="mcp-card-top">
              <JcIcon name="extension" class="mcp-card-icon" />
              <div class="mcp-card-name">
                <strong>{{ server.name }}</strong>
                <span>{{ transportLabel(server.transport) }}</span>
              </div>
              <span class="mcp-status" :class="statusClass(server)">{{ statusLabel(server) }}</span>
            </div>
            <p class="mcp-desc">
              {{ server.url || [server.command, ...(server.args || [])].filter(Boolean).join(' ') }}
            </p>
            <p v-if="server.status === 'connected'" class="mcp-hint">
              发现 {{ mcpStore.tools.get(server.id)?.length || 0 }} 个外部工具
            </p>
            <div v-if="server.error" class="mcp-error">{{ server.error }}</div>
            <div class="mcp-actions">
              <button
                class="mcp-primary"
                :disabled="connectingId === server.id"
                @click="toggleServer(server)"
              >
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
  align-items: center;
  gap: 8px;
}
.mcp-add-button {
  height: 32px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid rgba(107, 142, 35, 0.36);
  border-radius: 7px;
  padding: 0 9px;
  background: rgba(107, 142, 35, 0.1);
  color: var(--olive-dark);
  font-family: inherit;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
  white-space: nowrap;
}
.mcp-add-button:hover {
  border-color: var(--olive);
  background: rgba(213, 199, 135, 0.16);
}
.mcp-add-button .mso {
  font-size: 16px;
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
.mcp-add-form {
  display: grid;
  gap: 9px;
  margin: 10px 12px 0;
  padding: 12px;
  border: 1px solid rgba(107, 142, 35, 0.28);
  border-radius: 8px;
  background: var(--paper);
}
.mcp-add-form-head,
.mcp-add-form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.mcp-add-form-head strong {
  color: var(--ink1);
  font-size: 13px;
  font-weight: 900;
}
.mcp-add-form-head button {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ink3);
  cursor: pointer;
}
.mcp-add-form-head button:hover {
  background: var(--surface-alt);
  color: var(--ink1);
}
.mcp-add-form label {
  display: grid;
  gap: 5px;
  color: var(--ink2);
  font-size: 11px;
  font-weight: 800;
}
.mcp-add-form input,
.mcp-add-form select {
  width: 100%;
  min-height: 32px;
  box-sizing: border-box;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 0 8px;
  background: var(--surface);
  color: var(--ink1);
  font: inherit;
}
.mcp-add-form input:focus,
.mcp-add-form select:focus {
  outline: 2px solid rgba(107, 142, 35, 0.24);
  border-color: var(--olive);
}
.mcp-add-form-actions {
  justify-content: flex-end;
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

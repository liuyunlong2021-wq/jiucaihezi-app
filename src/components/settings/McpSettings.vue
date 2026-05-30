<script setup lang="ts">
/**
 * McpSettings.vue — MCP Server 管理面板
 *
 * 用户可添加/删除/启停 MCP Server。
 * SSE transport 在 Phase 1 可用；stdio 在 Phase 2 通过 Rust bridge 支持。
 */
import { ref, computed, watch } from 'vue'
import { useMcpStore, type McpServerConfig } from '@/stores/mcpStore'
import { connectMcpServer, disconnectMcpServer } from '@/services/mcpClient'

const mcpStore = useMcpStore()

// ─── 添加表单 ───
const showAddForm = ref(false)
const newServer = ref({
  name: '',
  transport: 'sse' as 'sse' | 'stdio',
  url: '',
  command: '',
  args: '',
  cwd: '',
})

function resetForm() {
  newServer.value = { name: '', transport: 'sse', url: '', command: '', args: '', cwd: '' }
  showAddForm.value = false
}

async function handleAdd() {
  const n = newServer.value
  if (!n.name.trim()) return

  const id = 'mcp_' + Date.now().toString(36)
  const config: any = {
    id,
    name: n.name.trim(),
    transport: n.transport,
  }
  if (n.transport === 'sse') {
    if (!n.url.trim()) return
    config.url = n.url.trim()
  } else {
    if (!n.command.trim()) return
    config.command = n.command.trim()
    config.args = n.args.trim() ? n.args.trim().split(/\s+/) : []
    config.cwd = n.cwd.trim() || undefined
  }

  mcpStore.addServer(config)
  resetForm()
}

// ─── 连接/断开 ───
async function handleToggle(server: McpServerConfig) {
  if (server.enabled) {
    // 禁用
    await disconnectMcpServer(server.id)
    mcpStore.toggleServer(server.id)
  } else {
    // 启用
    mcpStore.toggleServer(server.id)
    if (server.transport === 'stdio') {
      mcpStore.setServerStatus(server.id, 'error', 'stdio 传输将在 Phase 2 支持')
      return
    }
    try {
      mcpStore.setServerStatus(server.id, 'connecting')
      const tools = await connectMcpServer(server)
      mcpStore.setServerTools(server.id, tools)
      mcpStore.setServerStatus(server.id, 'connected')
    } catch (err: any) {
      mcpStore.setServerStatus(server.id, 'error', err.message || '连接失败')
    }
  }
}

async function handleDelete(server: McpServerConfig) {
  await disconnectMcpServer(server.id)
  mcpStore.removeServer(server.id)
}

// ─── 状态显示 ───
function statusIcon(status: string): string {
  switch (status) {
    case 'connected': return 'check_circle'
    case 'connecting': return 'sync'
    case 'error': return 'error'
    default: return 'radio_button_unchecked'
  }
}

function statusClass(status: string): string {
  return `mcp-status-${status}`
}
</script>

<template>
  <div class="mcp-settings">
    <div class="mcp-header">
      <h3>MCP Server 管理</h3>
      <p class="mcp-desc">
        安装 MCP Server 扩展工具能力。启用后，服务器提供的工具将加入对话中的工具池。
      </p>
    </div>

    <!-- Server 列表 -->
    <div v-if="mcpStore.servers.length" class="mcp-list">
      <div
        v-for="server in mcpStore.servers"
        :key="server.id"
        class="mcp-card"
        :class="statusClass(server.status)"
      >
        <div class="mcp-card-left">
          <span class="mso mcp-status-icon">{{ statusIcon(server.status) }}</span>
          <div class="mcp-card-info">
            <div class="mcp-card-name">{{ server.name }}</div>
            <div class="mcp-card-meta">
              <span class="mcp-badge">{{ server.transport.toUpperCase() }}</span>
              <span v-if="server.url" class="mcp-url">{{ server.url }}</span>
              <span v-if="server.command" class="mcp-cmd">{{ server.command }} {{ (server.args || []).join(' ') }}</span>
            </div>
            <div v-if="server.status === 'connected'" class="mcp-tool-count">
              {{ mcpStore.tools.get(server.id)?.length || 0 }} 个工具可用
            </div>
            <div v-if="server.error" class="mcp-error">{{ server.error }}</div>
          </div>
        </div>
        <div class="mcp-card-right">
          <button
            class="mcp-toggle"
            :class="{ on: server.enabled }"
            @click="handleToggle(server)"
          >
            <span class="mso">{{ server.enabled ? 'toggle_on' : 'toggle_off' }}</span>
          </button>
          <button class="mcp-delete" @click="handleDelete(server)" title="删除">
            <span class="mso">delete</span>
          </button>
        </div>
      </div>
    </div>

    <div v-else class="mcp-empty">
      暂无 MCP Server。点击下方按钮添加。
    </div>

    <!-- 添加表单 -->
    <div v-if="showAddForm" class="mcp-add-form">
      <input v-model="newServer.name" placeholder="Server 名称（如 GitHub）" class="mcp-input" />
      <select v-model="newServer.transport" class="mcp-select">
        <option value="sse">SSE (HTTP)</option>
        <option value="stdio" disabled>stdio (Phase 2)</option>
      </select>
      <template v-if="newServer.transport === 'sse'">
        <input v-model="newServer.url" placeholder="SSE URL（如 https://mcp.example.com/sse）" class="mcp-input" />
      </template>
      <template v-else>
        <input v-model="newServer.command" placeholder="启动命令（如 npx）" class="mcp-input" />
        <input v-model="newServer.args" placeholder="参数（空格分隔）" class="mcp-input" />
        <input v-model="newServer.cwd" placeholder="工作目录（可选）" class="mcp-input" />
      </template>
      <div class="mcp-add-actions">
        <button class="mcp-btn-primary" @click="handleAdd">添加</button>
        <button class="mcp-btn-cancel" @click="resetForm">取消</button>
      </div>
    </div>

    <button v-else class="mcp-add-btn" @click="showAddForm = true">
      <span class="mso">add</span> 添加 MCP Server
    </button>
  </div>
</template>

<style scoped>
.mcp-settings {
  padding: 8px 0;
}
.mcp-header {
  margin-bottom: 16px;
}
.mcp-header h3 {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
}
.mcp-desc {
  margin: 0;
  font-size: 13px;
  color: var(--ink2);
  line-height: 1.5;
}
.mcp-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}
.mcp-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--jc-account-card-bg, rgba(255,255,255,0.06));
  border: 1px solid var(--line);
  transition: border-color 0.2s;
}
.mcp-card.mcp-status-connected {
  border-color: var(--olive, #6B8E23);
}
.mcp-card.mcp-status-error {
  border-color: #e74c3c;
}
.mcp-card-left {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}
.mcp-status-icon {
  font-size: 20px;
  color: var(--ink2);
  margin-top: 1px;
}
.mcp-status-connected .mcp-status-icon {
  color: var(--olive, #6B8E23);
}
.mcp-status-error .mcp-status-icon {
  color: #e74c3c;
}
.mcp-status-connecting .mcp-status-icon {
  color: #f39c12;
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.mcp-card-info {
  min-width: 0;
}
.mcp-card-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
}
.mcp-card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  font-size: 12px;
  color: var(--ink2);
}
.mcp-badge {
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--line);
  font-size: 11px;
  font-weight: 600;
}
.mcp-url, .mcp-cmd {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mcp-tool-count {
  margin-top: 4px;
  font-size: 12px;
  color: var(--olive, #6B8E23);
}
.mcp-error {
  margin-top: 4px;
  font-size: 12px;
  color: #e74c3c;
}
.mcp-card-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.mcp-toggle {
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px;
  color: var(--ink2);
  font-size: 28px;
  transition: color 0.2s;
}
.mcp-toggle.on {
  color: var(--olive, #6B8E23);
}
.mcp-delete {
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px;
  color: var(--ink3);
  font-size: 18px;
  opacity: 0.5;
  transition: opacity 0.2s;
}
.mcp-delete:hover {
  opacity: 1;
  color: #e74c3c;
}
.mcp-empty {
  text-align: center;
  color: var(--ink3);
  font-size: 13px;
  padding: 24px 0;
}
.mcp-add-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 10px;
  background: var(--jc-account-card-bg, rgba(255,255,255,0.06));
  border: 1px solid var(--line);
}
.mcp-input, .mcp-select {
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--bg);
  color: var(--ink);
  font-size: 13px;
}
.mcp-select {
  cursor: pointer;
}
.mcp-add-actions {
  display: flex;
  gap: 8px;
}
.mcp-btn-primary {
  padding: 6px 16px;
  border-radius: 8px;
  border: none;
  background: var(--olive, #6B8E23);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.mcp-btn-cancel {
  padding: 6px 16px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--ink2);
  font-size: 13px;
  cursor: pointer;
}
.mcp-add-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px dashed var(--line);
  background: transparent;
  color: var(--ink2);
  font-size: 13px;
  cursor: pointer;
  width: 100%;
  justify-content: center;
  transition: border-color 0.2s, color 0.2s;
}
.mcp-add-btn:hover {
  border-color: var(--olive, #6B8E23);
  color: var(--olive, #6B8E23);
}
</style>

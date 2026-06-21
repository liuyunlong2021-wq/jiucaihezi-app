<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from '@/utils/tauriEnv'

interface OpenCodeMcpServerStatus {
  name: string
  status: string
  detail: string
}

interface OpenCodeMcpStatus {
  available: boolean
  configured: boolean
  count: number
  servers: OpenCodeMcpServerStatus[]
  rawOutput: string
  error?: string | null
  command: string
  directory: string
}

const loading = ref(false)
const status = ref<OpenCodeMcpStatus | null>(null)
const error = ref('')

const statusText = computed(() => {
  if (!isTauriRuntime()) return '仅桌面版'
  if (loading.value) return '检查中'
  if (error.value || status.value?.error) return '异常'
  if (!status.value?.available) return '不可用'
  if (!status.value.configured) return '未配置'
  return `${status.value.count} 个`
})

const summary = computed(() => {
  if (!isTauriRuntime()) return 'Web 端不运行 OpenCode MCP。'
  if (error.value) return error.value
  if (!status.value) return '读取 OpenCode 官方 MCP 状态。'
  if (status.value.error) return status.value.error
  if (!status.value.available) return 'OpenCode runtime 不可用。'
  if (!status.value.configured) return '当前 OpenCode runtime 没有配置 MCP Server。'
  return `OpenCode 官方 MCP 已配置 ${status.value.count} 个 server。`
})

function statusLabel(value: string) {
  if (value === 'connected') return '已连接'
  if (value === 'needs_auth') return '需认证'
  if (value === 'error') return '异常'
  return '已配置'
}

async function refresh() {
  if (!isTauriRuntime() || loading.value) return
  loading.value = true
  error.value = ''
  try {
    status.value = await invoke<OpenCodeMcpStatus>('opencode_mcp_status')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void refresh()
})
</script>

<template>
  <section class="mcp-status-card" aria-label="OpenCode MCP 状态">
    <div class="mcp-status-head">
      <div class="mcp-status-title">
        <JcIcon name="hub" />
        <div>
          <strong>OpenCode MCP</strong>
          <span>官方外挂工具状态</span>
        </div>
      </div>
      <span class="mcp-status-pill" :class="{ error: Boolean(error || status?.error), ok: Boolean(status?.configured) }">
        {{ statusText }}
      </span>
    </div>

    <p class="mcp-status-summary">{{ summary }}</p>

    <div v-if="status?.servers.length" class="mcp-status-list">
      <div v-for="server in status.servers" :key="`${server.name}:${server.detail}`" class="mcp-status-item">
        <span>{{ server.name }}</span>
        <strong>{{ statusLabel(server.status) }}</strong>
      </div>
    </div>

    <pre v-else-if="status?.rawOutput" class="mcp-status-raw">{{ status.rawOutput }}</pre>

    <div class="mcp-status-actions">
      <button type="button" :disabled="loading || !isTauriRuntime()" @click="refresh">
        <JcIcon :name="loading ? 'hourglass_top' : 'refresh'" />
        刷新状态
      </button>
      <span>配置入口对齐官方：opencode.jsonc / opencode mcp。</span>
    </div>
  </section>
</template>

<style scoped>
.mcp-status-card {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
}
.mcp-status-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: flex-start;
}
.mcp-status-title {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.mcp-status-title .mso {
  color: var(--olive-dark);
  font-size: 20px;
}
.mcp-status-title div {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.mcp-status-title strong {
  color: var(--ink1);
  font-size: 13px;
  font-weight: 900;
}
.mcp-status-title span:not(.mso) {
  color: var(--ink3);
  font-size: 11px;
  font-weight: 700;
}
.mcp-status-pill {
  flex: 0 0 auto;
  padding: 3px 7px;
  border-radius: 999px;
  background: var(--surface-alt);
  color: var(--ink3);
  font-size: 11px;
  font-weight: 900;
  white-space: nowrap;
}
.mcp-status-pill.ok {
  background: rgba(46, 125, 50, 0.1);
  color: #2e7d32;
}
.mcp-status-pill.error {
  background: #ffebee;
  color: #c62828;
}
.mcp-status-summary {
  margin: 0;
  color: var(--ink2);
  font-size: 12px;
  line-height: 1.5;
}
.mcp-status-list {
  display: grid;
  gap: 6px;
}
.mcp-status-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 28px;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface);
  font-size: 12px;
}
.mcp-status-item span {
  min-width: 0;
  color: var(--ink1);
  font-weight: 800;
  overflow-wrap: anywhere;
}
.mcp-status-item strong {
  flex: 0 0 auto;
  color: var(--olive-dark);
  font-size: 11px;
}
.mcp-status-raw {
  max-height: 120px;
  margin: 0;
  padding: 8px;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface);
  color: var(--ink3);
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
}
.mcp-status-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.mcp-status-actions button {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface);
  color: var(--ink2);
  font-family: inherit;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
}
.mcp-status-actions button:hover:not(:disabled) {
  border-color: var(--olive);
  color: var(--olive-dark);
  background: rgba(213, 199, 135, 0.14);
}
.mcp-status-actions button:disabled {
  opacity: 0.6;
  cursor: wait;
}
.mcp-status-actions .mso {
  font-size: 15px;
}
.mcp-status-actions span:not(.mso) {
  color: var(--ink3);
  font-size: 11px;
  line-height: 1.4;
}
</style>

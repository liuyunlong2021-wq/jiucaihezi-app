<script setup lang="ts">
/**
 * ContextUsagePanel.vue — 上下文详情面板（对齐 OpenCode 官方）
 *
 * 点击 Token 水位条后在第四列展开，显示与 OpenCode 官方一致的上下文详情：
 *   1. 会话元信息（provider、model、消息数、时间）
 *   2. Token 统计（input/output/reasoning/cache/total）
 *   3. 上下文拆分条形图
 *   4. 原始消息列表
 */
import { computed } from 'vue'
import type { OpenCodeContextUsage } from '@/opencodeClient/catalog'

export interface ContextMessage {
  id: string
  role: string
  timestamp: number
}

const props = defineProps<{
  usage: OpenCodeContextUsage | null
  messages?: ContextMessage[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

// ── formatters ──

function fmt(n: number | undefined): string {
  if (n === undefined || n === null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function pct(part: number, total: number): string {
  if (!total) return '0%'
  return `${((part / total) * 100).toFixed(1)}%`
}

function costStr(c: number | undefined): string {
  if (c === undefined || c === null) return '—'
  return `US$${c.toFixed(2)}`
}

function dateStr(ts: number | undefined): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

// ── computed ──

interface Breakdown {
  label: string
  tokens: number
  pct: number
  color: string
}

const breakdown = computed<Breakdown[]>(() => {
  const u = props.usage
  if (!u || !u.total) return []
  const items: Breakdown[] = []
  if (u.output) {
    items.push({ label: 'Assistant', tokens: u.output, pct: u.output / u.total, color: '#8b5cf6' })
  }
  if (u.reasoning) {
    items.push({ label: 'Tool calls', tokens: u.reasoning, pct: u.reasoning / u.total, color: '#d97706' })
  }
  if (u.input) {
    items.push({ label: 'User', tokens: u.input, pct: u.input / u.total, color: '#059669' })
  }
  const cacheTotal = (u.cacheRead || 0) + (u.cacheWrite || 0)
  if (cacheTotal) {
    items.push({ label: 'Cache', tokens: cacheTotal, pct: cacheTotal / u.total, color: '#6b7280' })
  }
  return items
})
</script>

<template>
  <div class="ctx-panel">
    <!-- header -->
    <div class="ctx-head">
      <div>
        <h3>上下文用量</h3>
        <span v-if="usage" class="ctx-head-meta">
          {{ usage.providerID || 'opencode' }} · {{ usage.modelLabel || usage.modelID || usage.sessionID }}
        </span>
      </div>
      <button class="ctx-close" @click="emit('close')">✕</button>
    </div>

    <div v-if="!usage" class="ctx-empty">暂无上下文用量数据</div>

    <template v-else>
      <!-- stats grid: 3 columns -->
      <div class="ctx-stats">
        <div class="ctx-stat">
          <span class="cs-label">消息</span>
          <span class="cs-value">{{ usage.messageCount }} <small>({{ usage.userMessages }} 用户 · {{ usage.assistantMessages }} 助手)</small></span>
        </div>
        <div class="ctx-stat">
          <span class="cs-label">总 Token</span>
          <span class="cs-value">{{ fmt(usage.total) }}</span>
        </div>
        <div class="ctx-stat">
          <span class="cs-label">预估成本</span>
          <span class="cs-value">{{ costStr(usage.cost) }}</span>
        </div>
      </div>

      <!-- token detail table -->
      <table class="ctx-table">
        <thead>
          <tr>
            <th></th>
            <th>Tokens</th>
            <th>占比</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Input</td>
            <td>{{ fmt(usage.input) }}</td>
            <td>{{ pct(usage.input, usage.total) }}</td>
          </tr>
          <tr>
            <td>Output</td>
            <td>{{ fmt(usage.output) }}</td>
            <td>{{ pct(usage.output, usage.total) }}</td>
          </tr>
          <tr v-if="usage.reasoning">
            <td>Reasoning</td>
            <td>{{ fmt(usage.reasoning) }}</td>
            <td>{{ pct(usage.reasoning, usage.total) }}</td>
          </tr>
          <tr v-if="usage.cacheRead">
            <td>Cache 读取</td>
            <td>{{ fmt(usage.cacheRead) }}</td>
            <td>{{ pct(usage.cacheRead, usage.total) }}</td>
          </tr>
          <tr v-if="usage.cacheWrite">
            <td>Cache 写入</td>
            <td>{{ fmt(usage.cacheWrite) }}</td>
            <td>{{ pct(usage.cacheWrite, usage.total) }}</td>
          </tr>
          <tr class="total">
            <td>总计</td>
            <td>{{ fmt(usage.total) }}<template v-if="usage.limit"> / {{ fmt(usage.limit) }}</template></td>
            <td>{{ usage.limit ? pct(usage.total, usage.limit) : '—' }}</td>
          </tr>
        </tbody>
      </table>

      <!-- 上下文拆分条形图（对齐 OpenCode 官方） -->
      <div v-if="breakdown.length" class="ctx-breakdown">
        <div class="cb-title">上下文拆分</div>
        <div class="cb-bar">
          <span
            v-for="(item, i) in breakdown"
            :key="i"
            class="cb-seg"
            :style="{ width: (item.pct * 100) + '%', background: item.color }"
            :title="`${item.label}: ${fmt(item.tokens)} (${(item.pct * 100).toFixed(1)}%)`"
          ></span>
        </div>
        <div class="cb-legend">
          <span v-for="(item, i) in breakdown" :key="i" class="cb-legend-item">
            <span class="cb-dot" :style="{ background: item.color }"></span>
            {{ item.label }} {{ (item.pct * 100).toFixed(1) }}%
          </span>
        </div>
      </div>

      <!-- 原始消息列表 -->
      <div v-if="messages?.length" class="ctx-messages">
        <div class="cb-title">原始消息</div>
        <div class="cm-list">
          <div v-for="msg in messages" :key="msg.id" class="cm-row">
            <span class="cm-role" :class="msg.role">{{ msg.role }}</span>
            <span class="cm-id">{{ msg.id }}</span>
            <span class="cm-time">{{ dateStr(msg.timestamp) }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ctx-panel {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 10px;
  margin: 0 0 8px;
  overflow: hidden;
  font-size: 13px;
}
.ctx-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
}
.ctx-head h3 { margin: 0; font-size: 14px; color: var(--ink1); }
.ctx-head-meta { font-size: 11px; color: var(--ink3); margin-left: 8px; }
.ctx-close {
  background: none; border: none; cursor: pointer;
  color: var(--ink3); font-size: 16px; padding: 2px 6px; border-radius: 4px;
}
.ctx-close:hover { background: var(--line); color: var(--ink1); }
.ctx-empty { padding: 20px; color: var(--ink3); text-align: center; }

/* stats grid */
.ctx-stats {
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1px;
  background: var(--line); border-bottom: 1px solid var(--line);
}
.ctx-stat {
  padding: 10px 12px; background: var(--paper);
  display: flex; flex-direction: column; gap: 2px;
}
.cs-label { font-size: 11px; color: var(--ink3); text-transform: uppercase; }
.cs-value { font-size: 14px; font-weight: 600; color: var(--ink1); }
.cs-value small { font-weight: 400; font-size: 11px; color: var(--ink3); }

/* token table */
.ctx-table {
  width: 100%; border-collapse: collapse; margin: 8px 0;
}
.ctx-table th, .ctx-table td {
  padding: 4px 14px; text-align: left; font-size: 12px;
}
.ctx-table th { color: var(--ink3); font-weight: 600; font-size: 11px; text-transform: uppercase; }
.ctx-table td { color: var(--ink1); }
.ctx-table td:nth-child(2),
.ctx-table td:nth-child(3) { text-align: right; font-variant-numeric: tabular-nums; }
.ctx-table tr.total { border-top: 1px solid var(--line); }
.ctx-table tr.total td { font-weight: 700; padding-top: 6px; }

/* breakdown bar */
.ctx-breakdown { padding: 8px 14px 12px; }
.cb-title { font-size: 11px; color: var(--ink3); font-weight: 600; margin-bottom: 6px; text-transform: uppercase; }
.cb-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; margin-bottom: 6px; }
.cb-seg { transition: width 0.3s ease; min-width: 2px; }
.cb-legend { display: flex; flex-wrap: wrap; gap: 12px; }
.cb-legend-item { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--ink2); }
.cb-dot { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }

/* raw messages */
.ctx-messages { padding: 0 14px 12px; }
.cm-list { max-height: 200px; overflow-y: auto; }
.cm-row {
  display: flex; align-items: center; gap: 8px;
  padding: 3px 0; border-bottom: 1px solid rgba(0,0,0,.04);
  font-size: 11px;
}
.cm-role {
  padding: 0 4px; border-radius: 3px; font-weight: 600; font-size: 10px;
  text-transform: uppercase; min-width: 50px; text-align: center;
}
.cm-role.user { background: rgba(5,150,105,.12); color: #059669; }
.cm-role.assistant { background: rgba(139,92,246,.12); color: #8b5cf6; }
.cm-role.system { background: rgba(107,114,128,.12); color: #6b7280; }
.cm-id { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink3); font-family: monospace; font-size: 10px; }
.cm-time { color: var(--ink3); white-space: nowrap; flex-shrink: 0; }
</style>

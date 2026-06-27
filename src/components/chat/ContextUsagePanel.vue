<script setup lang="ts">
import { computed } from 'vue'
import type { OpenCodeContextUsage } from '@/opencodeClient/catalog'

const props = defineProps<{
  usage: OpenCodeContextUsage | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

function fmt(n: number | undefined): string {
  if (n === undefined || n === null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function pct(n: number | undefined, total: number | undefined): string {
  if (!n || !total) return ''
  return `${((n / total) * 100).toFixed(1)}%`
}

function costStr(c: number | undefined): string {
  if (c === undefined || c === null) return '—'
  return `$${c.toFixed(4)}`
}

function timeStr(ts: number | undefined): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

const sections = computed(() => {
  const u = props.usage
  if (!u) return []
  return [
    {
      title: '会话信息',
      rows: [
        ['消息数', `${u.messageCount}（用户 ${u.userMessages} · 助手 ${u.assistantMessages}）`],
        ['最后活动', timeStr(u.lastMessageAt)],
      ],
    },
    {
      title: 'Token 用量',
      rows: [
        ['Input', `${fmt(u.input)} ${pct(u.input, u.total)}`],
        ['Output', `${fmt(u.output)} ${pct(u.output, u.total)}`],
        ['Reasoning', `${fmt(u.reasoning)} ${pct(u.reasoning, u.total)}`],
        ['Cache 读取', fmt(u.cacheRead)],
        ['Cache 写入', fmt(u.cacheWrite)],
        ['总计', `${fmt(u.total)}${u.limit ? ` / ${fmt(u.limit)}（上限）` : ''}`],
        ...(u.usage !== undefined ? [['用量占比', `${(u.usage * 100).toFixed(1)}%`]] : []),
      ],
    },
    {
      title: 'Provider & Model',
      rows: [
        ['Provider', u.providerID || '—'],
        ['Model ID', u.modelID || '—'],
        ['Model', u.modelLabel || '—'],
      ],
    },
    {
      title: '成本',
      rows: [
        ['预估成本', costStr(u.cost)],
      ],
    },
  ]
})
</script>

<template>
  <div class="ctx-panel">
    <div class="ctx-head">
      <h3>会话上下文用量</h3>
      <button class="ctx-close" @click="emit('close')">✕</button>
    </div>
    <div v-if="!usage" class="ctx-empty">
      暂无上下文用量数据
    </div>
    <div v-else class="ctx-body">
      <div v-for="sec in sections" :key="sec.title" class="ctx-section">
        <div class="ctx-section-title">{{ sec.title }}</div>
        <div v-for="(row, ri) in sec.rows" :key="ri" class="ctx-row">
          <span class="ctx-label">{{ row[0] }}</span>
          <span class="ctx-value">{{ row[1] }}</span>
        </div>
      </div>
    </div>
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
.ctx-close {
  background: none; border: none; cursor: pointer;
  color: var(--ink3); font-size: 16px; padding: 2px 6px; border-radius: 4px;
}
.ctx-close:hover { background: var(--line); color: var(--ink1); }
.ctx-empty { padding: 20px; color: var(--ink3); text-align: center; }
.ctx-body { padding: 8px 0; }
.ctx-section { padding: 4px 14px 8px; }
.ctx-section + .ctx-section { border-top: 1px solid var(--line); }
.ctx-section-title {
  font-weight: 700; color: var(--ink1); margin-bottom: 4px;
  font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;
}
.ctx-row {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 2px 0; gap: 12px;
}
.ctx-label { color: var(--ink3); font-size: 12px; flex-shrink: 0; }
.ctx-value { color: var(--ink1); font-weight: 500; text-align: right; word-break: break-all; }
</style>

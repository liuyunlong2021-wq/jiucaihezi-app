<script setup lang="ts">
/**
 * SessionContextUsage.vue — 1:1 对齐官方 @opencode-ai/ui SessionContextUsage
 *
 * 显示进度圆环（token 使用率%），hover 显示 tooltip，点击切换上下文面板。
 * 官方路径: packages/app/src/components/session-context-usage.tsx
 */
import { computed } from 'vue'

const props = defineProps<{
  total?: number
  limit?: number
  usage?: number
  cost?: number
}>()

const emit = defineEmits<{
  (e: 'toggleContext'): void
}>()

const pct = computed(() => {
  if (props.usage !== undefined && props.usage !== null) return Math.min(100, Math.round(props.usage * 100))
  if (props.limit && props.total) return Math.min(100, Math.round((props.total / props.limit) * 100))
  return 0
})

// SVG 圆环参数: size=16, strokeWidth=2, radius=6, circumference≈37.7
const radius = 6
const circumference = 2 * Math.PI * radius
const dashOffset = computed(() => circumference - (pct.value / 100) * circumference)

function fmt(n: number | undefined): string {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function handleClick() {
  emit('toggleContext')
}

function costStr(c: number | undefined): string {
  if (!c) return 'US$0.00'
  return `US$${c.toFixed(2)}`
}
</script>

<template>
  <div class="scu-wrap">
    <button
      type="button"
      class="scu-btn"
      :class="{ active: pct > 0 }"
      @click.stop="handleClick"
      :aria-label="`上下文用量 ${pct}%`"
      title=""
    >
      <svg width="16" height="16" viewBox="0 0 16 16" class="scu-circle">
        <circle cx="8" cy="8" :r="radius" fill="none" stroke="currentColor" stroke-width="2" opacity="0.15" />
        <circle
          cx="8" cy="8" :r="radius"
          fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round"
          :stroke-dasharray="circumference"
          :stroke-dashoffset="dashOffset"
          transform="rotate(-90 8 8)"
          class="scu-fill"
          :class="{ high: pct >= 80, mid: pct >= 50 }"
        />
      </svg>
    </button>
    <!-- tooltip -->
    <div class="scu-tooltip">
      <div class="scu-tooltip-row">
        <span class="scu-tooltip-val">{{ fmt(total) }}</span>
        <span class="scu-tooltip-label">tokens</span>
      </div>
      <div class="scu-tooltip-row">
        <span class="scu-tooltip-val">{{ pct }}%</span>
        <span class="scu-tooltip-label">usage</span>
      </div>
      <div class="scu-tooltip-row">
        <span class="scu-tooltip-val">{{ costStr(cost) }}</span>
        <span class="scu-tooltip-label">cost</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scu-wrap {
  position: relative;
  display: inline-flex;
}
.scu-btn {
  width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  border: 0; border-radius: 6px;
  background: transparent; color: var(--ink3);
  cursor: pointer; padding: 0;
}
.scu-btn:hover { background: var(--surface); color: var(--ink1); }
.scu-circle { display: block; }
.scu-fill { color: var(--olive); transition: stroke-dashoffset 0.4s ease; }
.scu-fill.mid { color: #dba045; }
.scu-fill.high { color: #e0554a; }

/* tooltip */
.scu-tooltip {
  position: absolute; top: calc(100% + 4px); left: 50%; transform: translateX(-50%);
  background: #1e1e1e; color: #ccc; border-radius: 8px; padding: 6px 10px;
  font-size: 11px; white-space: nowrap; z-index: 999;
  opacity: 0; visibility: hidden; transition: opacity 0.15s;
  display: flex; flex-direction: column; gap: 2px;
  pointer-events: none;
}
.scu-wrap:hover .scu-tooltip { opacity: 1; visibility: visible; }
.scu-tooltip-row { display: flex; gap: 6px; align-items: baseline; }
.scu-tooltip-val { color: #fff; font-weight: 600; font-variant-numeric: tabular-nums; }
.scu-tooltip-label { color: #999; font-size: 10px; }
</style>

<script setup lang="ts">
/**
 * AgentStatusBar.vue — Agent 状态条（小白可视化）
 *
 * 状态流转:
 *   idle → sending → thinking → tool → replying → done/error
 * 用颜色圆点 + 中文状态 + 工具名 + 耗时让小白一眼看懂
 */
import { computed, ref, watch, onUnmounted } from 'vue'
import type { AgentPhase, ToolProgress } from '@/composables/useChat'

const props = defineProps<{
  phase: AgentPhase
  detail: string
  toolProgress: ToolProgress | null
  toolHistory: ToolProgress[]
  tokenUsage?: { total: number; input: number; output: number; limit?: number } | null
}>()

const emit = defineEmits<{
  (e: 'openContextPanel'): void
}>()

// 计时器
const elapsed = ref(0)
const visible = ref(false)
let timer: ReturnType<typeof setInterval> | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null

watch(() => props.phase, (phase) => {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }

  if (phase === 'thinking' || phase === 'tool' || phase === 'replying' || phase === 'sending' || phase === 'cancelling') {
    visible.value = true
    elapsed.value = 0
    if (timer) clearInterval(timer)
    timer = setInterval(() => { elapsed.value++ }, 1000)
  } else {
    if (timer) { clearInterval(timer); timer = null }
    if (phase === 'done') {
      visible.value = true
      hideTimer = setTimeout(() => { visible.value = false }, 1200)
    } else if (phase === 'error') {
      visible.value = true
    } else {
      visible.value = false
    }
  }
}, { immediate: true })

onUnmounted(() => {
  if (timer) clearInterval(timer)
  if (hideTimer) clearTimeout(hideTimer)
})

const phaseConfig = computed(() => {
  const p = props.phase
  if (p === 'idle') return { color: '#999', icon: 'circle', label: '空闲', pulse: false }
  if (p === 'sending') return { color: '#2196f3', icon: 'upload', label: '发送中...', pulse: true }
  if (p === 'thinking') return { color: '#ff9800', icon: 'psychology', label: '思考中...', pulse: true }
  if (p === 'tool') return { color: '#e91e63', icon: 'build', label: `调用工具`, pulse: true }
  if (p === 'replying') return { color: '#4caf50', icon: 'edit', label: '回复中...', pulse: true }
  if (p === 'cancelling') return { color: '#607d8b', icon: 'stop_circle', label: '停止中...', pulse: true }
  if (p === 'done') return { color: '#4caf50', icon: 'check_circle', label: '完成', pulse: false }
  if (p === 'error') return { color: '#f44336', icon: 'error', label: '出错', pulse: false }
  return { color: '#999', icon: 'circle', label: '', pulse: false }
})

function formatTime(s: number) {
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

function formatToken(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}
</script>

<template>
  <div v-if="visible || tokenUsage" class="agent-status" :class="{ 'idle-token-only': !visible && tokenUsage }">
    <!-- 状态指示（仅活跃时显示） -->
    <div v-if="visible" class="status-indicator" :class="{ pulse: phaseConfig.pulse }">
      <span class="status-dot" :style="{ background: phaseConfig.color }"></span>
      <JcIcon :name="phaseConfig.icon" class="status-icon" :style="{ color: phaseConfig.color }" />
      <span class="status-label">{{ phaseConfig.label }}</span>
      <span v-if="detail" class="status-detail">{{ detail }}</span>
      <span v-if="phaseConfig.pulse" class="status-timer">{{ formatTime(elapsed) }}</span>
    </div>

    <!-- 工具进度 -->
    <div v-if="toolProgress" class="tool-progress">
      <JcIcon :name="toolProgress.phase === 'result' ? 'check_circle' : 'sync'" class="tp-icon" :class="{ spinning: toolProgress.phase === 'executing' }" />
      <span class="tp-name">{{ toolProgress.name }}</span>
      <span v-if="toolProgress.phase === 'result'" class="tp-done">✓</span>
    </div>

    <!-- 工具历史（本轮已完成的） -->
    <div v-if="toolHistory.length > 0" class="tool-steps">
      <span v-for="(t, i) in toolHistory" :key="i" class="tool-step" :class="{ error: t.isError }">
        <JcIcon :name="t.isError ? 'error' : 'check'" />
        {{ t.name }}
      </span>
    </div>

    <!-- Token 用量（点击展开上下文详情） -->
    <div v-if="tokenUsage" class="token-usage" role="button" tabindex="0" @click="emit('openContextPanel')" @keydown.enter="emit('openContextPanel')">
      <span class="tu-label">Token</span>
      <span class="tu-bar">
        <span class="tu-fill" :style="{ width: tokenUsage.limit ? Math.min(100, (tokenUsage.total / tokenUsage.limit) * 100) + '%' : '0%' }" />
      </span>
      <span class="tu-text">
        ≈{{ formatToken(tokenUsage.total) }}
        <template v-if="tokenUsage.limit"> / {{ formatToken(tokenUsage.limit) }}</template>
        <template v-if="tokenUsage.input"> · 入{{ formatToken(tokenUsage.input) }}</template>
        <template v-if="tokenUsage.output"> · 出{{ formatToken(tokenUsage.output) }}</template>
      </span>
    </div>
  </div>
</template>

<style scoped>
.agent-status {
  padding: 6px 12px; margin: 0 0 4px;
  border-radius: 8px; background: var(--surface);
  border: 1px solid var(--line);
  font-size: 12px;
}
.status-indicator {
  display: flex; align-items: center; gap: 6px;
}
.status-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
}
.pulse .status-dot {
  animation: pulse-dot 1.2s infinite;
}
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
.status-icon { font-size: 16px; }
.status-label { font-weight: 600; color: var(--ink1); }
.status-detail {
  color: var(--ink2); max-width: 200px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.status-timer {
  margin-left: auto; color: var(--ink3); font-variant-numeric: tabular-nums;
}
.tool-progress {
  display: flex; align-items: center; gap: 4px;
  margin-top: 4px; padding: 3px 8px;
  background: rgba(233, 30, 99, .06); border-radius: 4px;
}
.tp-icon { font-size: 14px; color: #e91e63; }
.tp-icon.spinning { animation: spin .8s linear infinite; }
@keyframes spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }
.tp-name { font-weight: 500; color: var(--ink1); }
.tp-done { color: #4caf50; font-weight: 700; }
.tool-steps {
  display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;
}
.tool-step {
  display: flex; align-items: center; gap: 2px;
  padding: 1px 6px; border-radius: 4px;
  background: rgba(76, 175, 80, .08); color: #4caf50;
  font-size: 11px;
}
.tool-step.error { background: rgba(244, 67, 54, .08); color: #f44336; }
.tool-step .mso { font-size: 12px; }
.token-usage {
  display: flex; align-items: center; gap: 6px;
  margin-top: 5px; padding: 3px 6px;
  border-top: 1px solid var(--line);
  cursor: pointer; border-radius: 4px;
  transition: background 0.15s;
}
.token-usage:hover { background: rgba(213, 199, 135, 0.12); }
/* idle 时只显示 token 条，缩小边距 */
.agent-status.idle-token-only { padding: 2px 12px; }
.agent-status.idle-token-only .token-usage { margin-top: 0; border-top: none; padding: 2px 6px; }
.tu-label { font-size: 10px; color: var(--ink3); font-weight: 600; }
.tu-bar {
  flex: 1; height: 3px; border-radius: 2px;
  background: var(--surface); overflow: hidden;
}
.tu-fill {
  display: block; height: 100%; border-radius: 2px;
  background: var(--olive); transition: width .3s;
}
.tu-text { font-size: 10px; color: var(--ink3); white-space: nowrap; }
</style>

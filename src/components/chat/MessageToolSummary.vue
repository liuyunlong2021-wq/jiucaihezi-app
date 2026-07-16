<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ToolCall } from '@/composables/useChat'
import type { OfficeDownloadFile } from '@/utils/officeDownloads'
import { openOfficeDownloadFile } from '@/runtime/tools/artifacts'
import { buildToolDisplayModel } from './display/toolDisplayModel'
import type { ToolDisplayStatus, ToolDisplayStep } from './display/toolDisplayModel'

const props = defineProps<{
  toolCalls?: ToolCall[]
  files?: OfficeDownloadFile[]
  toolResult?: string
  isRunning?: boolean
  status?: ToolDisplayStatus
  steps?: ToolDisplayStep[]
}>()

const showDetails = ref(false)
const expandedStepIds = ref(new Set<string>())

const model = computed(() => buildToolDisplayModel({
  toolCalls: props.toolCalls || [],
  files: props.files || [],
  toolResult: props.toolResult,
  isRunning: props.isRunning,
  status: props.status,
  steps: props.steps,
}))

function stepLabel(name: string): string {
  const labels: Record<string, string> = {
    skill: '加载 Skill', read: '读取文件', glob: '查找文件', grep: '搜索文件',
    write: '写入文件', edit: '编辑文件', terminal: '运行终端命令',
  }
  return labels[name] || name
}

function toggleStep(id: string) {
  const next = new Set(expandedStepIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedStepIds.value = next
}

function stepResult(step: ToolDisplayStep): string {
  return step.result?.replace(/^Tool error:\s*/i, '').trim() || '没有收到更多说明。'
}

function prettyArgs(argsStr: string): string {
  try {
    return JSON.stringify(JSON.parse(argsStr), null, 2)
  } catch {
    return argsStr || '(无参数)'
  }
}

async function openFile(file: OfficeDownloadFile) {
  await openOfficeDownloadFile(file)
}
</script>

<template>
  <div v-if="model.visible" class="tool-summary" :class="`status-${model.status}`">
    <div class="tool-summary-head">
      <JcIcon :name="model.status === 'cancelled' ? 'cancel' : model.icon" class="tool-summary-icon" :class="{ spinning: model.status === 'running' }" />
      <div class="tool-summary-main">
        <div class="tool-summary-title">{{ model.title }}</div>
        <div class="tool-summary-subtitle">{{ model.primaryToolLabel }}</div>
      </div>
      <button
        v-if="toolCalls && toolCalls.length"
        class="tool-summary-toggle"
        type="button"
        :aria-expanded="showDetails"
        @click="showDetails = !showDetails"
      >
        <span>{{ showDetails ? '收起' : '详情' }}</span>
        <JcIcon :name="showDetails ? 'expand_less' : 'expand_more'" aria-hidden="true" />
      </button>
    </div>

    <div v-if="model.files.length" class="tool-file-list">
      <div v-for="file in model.files" :key="`${file.filename}-${file.url}`" class="tool-file-item">
        <JcIcon name="description" />
        <span class="tool-file-name" :title="file.filename">{{ file.filename }}</span>
        <span v-if="file.sizeLabel" class="tool-file-size">{{ file.sizeLabel }}</span>
        <button class="tool-file-open" type="button" @click.stop="openFile(file)">
          <JcIcon name="open_in_new" aria-hidden="true" />
          <span>打开</span>
        </button>
      </div>
    </div>

    <div v-if="steps && steps.length && (model.status !== 'succeeded' || showDetails)" class="tool-progress-list">
      <div v-for="step in steps" :key="step.toolCallId" class="tool-progress-entry" :class="{ failed: step.isError }">
        <button
          class="tool-progress-step"
          :class="{ clickable: step.isError }"
          type="button"
          :disabled="!step.isError"
          :aria-expanded="step.isError ? expandedStepIds.has(step.toolCallId) : undefined"
          @click="step.isError && toggleStep(step.toolCallId)"
        >
          <JcIcon :name="step.isError ? 'error' : step.phase === 'result' ? 'check_circle' : 'sync'" :class="{ spinning: step.phase !== 'result' }" />
          <span>{{ stepLabel(step.name) }}</span>
        </button>
        <div v-if="step.isError && expandedStepIds.has(step.toolCallId)" class="tool-step-detail">
          <div><b>要做什么</b><span>{{ stepLabel(step.name) }}</span></div>
          <div><b>结果</b><span>没有完成</span></div>
          <div><b>失败原因</b><pre>{{ stepResult(step) }}</pre></div>
          <div v-if="step.name === 'terminal'"><b>命令输出</b><pre>{{ stepResult(step) }}</pre></div>
        </div>
      </div>
    </div>

    <div v-if="showDetails && toolCalls && toolCalls.length" class="tool-summary-details">
      <div v-for="call in toolCalls" :key="call.id" class="tool-detail-item">
        <div class="tool-detail-name">{{ call.function.name }}</div>
        <pre class="tool-detail-pre">{{ prettyArgs(call.function.arguments) }}</pre>
      </div>
      <pre v-if="model.status === 'failed' && toolResult" class="tool-detail-pre">{{ toolResult }}</pre>
    </div>
  </div>
</template>

<style scoped>
.tool-summary {
  margin-top: 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 82%, var(--paper));
  overflow: hidden;
}
.tool-summary-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
}
.tool-summary-icon {
  flex: 0 0 auto;
  color: var(--olive-dark);
  font-size: 16px;
}
.tool-summary-icon.spinning {
  animation: tool-spin .8s linear infinite;
}
@keyframes tool-spin {
  from { transform: rotate(0); }
  to { transform: rotate(360deg); }
}
.tool-summary-main {
  min-width: 0;
  flex: 1;
}
.tool-summary-title {
  color: var(--ink1);
  font-size: 12px;
  font-weight: 650;
  line-height: 1.35;
}
.tool-summary-subtitle {
  color: var(--ink3);
  font-size: 11px;
  line-height: 1.35;
}
.tool-summary-toggle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ink3);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  padding: 3px 5px;
}
.tool-summary-toggle:hover,
.tool-summary-toggle:focus-visible {
  background: rgba(107,142,35,.08);
  color: var(--olive-dark);
  outline: none;
}
.tool-summary-toggle .mso {
  font-size: 15px;
}
.tool-file-list {
  display: grid;
  gap: 4px;
  padding: 0 10px 9px 34px;
}
.tool-file-item {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--ink2);
  font-size: 12px;
}
.tool-file-item .mso {
  color: var(--olive-dark);
  font-size: 15px;
}
.tool-file-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-file-size {
  flex: 0 0 auto;
  color: var(--ink3);
  font-size: 11px;
}
.tool-file-open {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface);
  color: var(--olive-dark);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  padding: 2px 6px;
}
.tool-progress-list {
  display: grid;
  gap: 4px;
  padding: 0 10px 9px 34px;
}
.tool-progress-step {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--ink2);
  text-align: left;
  font-size: 12px;
}
.tool-progress-step:disabled { cursor: default; }
.tool-progress-step.clickable { cursor: pointer; }
.tool-progress-entry.failed .tool-progress-step { color: #a12323; }
.tool-progress-step.clickable:hover { text-decoration: underline; }
.tool-progress-step .mso { color: var(--olive-dark); font-size: 14px; }
.tool-progress-entry.failed .tool-progress-step .mso { color: #a12323; }
.tool-step-detail {
  display: grid;
  gap: 5px;
  margin: 5px 0 2px 22px;
  padding: 7px 8px;
  border-left: 2px solid color-mix(in srgb, #c62828 45%, var(--line));
  color: var(--ink2);
  font-size: 11px;
}
.tool-step-detail div { display: grid; gap: 2px; }
.tool-step-detail b { color: var(--ink3); font-weight: 650; }
.tool-step-detail pre { max-height: 160px; margin: 0; overflow: auto; white-space: pre-wrap; word-break: break-word; font: inherit; }
.tool-file-open:hover,
.tool-file-open:focus-visible {
  border-color: color-mix(in srgb, var(--olive) 55%, var(--line));
  background: color-mix(in srgb, var(--olive) 8%, var(--surface));
  outline: none;
}
.tool-file-open .mso {
  font-size: 13px;
}
.tool-summary-details {
  border-top: 1px solid var(--line);
  padding: 8px 10px 10px;
}
.tool-detail-item + .tool-detail-item {
  margin-top: 8px;
}
.tool-detail-name {
  color: var(--ink3);
  font-size: 11px;
  font-weight: 650;
}
.tool-detail-pre {
  max-height: 180px;
  margin: 4px 0 0;
  padding: 7px 8px;
  overflow: auto;
  border-radius: 6px;
  background: var(--paper);
  color: var(--ink2);
  font-family: 'SF Mono', monospace;
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}
.status-succeeded {
  border-color: color-mix(in srgb, var(--olive) 38%, var(--line));
}
.status-failed {
  border-color: color-mix(in srgb, #c62828 42%, var(--line));
  background: color-mix(in srgb, var(--surface) 86%, #ffecec);
}
.status-failed .tool-summary-icon,
.status-failed .tool-summary-title {
  color: #c62828;
}
.status-cancelled {
  border-color: color-mix(in srgb, var(--ink3) 30%, var(--line));
  background: color-mix(in srgb, var(--surface) 88%, var(--paper));
}
.status-cancelled .tool-summary-icon,
.status-cancelled .tool-summary-title {
  color: var(--ink3);
}
</style>

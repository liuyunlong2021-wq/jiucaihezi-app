<script setup lang="ts">
import { computed, ref } from 'vue'
import type { OpenCodeRenderablePart } from '@/opencodeClient/timelineRows'
import {
  isContextOpenCodeTool,
  openCodePartDefaultOpen,
  safeOpenCodeJsonSummary,
  summarizeOpenCodePart,
} from '@/opencodeClient/timelineRows'
import {
  isOpenCodeShellPart,
  shellDisplayCommand,
  shellDisplayDetail,
  shellDisplayDurationLabel,
  shellDisplayErrorText,
  shellDisplayExitLabel,
  shellDisplayStderr,
  shellDisplayStdout,
  shellDisplaySubtitle,
} from '@/opencodeClient/shellDisplay'

const props = defineProps<{
  parts?: OpenCodeRenderablePart[]
}>()

const emit = defineEmits<{
  (e: 'openSubtask', sessionId: string): void
}>()

const openPartIds = ref(new Set<string>())
const closedPartIds = ref(new Set<string>())
const errorCopyLabel = ref('复制错误')

const shellToolPartsExpanded = readBooleanPreference('jcOpenCodeShellToolPartsExpanded')
// 🔧 Phase B: edit/write/apply_patch 默认展开（对齐官方），用户可在设置中关闭
const editToolPartsExpanded = readBooleanPreferenceWithDefault('jcOpenCodeEditToolPartsExpanded', true)

const visibleParts = computed(() => (props.parts || []).filter(part => {
  if (part.type === 'text' || part.type === 'reasoning') return false
  // 隐藏 todowrite（始终隐藏）
  if (part.type === 'tool' && part.toolName === 'todowrite') return false
  // 无错误且无输出的工具卡片不展示——对齐官方 OpenCode，减少视觉噪音
  if (!part.isError && part.status !== 'error' && !part.result && !part.text && part.type === 'tool') {
    const silentTools = new Set(['read', 'bash', 'write', 'edit', 'websearch', 'grep', 'glob', 'list', 'apply_patch'])
    if (silentTools.has(part.toolName || '')) return false
  }
  return true
}))

const isContextGroup = computed(() => visibleParts.value.length > 1 && visibleParts.value.every(isContextOpenCodeTool))
const contextSummary = computed(() => {
  if (!isContextGroup.value) return ''
  const names = visibleParts.value.map(part => part.toolName || part.title || 'tool')
  return `${visibleParts.value.length} 个上下文工具：${names.join(' / ')}`
})

function readBooleanPreference(key: string): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}

function readBooleanPreferenceWithDefault(key: string, defaultValue: boolean): boolean {
  try {
    if (typeof localStorage === 'undefined') return defaultValue
    const stored = localStorage.getItem(key)
    if (stored === null) return defaultValue
    return stored === 'true'
  } catch {
    return defaultValue
  }
}

function partKey(part: OpenCodeRenderablePart): string {
  return `${part.messageId}:${part.id}:${part.type}`
}

function partTitle(part: OpenCodeRenderablePart): string {
  if (isShellPart(part)) return 'Shell / Terminal'
  if (isSubtaskPart(part)) {
    const label = subtaskLabel(part)
    return label ? `Subtask / 子任务：${label}` : 'Subtask / 子任务'
  }
  if (isSkillToolPart(part)) {
    return `已加载 Skill：${skillToolName(part)}`
  }
  if (part.type === 'tool' || part.type === 'tool_call' || part.type === 'tool_result') {
    return part.toolName || part.title || 'tool'
  }
  if (part.type === 'file' || part.type === 'attachment') return part.title || '附件'
  if (part.type === 'patch' || part.type === 'diff' || part.type === 'snapshot') return part.title || '变更'
  if (part.type === 'shell') return part.title || 'Shell'
  if (part.type === 'error') return '错误'
  if (part.type === 'compaction') return '上下文压缩'
  if (part.type === 'agent') return 'Agent 切换'
  if (part.type.startsWith('step')) return '执行阶段'
  return part.title || part.type
}

function statusLabel(part: OpenCodeRenderablePart): string {
  if (part.isError || part.status === 'error') return '失败'
  if (part.status === 'pending' || part.status === 'running') return '执行中'
  if (part.status === 'completed') return '完成'
  return ''
}

function isSkillToolPart(part: OpenCodeRenderablePart): boolean {
  return part.type === 'tool' && part.toolName === 'skill'
}

function isSubtaskPart(part: OpenCodeRenderablePart): boolean {
  return part.type === 'subtask' || (part.type === 'tool' && part.toolName === 'task')
}

function parseJsonObject(text: string | undefined): Record<string, unknown> {
  if (!text) return {}
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function skillToolName(part: OpenCodeRenderablePart): string {
  const raw = part.raw as any
  const input = raw?.state?.input || raw?.input || parseJsonObject(part.input)
  const name = input?.name || input?.skill || raw?.name || raw?.skill
  return String(name || 'unknown')
}

function subtaskInput(part: OpenCodeRenderablePart): Record<string, unknown> {
  const raw = part.raw as any
  return raw?.state?.input || raw?.input || parseJsonObject(part.input)
}

function subtaskLabel(part: OpenCodeRenderablePart): string {
  const raw = part.raw as any
  const input = subtaskInput(part)
  return String(
    input?.description
    || input?.prompt
    || input?.agent
    || raw?.description
    || raw?.prompt
    || raw?.agent
    || '',
  ).slice(0, 80)
}

function subtaskSessionId(part: OpenCodeRenderablePart): string {
  const raw = part.raw as any
  const input = subtaskInput(part)
  return String(
    raw?.sessionID
    || raw?.sessionId
    || raw?.childSessionID
    || raw?.childSessionId
    || raw?.state?.sessionID
    || raw?.state?.sessionId
    || raw?.state?.result?.sessionID
    || raw?.state?.result?.sessionId
    || raw?.result?.sessionID
    || raw?.result?.sessionId
    || input?.sessionID
    || input?.sessionId
    || '',
  )
}

function partSubtitle(part: OpenCodeRenderablePart): string {
  if (isShellPart(part)) return shellSubtitle(part)
  if (isSubtaskPart(part)) {
    const sessionId = subtaskSessionId(part)
    if (part.status === 'pending' || part.status === 'running') return 'OpenCode task tool 正在运行子任务'
    if (part.status === 'error' || part.isError) return '子任务执行失败，请展开查看错误详情'
    return sessionId ? `子会话 ${sessionId}` : 'OpenCode task tool 子任务'
  }
  if (isSkillToolPart(part)) {
    if (part.status === 'error' || part.isError) return 'Skill 加载失败，请检查名称、权限或扫描路径'
    if (part.status === 'pending' || part.status === 'running') return '正在通过 OpenCode skill 工具加载 SKILL.md'
    return 'OpenCode 官方 skill tool 已返回 SKILL.md 内容'
  }
  if (part.type !== 'tool') return summarizeOpenCodePart(part.raw || part)
  return part.input || ''
}

function toolErrorText(part: OpenCodeRenderablePart): string {
  if (isShellPart(part)) return shellDisplayErrorText(part)
  const raw = part.raw as any
  return String(
    raw?.state?.error?.message
    || raw?.state?.error
    || raw?.error?.message
    || raw?.error
    || part.result
    || '工具执行失败',
  )
}

function detailText(part: OpenCodeRenderablePart): string {
  if (part.result) return part.result
  if (part.type === 'tool' || part.type === 'tool_call' || part.type === 'tool_result') return part.input || ''
  if (part.text) return part.text
  return summarizeOpenCodePart(part.raw || part)
}

function rawText(part: OpenCodeRenderablePart): string {
  return safeOpenCodeJsonSummary(part.raw || part, 3000)
}

function isDiffPart(part: OpenCodeRenderablePart): boolean {
  return part.type === 'patch' || part.type === 'diff' || part.type === 'snapshot'
}

function coloredDiffHtml(part: OpenCodeRenderablePart): string {
  const text = part.result || part.text || detailText(part)
  if (!text) return ''
  const lines = text.split('\n')
  return lines.map(line => {
    const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    if (line.startsWith('+') && !line.startsWith('+++')) return `<span class="diff-add">${escaped}</span>`
    if (line.startsWith('-') && !line.startsWith('---')) return `<span class="diff-del">${escaped}</span>`
    if (line.startsWith('@@')) return `<span class="diff-hunk">${escaped}</span>`
    return escaped
  }).join('\n')
}

function toolDuration(part: OpenCodeRenderablePart): string {
  const raw = part.raw as any
  const start = raw?.time?.start || raw?.startedAtMs
  const end = raw?.time?.end || raw?.time?.completed || raw?.finishedAtMs
  if (!start || !end) return ''
  const ms = Number(end) - Number(start)
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

const isShellPart = isOpenCodeShellPart
const shellCommand = shellDisplayCommand
const shellDetail = shellDisplayDetail
const shellStdout = shellDisplayStdout
const shellStderr = shellDisplayStderr
const shellExitLabel = shellDisplayExitLabel
const shellDurationLabel = shellDisplayDurationLabel
const shellSubtitle = shellDisplaySubtitle

function isOpen(part: OpenCodeRenderablePart): boolean {
  const key = partKey(part)
  if (openPartIds.value.has(key)) return true
  if (closedPartIds.value.has(key)) return false
  return Boolean(openCodePartDefaultOpen(part, {
    shellToolPartsExpanded,
    editToolPartsExpanded,
  }))
}

function toggle(part: OpenCodeRenderablePart) {
  const key = partKey(part)
  const nextOpen = new Set(openPartIds.value)
  const nextClosed = new Set(closedPartIds.value)
  if (isOpen(part)) {
    nextOpen.delete(key)
    nextClosed.add(key)
  } else {
    nextClosed.delete(key)
    nextOpen.add(key)
  }
  openPartIds.value = nextOpen
  closedPartIds.value = nextClosed
}

async function copyErrorDetail(part: OpenCodeRenderablePart) {
  const text = toolErrorText(part)
  try {
    await navigator.clipboard?.writeText(text)
    errorCopyLabel.value = '已复制'
  } catch {
    errorCopyLabel.value = '复制失败'
  }
  setTimeout(() => { errorCopyLabel.value = '复制错误' }, 1200)
}
</script>

<template>
  <div
    v-if="visibleParts.length"
    class="opencode-parts"
    :class="{ 'context-group': isContextGroup }"
  >
    <div v-if="isContextGroup" class="opencode-context-group">
      <JcIcon name="manage_search" class="opencode-context-icon" />
      <div class="opencode-context-main">
        <div class="opencode-context-title">上下文读取</div>
        <div class="opencode-context-summary">{{ contextSummary }}</div>
      </div>
    </div>
    <div
      v-for="part in visibleParts"
      :key="partKey(part)"
      class="opencode-part"
      :class="[`type-${part.type}`, `status-${part.status || 'unknown'}`, { error: part.isError, 'skill-tool-card': isSkillToolPart(part), 'subtask-tool-card': isSubtaskPart(part) }]"
    >
      <div v-if="part.status === 'error'" class="opencode-tool-error-card">
        <div class="opencode-tool-error-head">
          <JcIcon name="error" />
          <div>
            <strong>{{ partTitle(part) }}</strong>
            <span>工具执行失败</span>
          </div>
          <button type="button" @click="copyErrorDetail(part)">{{ errorCopyLabel }}</button>
        </div>
        <!-- 🔧 Phase B: 提升视觉密度 — 显示工具输入参数 + 错误详情 -->
        <div v-if="part.input" class="opencode-tool-error-input">
          <span class="opencode-tool-error-label">输入参数</span>
          <pre>{{ part.input }}</pre>
        </div>
        <div class="opencode-tool-error-output">
          <span class="opencode-tool-error-label">错误信息</span>
          <pre>{{ toolErrorText(part) }}</pre>
        </div>
      </div>
      <div class="opencode-part-head">
        <JcIcon :name="part.isError || part.status === 'error' ? 'error' : part.type === 'tool' || part.type === 'shell' ? 'terminal' : part.type === 'file' ? 'description' : 'notes'" class="opencode-part-icon" :class="{ spinning: part.status === 'running' || part.status === 'pending' }" />
        <div class="opencode-part-main">
          <div class="opencode-part-title">
            {{ partTitle(part) }}
            <span v-if="toolDuration(part)" class="opencode-part-duration">{{ toolDuration(part) }}</span>
          </div>
          <div class="opencode-part-subtitle">
            <span v-if="statusLabel(part)">{{ statusLabel(part) }}</span>
            <span>{{ partSubtitle(part) }}</span>
          </div>
        </div>
        <button class="opencode-part-toggle" type="button" :aria-expanded="isOpen(part)" @click="toggle(part)">
          <span>{{ isOpen(part) ? '收起' : '详情' }}</span>
          <JcIcon :name="isOpen(part) ? 'expand_less' : 'expand_more'" aria-hidden="true" />
        </button>
      </div>
      <div v-if="isSubtaskPart(part)" class="opencode-subtask-actions">
        <button
          type="button"
          :disabled="!subtaskSessionId(part)"
          @click="emit('openSubtask', subtaskSessionId(part))"
        >
          <JcIcon name="open_in_new" />
          打开子任务会话
        </button>
        <span v-if="!subtaskSessionId(part)">当前 task 结果未返回子会话 ID</span>
      </div>
      <div v-if="isShellPart(part)" class="opencode-terminal">
        <div class="opencode-terminal-command">
          <JcIcon name="terminal" />
          <code>{{ shellCommand(part) || 'shell command' }}</code>
          <b v-if="shellExitLabel(part)">{{ shellExitLabel(part) }}</b>
          <b v-if="shellDurationLabel(part)">{{ shellDurationLabel(part) }}</b>
        </div>
        <div v-if="shellStdout(part)" class="opencode-terminal-stream stdout">
          <span>stdout</span>
          <pre>{{ shellStdout(part) }}</pre>
        </div>
        <div v-if="shellStderr(part)" class="opencode-terminal-stream stderr">
          <span>stderr</span>
          <pre>{{ shellStderr(part) }}</pre>
        </div>
        <div v-if="!shellStdout(part) && !shellStderr(part)" class="opencode-terminal-empty">
          暂无 shell 输出
        </div>
      </div>
      <div v-if="isOpen(part)" class="opencode-part-detail">
        <pre v-if="isDiffPart(part)" v-html="coloredDiffHtml(part)" class="diff-view" />
        <pre v-else>{{ isShellPart(part) ? shellDetail(part) : (detailText(part) || rawText(part)) }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.opencode-parts {
  display: grid;
  gap: 6px;
  margin-top: 8px;
}
.opencode-parts.context-group {
  gap: 4px;
}
.opencode-context-group {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 9px;
  border: 1px solid color-mix(in srgb, var(--olive) 28%, var(--line));
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 90%, var(--olive));
}
.opencode-context-icon {
  color: var(--olive-dark);
  font-size: 16px;
}
.opencode-context-main {
  min-width: 0;
}
.opencode-context-title {
  color: var(--ink1);
  font-size: 12px;
  font-weight: 750;
  line-height: 1.35;
}
.opencode-context-summary {
  color: var(--ink3);
  font-size: 11px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.opencode-part {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 84%, var(--paper));
  overflow: hidden;
}
.opencode-part.error,
.opencode-part.status-error {
  border-color: color-mix(in srgb, #c62828 42%, var(--line));
  background: color-mix(in srgb, var(--surface) 86%, #ffecec);
}
.opencode-part.subtask-tool-card {
  border-color: color-mix(in srgb, var(--olive) 32%, var(--line));
  background: color-mix(in srgb, var(--surface) 90%, var(--olive-pale));
}
.opencode-part-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
}
.opencode-part-icon {
  flex: 0 0 auto;
  color: var(--olive-dark);
  font-size: 16px;
}
.opencode-part.error .opencode-part-icon,
.opencode-part.status-error .opencode-part-icon {
  color: #c62828;
}
.opencode-tool-error-card {
  border-bottom: 1px solid color-mix(in srgb, #c62828 30%, var(--line));
  background: color-mix(in srgb, var(--surface) 88%, #ffecec);
}
.opencode-tool-error-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px 6px;
}
.opencode-tool-error-head .mso {
  color: #c62828;
  font-size: 17px;
}
.opencode-tool-error-head div {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 1px;
}
.opencode-tool-error-head strong {
  color: var(--ink1);
  font-size: 12px;
}
.opencode-tool-error-head span:not(.mso) {
  color: #c62828;
  font-size: 11px;
}
.opencode-tool-error-head button {
  border: 1px solid color-mix(in srgb, #c62828 30%, var(--line));
  border-radius: 6px;
  background: var(--paper);
  color: #c62828;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  padding: 3px 6px;
}
.opencode-tool-error-card pre {
  max-height: 140px;
  margin: 0;
  padding: 6px 8px;
  overflow: auto;
  border-radius: 4px;
  background: var(--paper);
  color: #8a1c1c;
  font-family: 'SF Mono', monospace;
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}
.opencode-tool-error-input,
.opencode-tool-error-output {
  padding: 0 10px 8px;
}
.opencode-tool-error-label {
  display: block;
  color: var(--ink3);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 3px;
}
.opencode-part-icon.spinning {
  animation: opencode-spin .8s linear infinite;
}
@keyframes opencode-spin {
  from { transform: rotate(0); }
  to { transform: rotate(360deg); }
}
.opencode-part-main {
  min-width: 0;
  flex: 1;
}
.opencode-part-title {
  color: var(--ink1);
  font-size: 12px;
  font-weight: 650;
  line-height: 1.35;
}
.opencode-part-subtitle {
  color: var(--ink3);
  font-size: 11px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.opencode-part-subtitle span + span::before {
  content: " · ";
}
.opencode-subtask-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px 8px 34px;
  color: var(--ink3);
  font-size: 11px;
}
.opencode-subtask-actions button {
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface);
  color: var(--ink2);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 11px;
  font-weight: 750;
  padding: 4px 7px;
}
.opencode-subtask-actions button:disabled {
  cursor: default;
  opacity: .55;
}
.opencode-subtask-actions button:not(:disabled):hover {
  border-color: var(--olive);
  color: var(--olive-dark);
}
.opencode-terminal {
  display: grid;
  gap: 6px;
  margin: 0 10px 8px 34px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 82%, #111);
  overflow: hidden;
}
.opencode-terminal-command {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--line) 78%, #111);
  background: color-mix(in srgb, var(--surface) 74%, #111);
}
.opencode-terminal-command .mso {
  color: var(--olive-dark);
  font-size: 15px;
}
.opencode-terminal-command code {
  min-width: 0;
  overflow: hidden;
  color: var(--ink1);
  font-family: 'SF Mono', monospace;
  font-size: 11px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.opencode-terminal-command b {
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--ink3);
  font-size: 10px;
  font-weight: 750;
  padding: 1px 5px;
  white-space: nowrap;
}
.opencode-terminal-stream {
  display: grid;
  gap: 3px;
  padding: 0 8px 8px;
}
.opencode-terminal-stream span,
.opencode-terminal-empty {
  color: var(--ink3);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}
.opencode-terminal-stream pre {
  max-height: 240px;
  margin: 0;
  padding: 7px 8px;
  overflow: auto;
  border-radius: 6px;
  background: color-mix(in srgb, var(--paper) 88%, #111);
  color: var(--ink2);
  font-family: 'SF Mono', monospace;
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}
.opencode-terminal-stream.stderr pre {
  background: color-mix(in srgb, var(--paper) 88%, #c62828);
  color: #8a1c1c;
}
.opencode-terminal-empty {
  padding: 0 8px 8px;
  text-transform: none;
  letter-spacing: 0;
}
.opencode-part-toggle {
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
.opencode-part-toggle:hover,
.opencode-part-toggle:focus-visible {
  background: rgba(107,142,35,.08);
  color: var(--olive-dark);
  outline: none;
}
.opencode-part-toggle .mso {
  font-size: 15px;
}
.opencode-part-detail {
  border-top: 1px solid var(--line);
  padding: 8px 10px 10px;
}
.opencode-part-detail pre {
  max-height: 220px;
  margin: 0;
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

/* Phase A: Diff 内联渲染 */
.opencode-part-detail .diff-view {
  font-family: 'SF Mono', monospace;
  font-size: 11px;
  line-height: 1.55;
  color: var(--ink2);
  background: var(--paper);
}
.opencode-part-detail .diff-view :deep(.diff-add) {
  color: #1b7a1b;
  background: rgba(27, 122, 27, 0.08);
  display: block;
}
.opencode-part-detail .diff-view :deep(.diff-del) {
  color: #c62828;
  background: rgba(198, 40, 40, 0.08);
  display: block;
}
.opencode-part-detail .diff-view :deep(.diff-hunk) {
  color: #1565c0;
  background: rgba(21, 101, 192, 0.06);
  display: block;
  font-weight: 700;
}

/* Phase B: 工具执行时长 */
.opencode-part-duration {
  margin-left: 6px;
  font-size: 10px;
  font-weight: 500;
  color: var(--ink3);
  background: color-mix(in srgb, var(--line) 40%, transparent);
  border-radius: 4px;
  padding: 1px 5px;
}
</style>

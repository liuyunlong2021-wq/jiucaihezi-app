<script setup lang="ts">
import { computed, ref } from 'vue'
import type { OpenCodeRenderablePart } from '@/opencodeClient/timelineRows'
import {
  isContextOpenCodeTool,
  openCodePartDefaultOpen,
  safeOpenCodeJsonSummary,
  summarizeOpenCodePart,
} from '@/opencodeClient/timelineRows'
import ToolStatusTitle from './ToolStatusTitle.vue'
import AnimatedCountList, { type CountItem } from './AnimatedCountList.vue'
import ToolErrorCard from './ToolErrorCard.vue'
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
  (e: 'previewImage', payload: { url: string; mime: string; title: string }): void
  (e: 'downloadImage', url: string): void
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

const contextParts = computed(() => visibleParts.value.filter(isContextOpenCodeTool))
const normalParts = computed(() => visibleParts.value.filter(part => !isContextOpenCodeTool(part)))
const isContextGroup = computed(() => contextParts.value.length > 0)
const contextOpen = ref(false)

// 对齐官方 contextToolSummary: 统计 read/glob+grep/list 的数量
const contextCountItems = computed<CountItem[]>(() => {
  const parts = contextParts.value
  const read = parts.filter(p => p.toolName === 'read').length
  const search = parts.filter(p => p.toolName === 'glob' || p.toolName === 'grep').length
  const list = parts.filter(p => p.toolName === 'list').length
  return [
    { key: 'read', count: read, one: 'read', other: 'reads' },
    { key: 'search', count: search, one: 'search', other: 'searches' },
    { key: 'list', count: list, one: 'list', other: 'lists' },
  ]
})
const contextSummary = computed(() => {
  if (!isContextGroup.value) return ''
  const names = contextParts.value.map(part => part.toolName || part.title || 'tool')
  return `${contextParts.value.length} 个上下文工具：${names.join(' / ')}`
})

// 对齐官方 agentTones: 给不同 agent 分配独立颜色（message-part.tsx:322-333）
const AGENT_TONE_PALETTE = [
  'var(--icon-agent-ask-base)',
  'var(--icon-agent-build-base)',
  'var(--icon-agent-docs-base)',
  'var(--icon-agent-plan-base)',
]
function getAgentTone(name: string): string {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return AGENT_TONE_PALETTE[hash % AGENT_TONE_PALETTE.length] || AGENT_TONE_PALETTE[0]
}

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
  if (part.type === 'file' || part.type === 'attachment') {
    // ponytail: 图片型 file part 已渲染实际图片，标题去重避免双显示
    if (isImageFilePart(part)) return part.title || '🖼 图片'
    const raw = part.raw as any
    const name = raw?.name || raw?.filename || part.title || ''
    const mime = raw?.mime || raw?.mimeType || ''
    const size = raw?.size || raw?.fileSize
    const sizeStr = size ? ` (${formatFileSize(size)})` : ''
    const mimeStr = mime ? ` [${mime}]` : ''
    return name ? `📎 ${name}${mimeStr}${sizeStr}` : (part.title || '附件')
  }
  if (part.type === 'image') return part.title || '🖼 图片'
  if (part.type === 'snapshot') return part.title || '📸 快照'
  if (part.type === 'patch' || part.type === 'diff') return part.title || '变更'
  if (part.type === 'shell') return part.title || 'Shell'
  if (part.type === 'error') return '错误'
  if (part.type === 'compaction') return '上下文压缩'
  if (part.type === 'agent') return 'Agent 切换'
  if (part.type.startsWith('step')) return '执行阶段'
  return part.title || part.type
}

function contextToolInput(part: OpenCodeRenderablePart): Record<string, unknown> {
  const raw = part.raw as any
  return raw?.state?.input || raw?.input || parseJsonObject(part.input)
}

function contextToolTitle(part: OpenCodeRenderablePart): string {
  if (part.toolName === 'read') return 'Read files'
  if (part.toolName === 'list') return 'List files'
  if (part.toolName === 'glob') return 'Find files'
  if (part.toolName === 'grep') return 'Search files'
  return partTitle(part)
}

function contextToolSubtitle(part: OpenCodeRenderablePart): string {
  const input = contextToolInput(part)
  return String(input.filePath || input.path || input.pattern || partSubtitle(part) || '')
}

function contextToolArgs(part: OpenCodeRenderablePart): string[] {
  const input = contextToolInput(part)
  return ['pattern', 'include', 'offset', 'limit']
    .flatMap(key => input[key] === undefined ? [] : [`${key}=${input[key]}`])
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function isDiffPart(part: OpenCodeRenderablePart): boolean {
  return part.type === 'patch' || part.type === 'diff'
}

function isImageFilePart(part: OpenCodeRenderablePart): boolean {
  if (part.type !== 'file') return false
  const raw = part.raw as any
  const mime = raw?.mime || raw?.mimeType || ''
  return typeof mime === 'string' && mime.startsWith('image/')
}

function isSnapshotPart(part: OpenCodeRenderablePart): boolean {
  return part.type === 'snapshot'
}

function imagePartUrl(part: OpenCodeRenderablePart): string {
  const raw = part.raw as any
  return raw?.url || part.result || part.text || ''
}

function mimeCategory(mime: string): string {
  if (!mime) return 'unknown'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('text/')) return 'text'
  if (mime.includes('pdf')) return 'pdf'
  if (mime.includes('json') || mime.includes('xml') || mime.includes('yaml')) return 'data'
  return 'unknown'
}

function fileContentText(part: OpenCodeRenderablePart): string {
  const raw = part.raw as any
  return raw?.content || part.result || part.text || ''
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
    <!-- 对齐官方 ContextToolGroup（message-part.tsx:991-1070） -->
    <div v-if="isContextGroup" class="opencode-context-group">
      <button
        type="button"
        data-component="context-tool-group-trigger"
        class="opencode-context-trigger"
        :aria-expanded="contextOpen"
        @click="contextOpen = !contextOpen"
      >
        <span class="opencode-context-title">
          <ToolStatusTitle
            :active="contextParts.some(p => p.status === 'pending' || p.status === 'running')"
            activeText="正在收集上下文"
            doneText="已收集上下文"
          />
        </span>
        <span class="opencode-context-summary">
          <AnimatedCountList :items="contextCountItems" />
        </span>
        <JcIcon :name="contextOpen ? 'expand_less' : 'expand_more'" aria-hidden="true" />
      </button>
      <div v-if="contextOpen" data-component="context-tool-group-list" class="opencode-context-list">
        <div
          v-for="part in contextParts"
          :key="partKey(part)"
          data-slot="context-tool-group-item"
          class="opencode-context-item"
        >
          <div data-component="tool-trigger">
            <div data-slot="basic-tool-tool-trigger-content">
              <JcIcon :name="part.toolName === 'list' ? 'format_list_bulleted' : part.toolName === 'read' ? 'article' : 'search'" data-slot="icon-svg" />
              <div data-slot="basic-tool-tool-info">
                <div data-slot="basic-tool-tool-info-structured">
                  <div data-slot="basic-tool-tool-info-main">
                    <span data-slot="basic-tool-tool-title">{{ contextToolTitle(part) }}</span>
                    <span v-if="contextToolSubtitle(part)" data-slot="basic-tool-tool-subtitle">{{ contextToolSubtitle(part) }}</span>
                    <span v-for="arg in contextToolArgs(part)" :key="arg" data-slot="basic-tool-tool-arg">{{ arg }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <pre v-if="detailText(part)" data-scrollable="true" class="opencode-context-output">{{ detailText(part) }}</pre>
        </div>
      </div>
    </div>
    <div
      v-for="part in normalParts"
      :key="partKey(part)"
      class="opencode-part"
      :class="[`type-${part.type}`, `status-${part.status || 'unknown'}`, { error: part.isError, 'skill-tool-card': isSkillToolPart(part), 'subtask-tool-card': isSubtaskPart(part) }]"
    >
      <!-- 对齐官方 ToolErrorCard（message-part.tsx:1450） -->
      <div v-if="part.status === 'error'" class="opencode-tool-error-wrap">
        <ToolErrorCard
          :tool="part.toolName || part.type"
          :error="toolErrorText(part)"
          :title="partTitle(part)"
          :default-open="isOpen(part)"
        />
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
          <pre data-scrollable="true">{{ shellStdout(part) }}</pre>
        </div>
        <div v-if="shellStderr(part)" class="opencode-terminal-stream stderr">
          <span>stderr</span>
          <pre data-scrollable="true">{{ shellStderr(part) }}</pre>
        </div>
        <div v-if="!shellStdout(part) && !shellStderr(part)" class="opencode-terminal-empty">
          暂无 shell 输出
        </div>
      </div>
      <!-- 图片 Part（image 类型 或 图片型 file part） -->
      <div v-if="part.type === 'image' || isImageFilePart(part)" class="opencode-image">
        <img
          v-if="imagePartUrl(part)"
          :src="imagePartUrl(part)"
          :alt="part.title || '图片'"
          loading="lazy"
          style="max-width:100%;max-height:400px;border-radius:6px;margin:4px 0;cursor:pointer"
          @click="emit('previewImage', { url: imagePartUrl(part), mime: (part.raw as any)?.mime || 'image/png', title: part.title || '图片' })"
        />
        <span v-else class="opencode-image-placeholder">🖼 图片（无可用链接）</span>
        <button
          v-if="imagePartUrl(part)"
          class="opencode-image-download"
          type="button"
          @click.stop="emit('downloadImage', imagePartUrl(part))"
        >
          <JcIcon name="download" />
        </button>
      </div>
      <!-- 快照 Part：代码块视图（非 diff 着色） -->
      <div v-if="isSnapshotPart(part) && isOpen(part)" class="opencode-snapshot-view">
        <pre data-scrollable="true"><code>{{ part.result || part.text || detailText(part) }}</code></pre>
      </div>
      <div v-if="isOpen(part) && !isSnapshotPart(part)" class="opencode-part-detail">
        <!-- 文件 Part：结构化详情 -->
        <div v-if="part.type === 'file' || part.type === 'attachment'" class="opencode-file-detail">
          <div class="ofd-meta">
            <span v-if="(part.raw as any)?.mime || (part.raw as any)?.mimeType" class="ofd-mime-badge" :class="'mime-' + mimeCategory((part.raw as any)?.mime || (part.raw as any)?.mimeType)">
              {{ (part.raw as any)?.mime || (part.raw as any)?.mimeType }}
            </span>
            <span v-if="(part.raw as any)?.size || (part.raw as any)?.fileSize" class="ofd-size">{{ formatFileSize((part.raw as any)?.size || (part.raw as any)?.fileSize) }}</span>
          </div>
          <div v-if="fileContentText(part)" class="ofd-preview">
            <pre data-scrollable="true"><code>{{ fileContentText(part).slice(0, 3000) }}</code></pre>
          </div>
          <div v-else class="ofd-raw">
            <pre data-scrollable="true">{{ detailText(part) || rawText(part) }}</pre>
          </div>
        </div>
        <pre v-else-if="isDiffPart(part)" data-scrollable="true" v-html="coloredDiffHtml(part)" class="diff-view" />
        <pre v-else data-scrollable="true">{{ isShellPart(part) ? shellDetail(part) : (detailText(part) || rawText(part)) }}</pre>
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
  display: grid;
  gap: 6px;
  padding: 6px 9px;
  border: 1px solid color-mix(in srgb, var(--olive) 28%, var(--line));
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 90%, var(--olive));
}
.opencode-context-trigger {
  width: 100%;
  min-width: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  cursor: pointer;
}
.opencode-context-trigger :deep(.jc-icon),
.opencode-context-trigger :deep(.mso) {
  color: var(--ink3);
  font-size: 16px;
}
.opencode-context-list {
  display: grid;
  gap: 8px;
  padding-top: 4px;
}
.opencode-context-item {
  min-width: 0;
}
.opencode-context-title {
  flex: 0 0 auto;
  color: var(--ink1);
  font-size: 12px;
  font-weight: 750;
  line-height: 1.35;
}
.opencode-context-summary {
  flex: 1 1 auto;
  color: var(--ink3);
  font-size: 11px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.opencode-context-output {
  max-height: 220px;
  margin: 4px 0 0 24px;
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
[data-component="tool-trigger"] {
  width: 100%;
  display: flex;
  align-items: center;
}
[data-slot="basic-tool-tool-trigger-content"] {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
[data-slot="basic-tool-tool-info"],
[data-slot="basic-tool-tool-info-structured"],
[data-slot="basic-tool-tool-info-main"] {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
}
[data-slot="basic-tool-tool-title"] {
  flex-shrink: 0;
  color: var(--ink1);
  font-size: 13px;
  font-weight: 650;
}
[data-slot="basic-tool-tool-subtitle"],
[data-slot="basic-tool-tool-arg"] {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink3);
  font-size: 13px;
}
.opencode-part {
  /* 默认无边框无背景 — 纯文本自然流，对齐官方 TUI */
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  margin-bottom: 2px;
}
/* 仅工具/shell/文件/错误/快照/diff 保留轻量卡片区分 */
.opencode-part.type-tool,
.opencode-part.type-shell,
.opencode-part.type-file,
.opencode-part.type-attachment,
.opencode-part.type-image,
.opencode-part.type-snapshot,
.opencode-part.type-patch,
.opencode-part.type-diff,
.opencode-part.type-error {
  border: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--surface) 80%, transparent);
  padding: 4px 6px;
  margin-bottom: 4px;
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
  gap: 6px;
  padding: 2px 0;
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
  margin: 4px 0 4px 20px;
  /* 对齐官方：终端不展示为独立卡片 */
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

/* P1-1: 图片 Part 样式 */
.opencode-image {
  position: relative;
  display: inline-block;
  max-width: 100%;
}
.opencode-image-placeholder {
  color: var(--ink3);
  font-size: 13px;
  padding: 12px;
  display: inline-block;
  background: var(--surface);
  border-radius: 6px;
}
.opencode-image-download {
  position: absolute;
  top: 6px;
  right: 6px;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 4px 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  opacity: 0;
  transition: opacity 0.2s;
}
.opencode-image:hover .opencode-image-download {
  opacity: 1;
}

/* P1-2: 快照 Part 样式（代码块视图） */
.opencode-snapshot-view {
  margin-top: 6px;
  padding: 0;
}
.opencode-snapshot-view pre {
  margin: 0;
  padding: 10px 12px;
  background: var(--paper);
  border-radius: 6px;
  overflow-x: auto;
  font-family: 'SF Mono', monospace;
  font-size: 12px;
  line-height: 1.55;
  color: var(--ink1);
  border: 1px solid var(--line);
}
.opencode-snapshot-view code {
  white-space: pre;
}

/* P3-2: 文件 Part 结构化详情 */
.opencode-file-detail { margin-top: 6px; }
.ofd-meta {
  display: flex; gap: 8px; align-items: center; margin-bottom: 6px;
}
.ofd-mime-badge {
  padding: 2px 8px; border-radius: 4px;
  font-size: 11px; font-weight: 600; color: #fff;
  background: var(--ink3);
}
.ofd-mime-badge.mime-image { background: #2196f3; }
.ofd-mime-badge.mime-video { background: #9c27b0; }
.ofd-mime-badge.mime-audio { background: #ff9800; }
.ofd-mime-badge.mime-text { background: #4caf50; }
.ofd-mime-badge.mime-pdf { background: #f44336; }
.ofd-mime-badge.mime-data { background: #607d8b; }
.ofd-size { font-size: 11px; color: var(--ink3); }
.ofd-preview pre {
  margin: 0; padding: 8px 10px;
  background: var(--paper); border-radius: 6px;
  font-family: 'SF Mono', monospace; font-size: 11px;
  line-height: 1.5; color: var(--ink1);
  overflow-x: auto; max-height: 300px;
  border: 1px solid var(--line);
}
.ofd-raw pre {
  margin: 0; padding: 8px 10px; font-size: 10px;
  color: var(--ink3); max-height: 200px; overflow-x: auto;
}
</style>

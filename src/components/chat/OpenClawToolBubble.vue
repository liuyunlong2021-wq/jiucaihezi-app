<script setup lang="ts">
/**
 * OpenClawToolBubble — OpenClaw 工具调用气泡
 *
 * 根据工具类型渲染不同的交互 UI：
 * - exec: 命令预览 + 执行/拒绝按钮 + 结果输出
 * - read/write/edit: 文件路径 + 内容预览 + 打开按钮
 * - browser: URL + 截图
 * - cron: 定时任务确认
 */
import { computed, ref } from 'vue'
import { approveExec, denyExec } from '@/utils/openclawBridge'
import { emitEvent } from '@/utils/eventBus'
import { isTauriRuntime } from '@/utils/tauriEnv'

const props = defineProps<{
  callId: string
  toolName: string
  args: Record<string, unknown>
  status: string
  requiresApproval: boolean
  result?: unknown
  error?: string
}>()

const approving = ref(false)

// 工具类型分类
const toolCategory = computed(() => {
  const name = props.toolName
  if (name === 'exec' || name === 'bash' || name === 'shell') return 'exec'
  if (name === 'read' || name === 'file_read') return 'file_read'
  if (name === 'write' || name === 'file_write') return 'file_write'
  if (name === 'edit' || name === 'apply_patch') return 'file_edit'
  if (name === 'browser') return 'browser'
  if (name === 'cron') return 'cron'
  return 'other'
})

const toolIcon = computed(() => {
  const icons: Record<string, string> = {
    exec: 'terminal',
    file_read: 'description',
    file_write: 'save',
    file_edit: 'edit_document',
    browser: 'public',
    cron: 'schedule',
    other: 'build',
  }
  return icons[toolCategory.value] || 'build'
})

const toolLabel = computed(() => {
  const labels: Record<string, string> = {
    exec: '执行命令',
    file_read: '读取文件',
    file_write: '写入文件',
    file_edit: '编辑文件',
    browser: '浏览器操作',
    cron: '定时任务',
    other: props.toolName,
  }
  return labels[toolCategory.value] || props.toolName
})

const statusLabel = computed(() => {
  const labels: Record<string, string> = {
    pending: '等待确认',
    approved: '已批准',
    denied: '已拒绝',
    running: '执行中...',
    done: '已完成',
    error: '执行失败',
  }
  return labels[props.status] || props.status
})

const statusClass = computed(() => {
  if (props.status === 'done') return 'status-done'
  if (props.status === 'error' || props.status === 'denied') return 'status-error'
  if (props.status === 'running') return 'status-running'
  if (props.status === 'pending') return 'status-pending'
  return ''
})

// exec 相关
const execCommand = computed(() => String(props.args.command || props.args.cmd || ''))
const execWorkdir = computed(() => String(props.args.workdir || props.args.cwd || ''))

// file 相关
const filePath = computed(() => String(props.args.path || props.args.file || props.args.filename || ''))
const fileContent = computed(() => String(props.args.content || ''))

// browser 相关
const browserAction = computed(() => String(props.args.action || ''))
const browserUrl = computed(() => String(props.args.url || ''))

// cron 相关
const cronSchedule = computed(() => String(props.args.schedule || props.args.cron || ''))
const cronCommand = computed(() => String(props.args.command || props.args.task || ''))

// 结果格式化
const resultText = computed(() => {
  if (!props.result) return ''
  if (typeof props.result === 'string') return props.result
  return JSON.stringify(props.result, null, 2)
})

async function handleApprove() {
  approving.value = true
  try {
    await approveExec(props.callId)
  } catch {}
  approving.value = false
}

async function handleDeny() {
  try {
    await denyExec(props.callId)
  } catch {}
}

function openInEditor(content: string, lang?: string) {
  emitEvent('switch-panel', 'editor')
  setTimeout(() => {
    emitEvent('editor-set-content', { content, language: lang || 'text' })
  }, 100)
}

async function openInFinder(path: string) {
  if (isTauriRuntime()) {
    try {
      const { open } = await import('@tauri-apps/plugin-shell')
      // 打开文件所在目录
      const dir = path.substring(0, path.lastIndexOf('/')) || path
      await open(dir)
    } catch {}
  }
}
</script>

<template>
  <div class="otb" :class="statusClass">
    <!-- 头部 -->
    <div class="otb-header">
      <span class="mso otb-icon">{{ toolIcon }}</span>
      <span class="otb-label">{{ toolLabel }}</span>
      <span class="otb-status" :class="statusClass">{{ statusLabel }}</span>
    </div>

    <!-- exec: 命令预览 -->
    <template v-if="toolCategory === 'exec'">
      <div class="otb-code-box">
        <div v-if="execWorkdir" class="otb-workdir">{{ execWorkdir }}</div>
        <pre class="otb-command">{{ execCommand }}</pre>
      </div>
      <!-- 审批按钮 -->
      <div v-if="requiresApproval && status === 'pending'" class="otb-actions">
        <button class="otb-btn otb-btn-approve" @click="handleApprove" :disabled="approving">
          <span class="mso">play_arrow</span> 执行
        </button>
        <button class="otb-btn otb-btn-deny" @click="handleDeny">
          <span class="mso">block</span> 拒绝
        </button>
      </div>
    </template>

    <!-- file read/write/edit: 文件路径 + 内容 -->
    <template v-else-if="toolCategory === 'file_read' || toolCategory === 'file_write' || toolCategory === 'file_edit'">
      <div class="otb-file-path">
        <span class="mso" style="font-size:14px">folder</span>
        {{ filePath }}
      </div>
      <div v-if="fileContent && toolCategory !== 'file_read'" class="otb-code-box">
        <pre class="otb-command otb-file-content">{{ fileContent.slice(0, 500) }}{{ fileContent.length > 500 ? '\n...' : '' }}</pre>
      </div>
      <div class="otb-actions">
        <button v-if="resultText || fileContent" class="otb-btn otb-btn-open" @click="openInEditor(resultText || fileContent)">
          <span class="mso" style="font-size:14px">open_in_new</span> 在编辑区打开
        </button>
        <button v-if="filePath" class="otb-btn otb-btn-finder" @click="openInFinder(filePath)">
          <span class="mso" style="font-size:14px">folder_open</span> Finder
        </button>
      </div>
    </template>

    <!-- browser: URL + 操作 -->
    <template v-else-if="toolCategory === 'browser'">
      <div class="otb-browser-info">
        <span class="otb-browser-action">{{ browserAction }}</span>
        <span v-if="browserUrl" class="otb-browser-url">{{ browserUrl }}</span>
      </div>
      <div v-if="requiresApproval && status === 'pending'" class="otb-actions">
        <button class="otb-btn otb-btn-approve" @click="handleApprove" :disabled="approving">
          <span class="mso">check</span> 允许
        </button>
        <button class="otb-btn otb-btn-deny" @click="handleDeny">
          <span class="mso">block</span> 拒绝
        </button>
      </div>
    </template>

    <!-- cron: 定时任务 -->
    <template v-else-if="toolCategory === 'cron'">
      <div class="otb-cron-info">
        <div><strong>周期:</strong> {{ cronSchedule }}</div>
        <div><strong>任务:</strong> {{ cronCommand }}</div>
      </div>
      <div v-if="requiresApproval && status === 'pending'" class="otb-actions">
        <button class="otb-btn otb-btn-approve" @click="handleApprove" :disabled="approving">
          <span class="mso">check</span> 确认创建
        </button>
        <button class="otb-btn otb-btn-deny" @click="handleDeny">
          <span class="mso">close</span> 取消
        </button>
      </div>
    </template>

    <!-- other: 通用 -->
    <template v-else>
      <div class="otb-code-box">
        <pre class="otb-command">{{ JSON.stringify(args, null, 2) }}</pre>
      </div>
    </template>

    <!-- 执行结果 -->
    <div v-if="resultText && status === 'done'" class="otb-result">
      <div class="otb-result-header">
        <span class="mso" style="font-size:14px">check_circle</span> 执行结果
      </div>
      <pre class="otb-result-content">{{ resultText.slice(0, 2000) }}{{ resultText.length > 2000 ? '\n...(截断)' : '' }}</pre>
    </div>

    <!-- 错误 -->
    <div v-if="error" class="otb-error">
      <span class="mso" style="font-size:14px">error</span>
      {{ error }}
    </div>
  </div>
</template>

<style scoped>
.otb {
  margin: 8px 0; padding: 12px 14px; border-radius: 12px;
  border: 1px solid var(--border); background: var(--surface-alt);
  font-size: 13px;
}

.otb-header {
  display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
}
.otb-icon { font-size: 18px; color: var(--olive); }
.otb-label { font-weight: 700; color: var(--ink); flex: 1; }
.otb-status {
  font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px;
}
.otb-status.status-pending { background: #fff3e0; color: #e65100; }
.otb-status.status-running { background: #e3f2fd; color: #1565c0; }
.otb-status.status-done { background: #e8f5e9; color: #2e7d32; }
.otb-status.status-error { background: #ffebee; color: #c62828; }

.otb-code-box {
  border-radius: 8px; overflow: hidden;
  border: 1px solid var(--border); background: var(--surface);
  margin-bottom: 8px;
}
.otb-workdir {
  padding: 4px 10px; font-size: 11px; color: var(--ink3);
  border-bottom: 1px solid var(--border); background: var(--border);
}
.otb-command {
  margin: 0; padding: 10px 12px; font-size: 12px; line-height: 1.5;
  font-family: 'SF Mono', 'Fira Code', monospace; color: var(--ink);
  white-space: pre-wrap; word-break: break-all;
}
.otb-file-content { max-height: 200px; overflow-y: auto; }

.otb-file-path {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px; border-radius: 6px;
  background: var(--surface); font-size: 12px; color: var(--ink2);
  font-family: 'SF Mono', monospace; margin-bottom: 8px;
  word-break: break-all;
}

.otb-browser-info {
  padding: 8px 10px; border-radius: 6px; background: var(--surface);
  margin-bottom: 8px; font-size: 12px;
}
.otb-browser-action {
  font-weight: 700; color: var(--ink); text-transform: uppercase;
  letter-spacing: 0.05em; margin-right: 8px;
}
.otb-browser-url {
  color: var(--olive-dark); word-break: break-all;
}

.otb-cron-info {
  padding: 8px 10px; border-radius: 6px; background: var(--surface);
  margin-bottom: 8px; font-size: 12px; line-height: 1.8;
}

.otb-actions {
  display: flex; gap: 8px; margin-top: 4px;
}
.otb-btn {
  display: flex; align-items: center; gap: 4px;
  padding: 7px 16px; border: none; border-radius: 8px;
  font-size: 12px; font-weight: 700; cursor: pointer; font-family: inherit;
  transition: all 0.15s;
}
.otb-btn:disabled { opacity: 0.5; cursor: default; }
.otb-btn-approve {
  background: #4caf50; color: #fff;
}
.otb-btn-approve:hover:not(:disabled) { background: #43a047; }
.otb-btn-deny {
  background: var(--surface); color: var(--ink2);
  border: 1px solid var(--border);
}
.otb-btn-deny:hover { background: #ffebee; color: #c62828; border-color: #ef9a9a; }
.otb-btn-open {
  background: var(--olive); color: #fff;
}
.otb-btn-open:hover { filter: brightness(1.1); }
.otb-btn-finder {
  background: var(--surface); color: var(--ink2);
  border: 1px solid var(--border);
}
.otb-btn-finder:hover { border-color: var(--olive); color: var(--olive-dark); }

.otb-result {
  margin-top: 8px; border-radius: 8px; overflow: hidden;
  border: 1px solid #c8e6c9;
}
.otb-result-header {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px; background: #e8f5e9; color: #2e7d32;
  font-size: 11px; font-weight: 700;
}
.otb-result-content {
  margin: 0; padding: 10px 12px; font-size: 12px; line-height: 1.5;
  font-family: 'SF Mono', monospace; color: var(--ink);
  white-space: pre-wrap; word-break: break-all;
  max-height: 300px; overflow-y: auto;
  background: var(--surface);
}

.otb-error {
  margin-top: 8px; padding: 8px 12px; border-radius: 8px;
  background: #ffebee; color: #c62828; font-size: 12px; font-weight: 600;
  display: flex; align-items: center; gap: 6px;
}
</style>

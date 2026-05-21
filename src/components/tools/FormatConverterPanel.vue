<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import { emitEvent } from '@/utils/eventBus'
import {
  MAX_AUTO_IMPORT_CHARS,
  defaultFormatConverterSettings,
  defaultConversionModeForPath,
  isImagePath,
  isPdfPath,
  normalizeOutputFormatForPath,
  outputFormatsForPath,
  shouldImportConvertedContentToEditor,
  type ConverterMode,
  type ConverterOutputFormat,
  type FormatConverterSettings,
} from '@/utils/formatConverter'

const emit = defineEmits<{ back: [] }>()

type ConvertStatus = 'queued' | 'running' | 'success' | 'error' | 'cancelled'

interface ConvertResult {
  status: 'success' | 'error'
  source: string
  filename: string
  content: string
  engine: string
  sourcePath: string
  outputPath: string
  truncated: boolean
  message: string
  error?: string
}

interface ConvertTask {
  id: string
  jobId: string
  selected: boolean
  sourcePath: string
  name: string
  outputFormat: ConverterOutputFormat
  conversionMode: ConverterMode
  status: ConvertStatus
  progress: number
  detail: string
  outputPath?: string
  outputName?: string
  engine?: string
  error?: string
  startedAt?: number
  finishedAt?: number
}

interface FormatConverterProgress {
  jobId?: string
  sourcePath: string
  completedPages: number
  totalPages: number
  progress: number
  message: string
}

const tasks = ref<ConvertTask[]>([])
const outputDir = ref('')
const running = ref(false)
const cancelRequested = ref(false)
const settingsOpen = ref(false)
const settings = ref<FormatConverterSettings>(defaultFormatConverterSettings())
const concurrency = 1
let activeWorkers = 0
let activeRunId = 0
let unlistenProgress: UnlistenFn | null = null

const modeOptions: Array<{ label: string; value: ConverterMode }> = [
  { label: '智能', value: 'auto' },
  { label: '快速', value: 'fast' },
  { label: 'OCR', value: 'ocr' },
]

const selectedCount = computed(() => tasks.value.filter(task => task.selected).length)
const activeCount = computed(() => tasks.value.filter(task => task.status === 'running').length)
const queuedCount = computed(() => tasks.value.filter(task => task.status === 'queued').length)
const doneCount = computed(() => tasks.value.filter(task => task.status === 'success').length)
const canStart = computed(() => tasks.value.some(task =>
  task.selected && task.status !== 'running' && task.status !== 'success',
))
const allSelectableChecked = computed(() => {
  const selectable = tasks.value.filter(task => task.status !== 'running')
  return selectable.length > 0 && selectable.every(task => task.selected)
})

function basename(path: string): string {
  return String(path || '').split(/[\\/]/).filter(Boolean).at(-1) || '未命名文件'
}

function normalizePath(path: string): string {
  return String(path || '').replace(/\\/g, '/')
}

function dirname(path: string): string {
  const normalized = normalizePath(path)
  return normalized.split('/').slice(0, -1).join('/') || normalized
}

function newTask(path: string): ConvertTask {
  const id = `convert_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
  return {
    id,
    jobId: id,
    selected: true,
    sourcePath: path,
    name: basename(path),
    outputFormat: normalizeOutputFormatForPath(path, 'md'),
    conversionMode: defaultConversionModeForPath(path),
    status: 'queued',
    progress: 0,
    detail: '等待转换',
  }
}

async function addFiles() {
  const selected = await open({
    multiple: true,
    directory: false,
    title: '选择要转换的文件',
  })
  const paths = Array.isArray(selected) ? selected : selected ? [selected] : []
  for (const path of paths) {
    tasks.value.push(newTask(String(path)))
  }
  if (running.value) pumpQueue()
}

async function chooseOutputDir() {
  const selected = await open({
    directory: true,
    multiple: false,
    title: '选择输出目录',
  })
  if (typeof selected === 'string' && selected.trim()) {
    outputDir.value = selected
  }
}

function resetOutputDir() {
  outputDir.value = ''
}

function toggleAll() {
  const next = !allSelectableChecked.value
  for (const task of tasks.value) {
    if (task.status !== 'running') task.selected = next
  }
}

function removeTask(task: ConvertTask) {
  if (task.status === 'running') return
  tasks.value = tasks.value.filter(item => item.id !== task.id)
}

function clearSelected() {
  tasks.value = tasks.value.filter(task => !task.selected || task.status === 'running')
}

function clearDone() {
  tasks.value = tasks.value.filter(task => task.status !== 'success')
}

function formatLabel(format: ConverterOutputFormat): string {
  return outputFormatsForPath('').find(item => item.value === format)?.label ||
    ({ md: 'Markdown', txt: 'TXT', html: 'HTML', csv: 'CSV', json: 'JSON', srt: 'SRT' }[format])
}

function modeOptionsForTask(task: ConvertTask) {
  if (isPdfPath(task.sourcePath)) return modeOptions
  if (isImagePath(task.sourcePath)) return modeOptions.filter(item => item.value === 'ocr')
  return modeOptions.filter(item => item.value === 'fast')
}

function ensureValidMode(task: ConvertTask) {
  const allowed = modeOptionsForTask(task).map(item => item.value)
  if (!allowed.includes(task.conversionMode)) task.conversionMode = 'fast'
}

function setOutputFormat(task: ConvertTask, value: string) {
  task.outputFormat = normalizeOutputFormatForPath(task.sourcePath, value as ConverterOutputFormat)
}

function onOutputFormatChange(task: ConvertTask, event: Event) {
  setOutputFormat(task, (event.target as HTMLSelectElement).value)
}

function startSoftProgress(task: ConvertTask, ceiling: number) {
  return window.setInterval(() => {
    if (task.status !== 'running') return
    if (task.progress < ceiling) {
      task.progress = Math.min(ceiling, task.progress + Math.max(1, Math.round((ceiling - task.progress) / 8)))
    }
  }, 900)
}

function isOcrTask(task: ConvertTask): boolean {
  return task.conversionMode === 'ocr'
}

function isFastTask(task: ConvertTask): boolean {
  return task.conversionMode === 'fast'
}

async function convertToMarkdown(task: ConvertTask): Promise<ConvertResult> {
  const timeoutSeconds = conversionTimeoutSeconds()
  const request = invoke('document_path_to_markdown_file', {
    input: {
      sourcePath: task.sourcePath,
      outputDir: outputDir.value || undefined,
      conversionMode: task.conversionMode,
      outputFormat: task.outputFormat,
      timeoutSeconds,
      maxChars: 500000,
      jobId: task.jobId,
    },
  }) as Promise<ConvertResult>
  return await withFrontendTimeout(request, timeoutSeconds)
}

function conversionTimeoutSeconds(): number | undefined {
  if (!settings.value.stopOnTimeout) return undefined
  return Math.max(1, Math.round(Number(settings.value.timeoutMinutes || 10))) * 60
}

async function withFrontendTimeout<T>(promise: Promise<T>, timeoutSeconds?: number): Promise<T> {
  if (!timeoutSeconds) return await promise
  let timer: number | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => {
          reject(new Error(`转换超时（${Math.max(1, Math.round(timeoutSeconds / 60))}分钟），已停止界面等待。`))
        }, timeoutSeconds * 1000 + 5000)
      }),
    ])
  } finally {
    if (timer) window.clearTimeout(timer)
  }
}

function applyBackendProgress(event: FormatConverterProgress) {
  const task = tasks.value.find(item =>
    (event.jobId && item.jobId === event.jobId) ||
    (!event.jobId && normalizePath(item.sourcePath) === normalizePath(event.sourcePath)),
  )
  if (!task || task.status !== 'running') return
  task.progress = Math.max(task.progress, Math.min(99, Number(event.progress || 0)))
  task.detail = event.totalPages
    ? `${event.message} · ${event.completedPages}/${event.totalPages}页`
    : event.message
}

function isActiveRun(runId: number): boolean {
  return running.value && !cancelRequested.value && activeRunId === runId
}

function isTaskCancelled(task: ConvertTask): boolean {
  return task.status === 'cancelled'
}

async function runTask(task: ConvertTask, runId: number) {
  ensureValidMode(task)
  task.jobId = `${task.id}_${Date.now().toString(36)}`
  console.info('[FormatConverter] start task', {
    jobId: task.jobId,
    name: task.name,
    outputFormat: task.outputFormat,
    conversionMode: task.conversionMode,
    sourcePath: task.sourcePath,
    outputDir: outputDir.value || 'source-folder',
  })
  task.status = 'running'
  task.progress = isFastTask(task) ? 8 : 0
  task.error = ''
  task.outputPath = ''
  task.outputName = ''
  task.engine = ''
  task.startedAt = Date.now()
  task.finishedAt = undefined
  task.detail = isOcrTask(task)
    ? '正在准备分段 OCR'
    : task.conversionMode === 'auto'
      ? '正在判断文档类型'
      : '快速转换中'

  const timer = isFastTask(task) ? startSoftProgress(task, 88) : null
  try {
    const fast = await convertToMarkdown(task)
    if (!isActiveRun(runId) || isTaskCancelled(task)) return
    console.info('[FormatConverter] task result', {
      name: task.name,
      status: fast.status,
      engine: fast.engine,
      outputPath: fast.outputPath,
      message: fast.message,
      error: fast.error,
    })
    if (fast.status === 'success') {
      finishSuccess(task, fast)
      void handleAfterSuccess(task, fast)
      return
    }

    finishError(task, fast.message || fast.error || '转换失败')
  } catch (err) {
    if (!isActiveRun(runId) || isTaskCancelled(task)) return
    console.error('[FormatConverter] task failed', err)
    finishError(task, (err as Error).message || '转换失败')
  } finally {
    if (timer) window.clearInterval(timer)
  }
}

async function openPath(path: string) {
  if (!path) return
  const shell = await import('@tauri-apps/plugin-shell')
  await shell.open(path)
}

async function handleAfterSuccess(task: ConvertTask, result: ConvertResult) {
  try {
    const shouldImport = shouldImportConvertedContentToEditor({
      importToEditor: settings.value.importToEditor,
      outputFormat: task.outputFormat,
      contentLength: result.content?.length || 0,
    })
    if (shouldImport) {
      emitEvent('switch-panel', 'editor')
      emitEvent('open-in-editor', {
        name: result.filename || task.name,
        content: result.content,
      })
    } else if (settings.value.importToEditor && ['md', 'txt'].includes(task.outputFormat) && result.content?.length > MAX_AUTO_IMPORT_CHARS) {
      task.detail = `已生成 ${result.filename} · 内容较大未自动导入编辑区`
    }
    if (settings.value.openFile && result.outputPath) {
      await openPath(result.outputPath)
    }
    if (settings.value.openFolder && result.outputPath) {
      await openPath(dirname(result.outputPath))
    }
  } catch (err) {
    console.warn('[FormatConverter] after success action failed', err)
  }
}

function finishSuccess(task: ConvertTask, result: ConvertResult) {
  task.status = 'success'
  task.progress = 100
  task.outputPath = result.outputPath
  task.outputName = result.filename
  task.engine = result.engine
  task.finishedAt = Date.now()
  task.detail = `已生成 ${result.filename}`
}

function finishError(task: ConvertTask, message: string) {
  task.status = 'error'
  task.progress = 100
  task.error = message
  task.finishedAt = Date.now()
  task.detail = '转换失败'
}

function finishCancelled(task: ConvertTask, message = '已取消') {
  task.status = 'cancelled'
  task.progress = 0
  task.error = ''
  task.finishedAt = Date.now()
  task.detail = message
}

function nextRunnableTask() {
  return tasks.value.find(item =>
    item.selected && item.status !== 'running' && item.status !== 'success',
  )
}

async function processNext(runId: number) {
  const task = nextRunnableTask()
  if (!task || !isActiveRun(runId)) return
  await runTask(task, runId)
}

function pumpQueue(runId = activeRunId) {
  if (activeWorkers < 0) activeWorkers = 0
  if (!isActiveRun(runId)) return
  while (activeWorkers < concurrency && nextRunnableTask()) {
    activeWorkers++
    void processNext(runId).finally(() => {
      if (!isActiveRun(runId)) return
      activeWorkers--
      if (nextRunnableTask()) pumpQueue(runId)
      if (activeWorkers === 0 && !nextRunnableTask()) running.value = false
    })
  }
}

async function startConversion() {
  if (running.value) {
    stopConversion()
    return
  }
  if (!canStart.value) return
  activeWorkers = 0
  activeRunId++
  cancelRequested.value = false
  running.value = true
  pumpQueue(activeRunId)
}

function cancelBackendTask(task: ConvertTask) {
  if (!task.jobId) return
  void invoke('cancel_markdown_conversion', {
    input: { jobId: task.jobId },
  }).catch(err => {
    console.warn('[FormatConverter] cancel backend task failed', err)
  })
}

function stopConversion() {
  if (!running.value) return
  cancelRequested.value = true
  activeRunId++
  activeWorkers = 0
  running.value = false
  for (const task of tasks.value) {
    if (task.status === 'running') {
      cancelBackendTask(task)
      finishCancelled(task, '已停止转换')
    }
    else if (task.selected && task.status === 'queued') finishCancelled(task, '已停止，未开始转换')
  }
}

function taskMeta(task: ConvertTask): string {
  if (task.status === 'success') {
    const duration = task.startedAt && task.finishedAt ? ` · ${Math.max(1, Math.round((task.finishedAt - task.startedAt) / 1000))}秒` : ''
    return `${task.outputName || formatLabel(task.outputFormat)}${duration}`
  }
  if (task.status === 'error') return task.error || '转换失败'
  if (task.status === 'cancelled') return task.detail || '已取消'
  return ''
}

function progressLabel(task: ConvertTask): string {
  if (task.status === 'running') return task.detail
  if (task.status === 'success') return '已完成 · 100%'
  if (task.status === 'error') return '转换失败'
  if (task.status === 'cancelled') return task.detail || '已停止'
  return '等待转换'
}

onMounted(async () => {
  unlistenProgress = await listen<FormatConverterProgress>('format-converter-progress', event => {
    applyBackendProgress(event.payload)
  })
})

onUnmounted(() => {
  if (unlistenProgress) {
    unlistenProgress()
    unlistenProgress = null
  }
})
</script>

<template>
  <div class="fc">
    <div class="fc-head">
      <button class="fc-back" title="返回工具仓库" @click="emit('back')">
        <span class="mso">arrow_back</span>
      </button>
      <div class="fc-title">
        <h3>格式转换</h3>
        <span>创建知识库请转 Markdown 格式</span>
      </div>
      <button class="fc-clear" :disabled="doneCount === 0" @click="clearDone">清空完成项</button>
    </div>

    <div class="fc-table">
      <div class="fc-row fc-row-head">
        <label class="fc-check">
          <input type="checkbox" :checked="allSelectableChecked" @change="toggleAll" />
        </label>
        <div>名称</div>
        <div>输出范围</div>
        <div>输出格式</div>
        <div>转换模式</div>
      </div>

      <div v-if="tasks.length === 0" class="fc-empty">
        <span class="mso">upload_file</span>
        <strong>添加文件开始转换</strong>
        <span>文件会进入队列，可继续添加，互不影响。</span>
        <button @click="addFiles">添加文件</button>
      </div>

      <div v-for="task in tasks" :key="task.id" class="fc-row fc-task" :class="task.status">
        <label class="fc-check">
          <input v-model="task.selected" type="checkbox" :disabled="task.status === 'running'" />
        </label>

        <div class="fc-name">
          <strong>{{ task.name }}</strong>
          <span v-if="taskMeta(task)">{{ taskMeta(task) }}</span>
        </div>

        <div class="fc-range" :class="task.status">
          <span>{{ progressLabel(task) }}</span>
          <div v-if="task.status === 'running'" class="fc-progress">
            <i :style="{ width: `${task.progress}%` }"></i>
          </div>
        </div>

        <select
          class="fc-select"
          :value="task.outputFormat"
          :disabled="task.status === 'running'"
          @change="onOutputFormatChange(task, $event)"
        >
          <option v-for="format in outputFormatsForPath(task.sourcePath)" :key="format.value" :value="format.value">
            {{ format.label }}
          </option>
        </select>

        <select v-model="task.conversionMode" class="fc-select" :disabled="task.status === 'running'" @change="ensureValidMode(task)">
          <option v-for="mode in modeOptionsForTask(task)" :key="mode.value" :value="mode.value">
            {{ mode.label }}
          </option>
        </select>

        <div class="fc-actions">
          <button v-if="task.status === 'running'" title="停止转换" @click="stopConversion">
            <span class="mso">stop_circle</span>
          </button>
          <button v-if="task.status !== 'running'" title="删除" @click="removeTask(task)">
            <span class="mso">delete</span>
          </button>
        </div>
      </div>
    </div>

    <div class="fc-toolbar">
      <button class="fc-add" @click="addFiles">
        <span class="mso">add</span>
        添加文件
      </button>
      <button class="fc-text-btn" :disabled="selectedCount === 0" @click="clearSelected">
        <span class="mso">delete</span>
        清除选中({{ selectedCount }})
      </button>
      <div class="fc-queue-state">
        进行中 {{ activeCount }} · 等待 {{ queuedCount }} · 完成 {{ doneCount }}
      </div>
    </div>

    <div class="fc-settings">
      <label>
        <span>输出目录</span>
        <button class="fc-dir" @click="chooseOutputDir">
          {{ outputDir || '上传文件的目录' }}
          <span class="mso">expand_more</span>
        </button>
      </label>
      <button v-if="outputDir" class="fc-text-btn" @click="resetOutputDir">恢复上传文件目录</button>
      <button class="fc-settings-btn" @click="settingsOpen = true">
        <span class="mso">settings</span>
        设置
      </button>
    </div>

    <div class="fc-footer">
      <button class="fc-primary" :class="{ danger: running }" :disabled="!running && !canStart" @click="startConversion">
        {{ running ? '停止转换' : '开始转换' }}
      </button>
    </div>

    <div v-if="settingsOpen" class="fc-modal-mask" @click.self="settingsOpen = false">
      <div class="fc-modal">
        <h4>转换设置</h4>
        <section>
          <strong>超时设置</strong>
          <label class="fc-timeout-row">
            <input v-model.number="settings.timeoutMinutes" type="number" min="1" max="240" />
            <span>分钟</span>
          </label>
          <label class="fc-checkbox-row">
            <input v-model="settings.stopOnTimeout" type="checkbox" />
            <span>超时未完成则停止转换</span>
          </label>
        </section>
        <section>
          <strong>完成后</strong>
          <label class="fc-checkbox-row">
            <input v-model="settings.importToEditor" type="checkbox" />
            <span>转换完成导入编辑区（Markdown / TXT）</span>
          </label>
          <label class="fc-checkbox-row">
            <input v-model="settings.openFile" type="checkbox" />
            <span>转换完成自动打开文件</span>
          </label>
          <label class="fc-checkbox-row">
            <input v-model="settings.openFolder" type="checkbox" />
            <span>转换完成自动打开文件目录</span>
          </label>
        </section>
        <div class="fc-modal-actions">
          <button class="fc-text-btn" @click="settingsOpen = false">取消</button>
          <button class="fc-primary" @click="settingsOpen = false">确定</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fc {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  color: var(--ink1);
}
.fc-head {
  min-height: 56px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  gap: 10px;
  box-sizing: border-box;
}
.fc-back,
.fc-clear,
.fc-text-btn,
.fc-add,
.fc-settings-btn,
.fc-actions button {
  border: 1px solid var(--line);
  background: var(--paper);
  color: var(--ink2);
  border-radius: 6px;
  font-family: inherit;
  cursor: pointer;
}
.fc-back {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.fc-back .mso,
.fc-actions .mso {
  font-size: 17px;
}
.fc-title {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 2px;
}
.fc-title h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
}
.fc-title span {
  color: var(--ink3);
  font-size: 12px;
}
.fc-clear,
.fc-text-btn,
.fc-add,
.fc-settings-btn {
  padding: 6px 9px;
  font-size: 12px;
  font-weight: 700;
}
button:disabled,
.fc-dir:disabled {
  opacity: .48;
  cursor: not-allowed;
}
.fc-table {
  margin: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  overflow: hidden;
  min-height: 270px;
}
.fc-row {
  position: relative;
  display: grid;
  grid-template-columns: 28px minmax(0, 1.15fr) minmax(0, 1.2fr) 92px 74px;
  align-items: center;
  gap: 8px;
  padding: 12px 54px 12px 10px;
  border-bottom: 1px solid var(--line);
  box-sizing: border-box;
}
.fc-row-head {
  padding-right: 10px;
}
.fc-row-head {
  min-height: 42px;
  color: var(--ink2);
  font-size: 12px;
  font-weight: 800;
  background: var(--surface-alt);
}
.fc-check {
  display: flex;
  align-items: center;
  justify-content: center;
}
.fc-check input {
  width: 16px;
  height: 16px;
  accent-color: var(--olive);
}
.fc-task {
  min-height: 78px;
}
.fc-task.success {
  background: rgba(107,142,35,.045);
}
.fc-task.error {
  background: rgba(198,40,40,.045);
}
.fc-task.cancelled {
  background: rgba(120, 120, 120, .045);
}
.fc-name {
  min-width: 0;
  display: grid;
  gap: 6px;
}
.fc-name strong {
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fc-name span {
  color: var(--ink3);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.fc-range {
  color: var(--ink2);
  font-size: 12px;
  min-width: 0;
  display: grid;
  gap: 6px;
}
.fc-range span {
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-height: 1.28;
}
.fc-range.success {
  color: #2e7d32;
}
.fc-range.error {
  color: #c62828;
}
.fc-range.cancelled {
  color: var(--ink3);
}
.fc-select,
.fc-dir {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink1);
  border-radius: 7px;
  padding: 7px 8px;
  font-family: inherit;
  font-size: 12px;
}
.fc-actions {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  min-width: 0;
}
.fc-settings-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  justify-content: center;
  margin-left: auto;
}
.fc-settings-btn .mso {
  font-size: 16px;
}
.fc-actions button {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
}
.fc-progress {
  height: 4px;
  border-radius: 999px;
  background: var(--surface-alt);
  overflow: hidden;
}
.fc-progress i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--olive);
  transition: width .2s ease;
}
.fc-empty {
  min-height: 226px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 8px;
  color: var(--ink3);
  text-align: center;
  padding: 24px;
}
.fc-empty .mso {
  font-size: 34px;
  color: var(--olive-dark);
}
.fc-empty strong {
  color: var(--ink1);
  font-size: 14px;
}
.fc-empty button {
  border: none;
  background: var(--olive);
  color: white;
  border-radius: 7px;
  padding: 8px 14px;
  font-family: inherit;
  font-weight: 800;
  cursor: pointer;
}
.fc-toolbar {
  margin: 0 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  padding: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.fc-add,
.fc-text-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.fc-queue-state {
  margin-left: auto;
  color: var(--ink3);
  font-size: 12px;
}
.fc-settings {
  padding: 14px 12px;
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto auto;
  gap: 12px;
  align-items: end;
}
.fc-settings label {
  min-width: 0;
  display: grid;
  gap: 7px;
}
.fc-settings label > span {
  font-size: 12px;
  font-weight: 800;
  color: var(--ink1);
}
.fc-dir {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  text-align: left;
  overflow: hidden;
}
.fc-dir .mso {
  font-size: 16px;
  flex-shrink: 0;
}
.fc-footer {
  margin-top: auto;
  padding: 12px;
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid var(--line);
}
.fc-primary {
  min-width: 136px;
  min-height: 38px;
  border: none;
  border-radius: 8px;
  background: var(--olive);
  color: #fff;
  font-family: inherit;
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
}
.fc-primary:disabled {
  background: var(--line);
  color: var(--ink3);
}
.fc-primary.danger {
  background: #b42318;
}
.fc-modal-mask {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, .12);
  z-index: 30;
}
.fc-modal {
  width: min(520px, calc(100% - 32px));
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--paper);
  box-shadow: 0 18px 50px rgba(0, 0, 0, .16);
  padding: 18px;
  display: grid;
  gap: 18px;
}
.fc-modal h4 {
  margin: 0;
  font-size: 16px;
  font-weight: 850;
}
.fc-modal section {
  display: grid;
  gap: 10px;
}
.fc-modal section strong {
  font-size: 13px;
}
.fc-timeout-row,
.fc-checkbox-row {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--ink2);
  font-size: 13px;
}
.fc-timeout-row input[type="number"] {
  width: 88px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--surface);
  color: var(--ink1);
  padding: 8px 10px;
  font-family: inherit;
  font-size: 14px;
}
.fc-checkbox-row input {
  width: 16px;
  height: 16px;
  accent-color: var(--olive);
}
.fc-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
@media (max-width: 760px) {
  .fc-row {
    grid-template-columns: 24px minmax(0, 1fr) minmax(0, 1.05fr) 82px 64px;
    gap: 6px;
    padding: 10px 48px 10px 8px;
  }
  .fc-row-head {
    padding-right: 8px;
  }
  .fc-settings {
    grid-template-columns: 1fr;
  }
  .fc-toolbar {
    flex-wrap: wrap;
  }
  .fc-queue-state {
    width: 100%;
    margin-left: 0;
  }
}
</style>

<script setup lang="ts">
/**
 * CreationPanel — 创作面板
 * 任务列表替代旧画廊；参数区/cp-composer 不变。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  RH_TASK_LABELS,
  type CreationTask,
} from '@/data/creationModels'
import {
  CREATION_PANEL_MODELS,
  cpState,
  currentModel,
  currentCreationSpec,
  currentRunPlan,
  currentRunPlanError,
  currentSubmitSummary,
  currentModelAvailability,
  availableModels,
  aspectOptions,
  sizeOptions,
  resolutionOptions,
  durationOptions,
  durationRange,
  hasDuration,
  acceptsFiles,
  acceptAttr,
  promptPlaceholder,
  showTagsInput,
  showTitleInput,
  showNegativeTagsInput,
  showMvSelect,
  mvOptions,
  languageOptions,
  showTextInput,
  showRefTextInput,
  showVoicePromptInput,
  showStartEndTimeInput,
  showWidthHeightInput,
  showValueInput,
  showLanguageSelect,
  showPromptInput,
  genericModelFields,
  switchTask,
  switchModel,
  setAspect,
  setSize,
  setResolution,
  setDuration,
  setMv,
  setLanguage,
  getModelFieldValue,
  setModelFieldValue,
  addFiles,
  replaceFilesForMediaKind,
  removeFile,
  refreshCreationModelAvailability,
  saveCpState,
  getVisibleCreationTasks,
  buildCurrentCreationParams,
} from '@/composables/useCreation'
import { displayModelLabel, RH_ONLY_MODE } from '@/runtime/creation/creationModelRegistry'
import { buildCreationRunPlan } from '@/runtime/creation/creationMediaPlan'

import { onEvent } from '@/utils/eventBus'
import { openExternal } from '@/utils/httpClient'
import { getMediaAssetById } from '@/utils/idb'
import { assetRowToRealPath, parseMediaRef } from '@/utils/mediaFileReader'
import { isTauriRuntime } from '@/utils/tauriEnv'
import { useMediaTaskStore } from '@/stores/mediaTaskStore'
import type { MediaTask } from '@/stores/mediaTaskStore'

const mediaTaskStore = useMediaTaskStore()

// ─── 任务状态 ───

const creationActiveTasks = computed(() =>
  mediaTaskStore.tasks.filter(task =>
    task.source === 'creation' && (task.status === 'pending' || task.status === 'running')
  )
)
const creationRunningCount = computed(() => creationActiveTasks.value.length)
const creationProgressText = computed(() => {
  const firstTask = creationActiveTasks.value[0]
  if (creationRunningCount.value > 1) return `${creationRunningCount.value}个任务生成中...`
  return firstTask?.progressText || cpState.progressText || '生成中...'
})
const creationProgress = computed(() => {
  const firstTask = creationActiveTasks.value[0]
  return firstTask?.progress || cpState.progress
})

// ─── 任务列表（分页） ───

const creationTasks = computed(() =>
  mediaTaskStore.tasks
    .filter(t => t.source === 'creation')
    .sort((a, b) => (b.completedAt || b.createdAt) - (a.completedAt || a.createdAt))
)
const creationTasksTotal = computed(() => creationTasks.value.length)

const taskPageSize = ref(20)
const taskPage = ref(1)
const totalTaskPages = computed(() => Math.max(1, Math.ceil(creationTasksTotal.value / taskPageSize.value)))

watch(creationTasksTotal, () => {
  if (taskPage.value > totalTaskPages.value) taskPage.value = totalTaskPages.value
})

const pagedCreationTasks = computed(() => {
  const start = (taskPage.value - 1) * taskPageSize.value
  return creationTasks.value.slice(start, start + taskPageSize.value)
})

function pad(n: number): string { return String(n).padStart(2, '0') }

function formatTaskTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function statusIcon(status: string): string {
  switch (status) {
    case 'pending':
    case 'running': return '\u23F3'
    case 'success': return '\u2705'
    case 'failed': return '\u274C'
    case 'cancelled': return '\u2298'
    default: return '\u23F3'
  }
}

function taskPromptLine(task: MediaTask): string {
  const prompt = (task.prompt || '无提示词').slice(0, 80)
  return `${prompt} · ${task.modelLabel || task.model}`
}

function taskPath(task: MediaTask): string {
  return task.assetUri || task.resultUrl || ''
}

function isLocalFilePath(path: string): boolean {
  return Boolean(path) && !path.startsWith('http') && !path.startsWith('blob:') && !path.startsWith('jc-media:')
}

async function resolveTaskFilePath(task: MediaTask): Promise<string> {
  if (!task.assetUri) return ''
  const assetId = parseMediaRef(task.assetUri)
  if (!assetId) return task.assetUri
  const row = await getMediaAssetById(assetId)
  return row ? assetRowToRealPath(row) : ''
}

async function previewTask(task: MediaTask) {
  const target = task.assetUri || task.resultUrl
  if (!target) return
  try {
    if (isTauriRuntime()) {
      const filePath = await resolveTaskFilePath(task)
      if (filePath && isLocalFilePath(filePath)) {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('open_in_shell', { path: filePath })
        return
      }
    }
    if (task.resultUrl) await openExternal(task.resultUrl)
  } catch {
    if (task.resultUrl) window.open(task.resultUrl, '_blank')
  }
}

async function openTaskFolder(task: MediaTask) {
  if (!task.assetUri) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('dev_reveal_in_finder', { path: task.assetUri })
  } catch { /* ignore */ }
}

// ─── 模型/渠道/模式标签 ───

const rhChannelLabel = computed(() => {
  const spec = currentCreationSpec.value
  if (!spec) return '未选择模型'
  if (spec.source === 'newapi-direct') return 'NewAPI 直连'
  return spec.apiStyle === 'rh-aiapp' ? 'RH 工作流' : 'RH 官方 API'
})

function modeLabel(mode?: string): string {
  switch (mode) {
    case 'text-to-image': return '文生图'
    case 'image-to-image': return '图生图'
    case 'text-to-video': return '文生视频'
    case 'image-to-video': return '图生视频'
    case 'video-edit': return '视频编辑'
    case 'text-to-audio': return '文生音频'
    case 'lyrics': return '歌词'
    case 'digital-human': return '数字人'
    case 'voice-clone': return '声音克隆'
    case 'voice-design': return '声音设计'
    case 'workflow': return '工作流'
    default: return '参数待确认'
  }
}

const rhModeLabel = computed(() => {
  const planMode = currentRunPlan.value?.mode
  const specMode = currentCreationSpec.value?.mode
  return modeLabel(planMode || specMode)
})

// ─── 挂载 ───

onMounted(async () => {
  await mediaTaskStore.init().catch(() => {})
  refreshCreationModelAvailability().catch(() => {})
})

// ─── 生成入口 ───
async function runCreationViaTaskStore() {
  try {
  console.log('[Creation] runCreationViaTaskStore called')
  const m = currentModel.value
  if (!m) { cpState.progressText = '请先选择模型'; return }
  if (currentModelAvailability.value?.status === 'disabled') {
    cpState.progressText = currentModelAvailability.value.reason || '该模型暂时不可用'
    return
  }
  const runPlanError = currentRunPlanError.value
  if (runPlanError || !currentRunPlan.value) {
    cpState.progressText = runPlanError || '请补充生成参数'
    return
  }
  const task = m.capability.task
  const mediaType = m.modelName === 'rh-suno-lyrics' ? 'text' as const
    : task === 'image' ? 'image' as const
      : task === 'audio' ? 'audio' as const : 'video' as const

  const refImages: string[] = []
  const refVideos: string[] = []
  const refAudios: string[] = []
  for (const f of cpState.files) {
    const dataUrl = await fileToDataUrl(f)
    if (f.type.startsWith('image/')) refImages.push(dataUrl)
    else if (f.type.startsWith('video/')) refVideos.push(dataUrl)
    else if (f.type.startsWith('audio/')) refAudios.push(dataUrl)
  }

  const submitPlan = buildCreationRunPlan({
    modelId: currentCreationSpec.value?.id || cpState.modelKey,
    params: buildCurrentCreationParams({ images: refImages, videos: refVideos, audios: refAudios }),
  })

  cpState.generating = true
  cpState.progressText = '提交中...'

  try {
    await mediaTaskStore.submitTask({
      type: mediaType, model: m.modelName, modelLabel: m.label,
      prompt: cpState.prompt, referenceImages: refImages,
      source: 'creation', plan: submitPlan,
    })
  } catch (e: any) {
    cpState.generating = creationRunningCount.value > 0
    cpState.progressText = `提交失败: ${(e.message || e).toString().slice(0, 100)}`
  }
  } catch (outerErr: any) {
    console.error('[Creation] FATAL:', outerErr)
    cpState.progressText = `\u274C 错误: ${(outerErr.message || String(outerErr)).slice(0, 100)}`
  }
}

// 任务完成/失败 → 更新进度
const offTaskSettled = onEvent('media-task-settled', (payload: any) => {
  if (payload.source === 'creation') {
    const runningCount = creationRunningCount.value
    cpState.runningTasks = runningCount
    cpState.generating = runningCount > 0
    if (!cpState.generating) {
      const errMsg = payload.status === 'failed' ? `\u274C 生成失败: ${payload.errorMsg || '请重试'}` : ''
      cpState.progressText = errMsg
      cpState.progress = 0
      if (errMsg) setTimeout(() => { if (cpState.progressText === errMsg) cpState.progressText = '' }, 10000)
    } else if (payload.status === 'failed') {
      cpState.progressText = `\u274C 生成失败: ${payload.errorMsg || '请重试'}`
    } else {
      cpState.progressText = creationProgressText.value
    }
    if (payload.status === 'success') taskPage.value = 1
  }
})
onBeforeUnmount(offTaskSettled)

/** 图片/视频\u2192dataURL */
function fileToDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(f)
  })
}

// 任务/模型 popover
const openPop = ref<string>('')
function togglePop(key: string) { openPop.value = openPop.value === key ? '' : key }

function onFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files) { addFiles(input.files); input.value = '' }
}
function onFileDrop(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer?.files) addFiles(e.dataTransfer.files)
}

const fileObjectUrls = ref(new Map<File, string>())
function cleanupFileObjectUrls(activeFiles: File[] = []) {
  const active = new Set(activeFiles)
  for (const [file, url] of fileObjectUrls.value.entries())
    if (!active.has(file)) { URL.revokeObjectURL(url); fileObjectUrls.value.delete(file) }
}
watch(() => [...cpState.files], files => cleanupFileObjectUrls(files), { deep: false })
onBeforeUnmount(() => cleanupFileObjectUrls())

const fileThumbs = computed(() =>
  cpState.files.map((f, i) => {
    const kind = f.type.startsWith('video/') ? 'video' : f.type.startsWith('audio/') ? 'audio' : 'image'
    let url = ''
    if (f.type.startsWith('image/')) {
      url = fileObjectUrls.value.get(f) || ''
      if (!url) { url = URL.createObjectURL(f); fileObjectUrls.value.set(f, url) }
    }
    return { index: i, name: f.name, kind, url, isVideo: f.type.startsWith('video/'), isAudio: f.type.startsWith('audio/') }
  })
)

type MediaSlotKind = 'image' | 'images' | 'video' | 'audio'
type ConcreteMediaKind = 'image' | 'video' | 'audio'

const mediaSlots = computed(() => {
  const fields = currentModel.value?.capability.fields || []
  return fields
    .filter(field => ['image', 'images', 'video', 'audio'].includes(field.kind))
    .map(field => {
      const kind = field.kind as MediaSlotKind
      const concreteKind = kind === 'images' ? 'image' : kind
      const files = fileThumbs.value.filter(file => file.kind === concreteKind)
      return { key: field.key, label: field.label, required: Boolean(field.required), kind, concreteKind, files: kind === 'images' ? files : files.slice(0, 1) }
    })
})

const activeSlotKind = ref<MediaSlotKind>('images')
const slotFileInput = ref<HTMLInputElement | null>(null)
const activeSlotAccept = computed(() => `${activeSlotKind.value === 'images' ? 'image' : activeSlotKind.value}/*`)
const activeSlotMultiple = computed(() => activeSlotKind.value === 'images')

function openMediaSlot(kind: MediaSlotKind) { activeSlotKind.value = kind; nextTick(() => slotFileInput.value?.click()) }
function onSlotFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (!files?.length) return
  if (activeSlotKind.value === 'images') addFiles(files)
  else replaceFilesForMediaKind(activeSlotKind.value as ConcreteMediaKind, files)
  input.value = ''
}

const tasks = computed(() => getVisibleCreationTasks().map(key => ({ key, label: RH_TASK_LABELS[key] })))
const modelList = computed(() => availableModels.value.map(key => ({ key, label: displayModelLabel(CREATION_PANEL_MODELS[key]?.label || key) })))

function autoGrow(e: Event) {
  const el = e.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 140) + 'px'
}
const canSend = computed(() => Boolean(currentRunPlan.value) && !currentRunPlanError.value)
</script>

<template>
  <div class="cp">
    <div class="cp-toolbar">
      <span class="cp-title"><JcIcon name="movie_filter" /><span class="cp-title-text">创作面板</span></span>
      <span class="cp-toolbar-spacer" />
      <button class="cp-toolbar-link" @click="openExternal('https://dazi.studio/')" title="打开提示词参考">
        <JcIcon name="tips_and_updates" />
        <span class="cp-toolbar-link-text">提示词参考</span>
      </button>
    </div>

    <!-- 任务列表 -->
    <div class="cp-gallery-zone">

      <div v-if="creationRunningCount > 0 || cpState.progressText" class="cp-generation-status">
        <JcIcon :name="cpState.progressText.startsWith('❌') ? 'error' : 'sync'" />
        <span>{{ creationRunningCount > 0 ? creationProgressText : cpState.progressText }}</span>
        <span v-if="!RH_ONLY_MODE" class="cp-generation-summary">{{ currentSubmitSummary }}</span>
        <div v-if="creationRunningCount > 0 && creationProgress > 0" class="cp-generation-progress">
          <i :style="{ width: Math.min(100, Math.max(0, creationProgress)) + '%' }" />
        </div>
      </div>

      <div v-if="creationTasksTotal === 0" class="cp-task-empty">
        <JcIcon name="movie_filter" />
        <span>选择模型并输入提示词，点击生成按钮开始创作</span>
      </div>

      <div v-else class="cp-task-list">
        <div
          v-for="task in pagedCreationTasks"
          :key="task.id"
          class="cp-task-item"
          :class="task.status"
        >
          <div class="cp-task-head">
            <span class="cp-task-status">{{ statusIcon(task.status) }}</span>
            <span class="cp-task-time">{{ formatTaskTime(task.completedAt || task.createdAt) }}</span>
          </div>
          <div class="cp-task-prompt">{{ taskPromptLine(task) }}</div>
          <div v-if="task.status === 'running'" class="cp-task-progress">
            <span>{{ task.progressText || '生成中...' }}</span>
            <div class="cp-task-progress-bar"><i :style="{ width: Math.min(100, Math.max(0, task.progress)) + '%' }" /></div>
          </div>
          <div v-if="task.status === 'failed'" class="cp-task-error">{{ task.errorMsg }}</div>
          <div v-if="taskPath(task) && task.status === 'success'" class="cp-task-path" :class="{ remote: !task.assetUri }">{{ taskPath(task) }}</div>
          <div v-if="task.status === 'success'" class="cp-task-actions">
            <button v-if="task.assetUri || task.resultUrl" @click="previewTask(task)">预览</button>
            <button v-if="isLocalFilePath(task.assetUri || '')" @click="openTaskFolder(task)">打开文件夹</button>
          </div>
        </div>
      </div>

      <div v-if="creationTasksTotal > 0" class="cp-task-pagination">
        <select v-model.number="taskPageSize" class="cp-page-size">
          <option v-for="s in [10,20,50,100]" :key="s" :value="s">{{ s }}条/页</option>
        </select>
        <button :disabled="taskPage <= 1" @click="taskPage--">&lt;</button>
        <span class="cp-page-info">{{ taskPage }} / {{ totalTaskPages }}</span>
        <button :disabled="taskPage >= totalTaskPages" @click="taskPage++">&gt;</button>
        <span class="cp-page-total">共 {{ creationTasksTotal }} 条</span>
      </div>
    </div>

<!-- 参数条 -->
    <div class="cp-params">
      <!-- 任务 -->
      <div class="cp-island" @click="togglePop('task')">
        <div class="cp-island-label">任务</div>
        <div class="cp-island-val">{{ RH_TASK_LABELS[cpState.task] }}</div>
        <div v-if="openPop === 'task'" class="cp-popover" @click.stop>
          <button v-for="t in tasks" :key="t.key" class="cp-pop-item"
                  :class="{ active: cpState.task === t.key }"
                  @click="switchTask(t.key); openPop = ''">
            {{ t.label }}
          </button>
        </div>
      </div>
      <!-- 模型 -->
      <div class="cp-island" @click="togglePop('model')">
        <div class="cp-island-label">模型</div>
        <div class="cp-island-val">{{ displayModelLabel(currentModel?.label || cpState.modelKey) }}</div>
        <div v-if="openPop === 'model'" class="cp-popover" @click.stop>
          <button v-for="m in modelList" :key="m.key" class="cp-pop-item"
                  :class="{ active: cpState.modelKey === m.key }"
                  @click="switchModel(m.key); openPop = ''">
            {{ m.label }}
          </button>
        </div>
      </div>
      <!-- RH 渠道 (RH_ONLY_MODE 下隐藏) -->
      <div v-if="!RH_ONLY_MODE" class="cp-island cp-rh-island">
        <div class="cp-island-label">渠道</div>
        <div class="cp-island-val">{{ rhChannelLabel }}</div>
      </div>
      <!-- RH 模式 (RH_ONLY_MODE 下隐藏) -->
      <div v-if="!RH_ONLY_MODE" class="cp-island cp-rh-island">
        <div class="cp-island-label">模式</div>
        <div class="cp-island-val">{{ rhModeLabel }}</div>
      </div>
      <!-- 尺寸 (gpt-image-2) -->
      <div v-if="sizeOptions.length" class="cp-island" @click="togglePop('size')">
        <div class="cp-island-label">尺寸</div>
        <div class="cp-island-val">{{ cpState.size }}</div>
        <div v-if="openPop === 'size'" class="cp-popover" @click.stop>
          <button v-for="s in sizeOptions" :key="s" class="cp-pop-item"
                  :class="{ active: cpState.size === s }"
                  @click="setSize(s); openPop = ''">
            {{ s }}
          </button>
        </div>
      </div>
      <!-- 比例 (视频) -->
      <div v-if="aspectOptions.length" class="cp-island" @click="togglePop('ar')">
        <div class="cp-island-label">比例</div>
        <div class="cp-island-val">{{ cpState.ar }}</div>
        <div v-if="openPop === 'ar'" class="cp-popover" @click.stop>
          <button v-for="a in aspectOptions" :key="a" class="cp-pop-item"
                  :class="{ active: cpState.ar === a }"
                  @click="setAspect(a); openPop = ''">
            {{ a }}
          </button>
        </div>
      </div>
      <!-- 分辨率 (grok) -->
      <div v-if="resolutionOptions.length" class="cp-island">
        <div class="cp-island-label">分辨率</div>
        <div class="cp-btn-group">
          <button v-for="r in resolutionOptions" :key="r" class="cp-param-btn"
                  :class="{ active: cpState.res === r }" @click="setResolution(r)">{{ r }}</button>
        </div>
      </div>
      <!-- 时长 (视频) -->
      <div v-if="hasDuration && durationRange" class="cp-island cp-island-grow">
        <div class="cp-island-label">时长</div>
        <div v-if="durationOptions.length <= 2" class="cp-btn-group">
          <button v-for="d in durationOptions" :key="d" class="cp-param-btn"
                  :class="{ active: cpState.dur === d }" @click="setDuration(d)">{{ d }}s</button>
        </div>
        <div v-else class="cp-dur-row">
          <input type="range" class="cp-dur-slider" :min="durationRange.min" :max="durationRange.max"
                 :step="durationRange.step" :value="cpState.dur" @input="setDuration(+($event.target as HTMLInputElement).value)" />
          <span class="cp-dur-val">{{ cpState.dur }}s</span>
        </div>
      </div>
      <div v-if="showMvSelect" class="cp-island" @click="togglePop('mv')">
        <div class="cp-island-label">版本</div>
        <div class="cp-island-val">{{ cpState.mv }}</div>
        <div v-if="openPop === 'mv'" class="cp-popover" @click.stop>
          <button v-for="mv in mvOptions" :key="mv" class="cp-pop-item"
                  :class="{ active: cpState.mv === mv }"
                  @click="setMv(mv); openPop = ''">
            {{ mv }}
          </button>
        </div>
      </div>
      <div v-if="showLanguageSelect" class="cp-island" @click="togglePop('language')">
        <div class="cp-island-label">语言</div>
        <div class="cp-island-val">{{ cpState.language }}</div>
        <div v-if="openPop === 'language'" class="cp-popover" @click.stop>
          <button v-for="lang in languageOptions" :key="lang" class="cp-pop-item"
                  :class="{ active: cpState.language === lang }"
                  @click="setLanguage(lang); openPop = ''">
            {{ lang }}
          </button>
        </div>
      </div>
      <div v-if="showWidthHeightInput" class="cp-island cp-number-island">
        <div class="cp-island-label">宽高</div>
        <div class="cp-number-row">
          <input v-model.number="cpState.width" type="number" class="cp-mini-input" min="16" step="16" @blur="saveCpState()" />
          <span class="cp-number-sep">×</span>
          <input v-model.number="cpState.height" type="number" class="cp-mini-input" min="16" step="16" @blur="saveCpState()" />
        </div>
      </div>
      <div v-if="showValueInput" class="cp-island cp-number-island">
        <div class="cp-island-label">画面值</div>
        <input v-model.number="cpState.value" type="number" class="cp-mini-input wide" min="16" step="16" @blur="saveCpState()" />
      </div>
      <div v-for="field in genericModelFields" :key="field.key" class="cp-island cp-generic-field">
        <div class="cp-island-label">{{ field.label }}</div>
        <div v-if="field.kind === 'select'" class="cp-btn-group">
          <button
            v-for="option in field.options || []"
            :key="String(option.value)"
            class="cp-param-btn"
            :class="{ active: getModelFieldValue(field) === option.value }"
            @click="setModelFieldValue(field, option.value)"
          >
            {{ option.label }}
          </button>
        </div>
        <input
          v-else-if="field.kind === 'number'"
          class="cp-mini-input wide"
          type="number"
          :min="field.min"
          :max="field.max"
          :step="field.step || 1"
          :value="getModelFieldValue(field)"
          @input="setModelFieldValue(field, Number(($event.target as HTMLInputElement).value))"
        />
        <label v-else-if="field.kind === 'boolean'" class="cp-toggle-field">
          <input
            type="checkbox"
            :checked="Boolean(getModelFieldValue(field))"
            @change="setModelFieldValue(field, ($event.target as HTMLInputElement).checked)"
          />
          <span>{{ getModelFieldValue(field) ? '开' : '关' }}</span>
        </label>
        <input
          v-else
          class="cp-suno-input cp-generic-input"
          :value="String(getModelFieldValue(field) || '')"
          @input="setModelFieldValue(field, ($event.target as HTMLInputElement).value)"
        />
      </div>
    </div>

    <!-- 进度条 -->
    <div v-if="creationRunningCount > 0" class="cp-progress-bar">
      <div class="cp-progress-fill" :style="{ width: creationProgress + '%' }" />
    </div>
    <div v-if="creationRunningCount > 0" class="cp-progress-text">{{ creationProgressText }}</div>

    
<!-- ★ 提示词输入区 (增强版) ★ -->
    <div class="cp-composer">
      <div v-if="acceptsFiles && !mediaSlots.length" class="cp-upload-trigger"
           @click="($refs.fileInput as HTMLInputElement).click()"
           @dragover.prevent @drop="onFileDrop" title="上传参考素材"
           :class="{ 'has-files': cpState.files.length > 0 }">
        <JcIcon :name="cpState.files.length > 0 ? 'check' : 'add'" />
        <span v-if="cpState.files.length" class="cp-file-count">{{ cpState.files.length }}</span>
        <input ref="fileInput" type="file" multiple :accept="acceptAttr"
               style="display:none" @change="onFileSelect" />
      </div>
      <div class="cp-prompt-wrap">
        <input ref="slotFileInput" type="file" :multiple="activeSlotMultiple" :accept="activeSlotAccept"
               style="display:none" @change="onSlotFileSelect" />
        <div v-if="mediaSlots.length" class="cp-media-slots">
          <button v-for="slot in mediaSlots" :key="slot.key" type="button" class="cp-media-slot"
                  :class="{ filled: slot.files.length > 0, required: slot.required }"
                  @click="openMediaSlot(slot.kind)">
            <JcIcon :name="slot.concreteKind === 'image' ? 'image' : slot.concreteKind === 'video' ? 'videocam' : 'audio_file'" class="cp-media-slot-icon" />
            <span class="cp-media-slot-body">
              <span class="cp-media-slot-label">{{ slot.label }}<em v-if="slot.required">*</em></span>
              <span class="cp-media-slot-value">{{ slot.files.length ? slot.files.map(f => f.name).join('、') : '点击上传' }}</span>
            </span>
          </button>
        </div>
        <!-- 文件缩略图 -->
        <div v-if="fileThumbs.length" class="cp-files">
          <div v-for="f in fileThumbs" :key="f.index" class="cp-file-chip" :title="f.name">
            <img v-if="f.url" :src="f.url" alt="" />
            <JcIcon name="videocam" v-else-if="f.isVideo" />
            <JcIcon name="audio_file" v-else-if="f.isAudio" />
            <JcIcon name="attach_file" v-else />
            <span class="cp-file-name">{{ f.name }}</span>
            <button class="cp-file-remove" @click="removeFile(f.index)" title="移除">
              <JcIcon name="close" />
            </button>
          </div>
        </div>
        <!-- 模型专属参数 -->
        <div v-if="showTitleInput" class="cp-suno-row">
          <input v-model="cpState.title" placeholder="歌曲标题" class="cp-suno-input" @blur="saveCpState()" />
        </div>
        <div v-if="showTagsInput" class="cp-suno-row">
          <input v-model="cpState.tags" placeholder="风格标签 (如: pop, rock, edm)" class="cp-suno-input" @blur="saveCpState()" />
        </div>
        <div v-if="showNegativeTagsInput" class="cp-suno-row">
          <input v-model="cpState.negativeTags" placeholder="排除风格" class="cp-suno-input" @blur="saveCpState()" />
        </div>
        <div v-if="showStartEndTimeInput" class="cp-inline-fields">
          <input v-model="cpState.startTime" placeholder="开始时间 0:00" class="cp-suno-input" @blur="saveCpState()" />
          <input v-model="cpState.endTime" placeholder="结束时间 0:11" class="cp-suno-input" @blur="saveCpState()" />
        </div>
        <div v-if="showRefTextInput" class="cp-suno-row">
          <textarea v-model="cpState.refText" rows="2" placeholder="参考音频文字" class="cp-aux-textarea" @blur="saveCpState()" />
        </div>
        <div v-if="showTextInput" class="cp-suno-row">
          <textarea v-model="cpState.text" rows="2" :placeholder="cpState.modelKey === 'rh-aiapp-digital-human' ? '台词' : cpState.modelKey === 'rh-aiapp-director' ? '简单说下动作是啥' : '输出文字/文稿'" class="cp-aux-textarea" @blur="saveCpState()" />
        </div>
        <div v-if="showVoicePromptInput" class="cp-suno-row">
          <textarea v-model="cpState.voicePrompt" rows="2" placeholder="人设 + 音色特征 + 风格 + 情感 + 节奏" class="cp-aux-textarea" @blur="saveCpState()" />
        </div>
        <textarea v-if="showPromptInput" v-model="cpState.prompt" rows="2" :placeholder="promptPlaceholder"
                  @blur="saveCpState()" @input="autoGrow" class="cp-prompt-input" />
      </div>
      <div class="cp-submit">
        <button class="cp-send-btn" :class="{ ready: canSend, generating: creationRunningCount > 0 }"
                :disabled="!canSend && creationRunningCount < 1"
                @click="runCreationViaTaskStore" title="生成">
          <span v-if="creationRunningCount > 0" class="cp-running-badge">{{ creationRunningCount }}</span>
          <JcIcon name="arrow_upward" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cp {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--surface);
}

.cp-toolbar {
  height: var(--app-header-height);
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}

.cp-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--ink1);
  font-size: 14px;
  font-weight: 700;
}

.cp-title .mso { font-size: 18px; color: var(--olive-dark); }
.cp-title-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-toolbar-spacer { flex: 1; min-width: 8px; }

.cp-toolbar-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink2);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
}

.cp-toolbar-link:hover { border-color: var(--olive); color: var(--olive-dark); }
.cp-toolbar-link .mso { font-size: 16px; }

/* ─── 任务列表 & 分页 ─── */
.cp-gallery-zone {
  flex: 1 1 0; overflow: hidden; padding: 10px 12px 6px; min-height: 0;
  display: flex; flex-direction: column; gap: 8px;
}
.cp-gallery-zone::-webkit-scrollbar { width: 4px; }
.cp-gallery-zone::-webkit-scrollbar-thumb { background: rgba(0,0,0,.08); border-radius: 2px; }

.cp-task-empty {
  flex: 1; min-height: 86px;
  border: 1px dashed var(--line); border-radius: 8px;
  color: var(--ink3);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; font-size: 12px;
}
.cp-task-empty .mso { font-size: 26px; color: var(--olive); opacity: .75; }

.cp-task-list {
  flex: 1; min-height: 0; overflow-y: auto;
  display: flex; flex-direction: column; gap: 6px;
}

.cp-task-item {
  padding: 10px 12px;
  border: 1px solid var(--line); border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 82%, var(--paper));
  font-size: 12px;
}
.cp-task-item.running,
.cp-task-item.pending { border-left: 3px solid var(--olive); }
.cp-task-item.success { border-color: color-mix(in srgb, var(--line) 60%, transparent); }
.cp-task-item.failed { border-left: 3px solid #c62828; background: color-mix(in srgb, #fce4ec 40%, var(--surface)); }

.cp-task-head {
  display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
}
.cp-task-status { font-size: 13px; }
.cp-task-time { color: var(--ink3); font-size: 11px; }

.cp-task-prompt {
  color: var(--ink1); font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cp-task-progress { margin-top: 4px; color: var(--ink2); font-size: 11px; }
.cp-task-progress-bar {
  height: 3px; margin-top: 3px; overflow: hidden; border-radius: 999px;
  background: rgba(0,0,0,.06);
}
.cp-task-progress-bar i {
  display: block; height: 100%; border-radius: inherit; background: var(--olive);
}
.cp-task-error { margin-top: 4px; color: #c62828; font-size: 11px; }
.cp-task-path {
  margin-top: 4px; color: var(--ink3); font-size: 11px;
  font-family: monospace; word-break: break-all;
}
.cp-task-path.remote { color: var(--olive); }

.cp-task-actions {
  margin-top: 6px; display: flex; gap: 8px;
}
.cp-task-actions button {
  padding: 3px 10px;
  border: 1px solid var(--line); border-radius: 6px;
  background: var(--paper); color: var(--ink2);
  font: inherit; font-size: 11px; font-weight: 600; cursor: pointer;
}
.cp-task-actions button:hover { border-color: var(--olive); color: var(--olive-dark); }

.cp-task-pagination {
  display: flex; align-items: center; justify-content: flex-end; gap: 6px;
  padding: 8px 0 4px; border-top: 1px solid var(--line);
  color: var(--ink3); font-size: 12px;
  flex-shrink: 0;
}
.cp-page-size {
  height: 26px; padding: 0 4px;
  border: 1px solid var(--line); border-radius: 6px;
  background: var(--surface); color: var(--ink2);
  font: inherit; font-size: 11px; outline: none; cursor: pointer;
}
.cp-page-info { font-weight: 700; color: var(--ink2); min-width: 50px; text-align: center; }
.cp-page-total { margin-left: 6px; }
.cp-task-pagination button {
  height: 26px; min-width: 26px;
  border: 1px solid var(--line); border-radius: 6px;
  background: var(--paper); color: var(--ink2);
  font: inherit; font-size: 13px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.cp-task-pagination button:hover:not(:disabled) { border-color: var(--olive); color: var(--olive-dark); }
.cp-task-pagination button:disabled { opacity: .35; cursor: default; }

/* ─── 生成状态（保留） ─── */
.cp-generation-status {
  display: grid; grid-template-columns: auto minmax(0, 1fr);
  gap: 7px 8px; align-items: center;
  min-height: 34px; padding: 8px 12px;
  border: 1px solid var(--line); border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 82%, var(--paper));
  color: var(--ink2); font-size: 12px;
}
.cp-generation-status .mso { color: var(--olive); font-size: 16px; }
.cp-generation-summary {
  grid-column: 2 / -1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--ink3); font-size: 11px;
}
.cp-generation-progress {
  grid-column: 1 / -1; height: 3px; overflow: hidden; border-radius: 999px;
  background: rgba(0,0,0,.08);
}
.cp-generation-progress i {
  display: block; height: 100%; border-radius: inherit; background: var(--olive);
}

.cp-params {
  display: flex; gap: 6px; padding: 8px 12px; border-top: 1px solid var(--line);
  flex-wrap: wrap; align-items: flex-start; flex-shrink: 0;
}
.cp-island {
  position: relative; padding: 6px 10px; border-radius: 8px;
  border: 1px solid var(--line); cursor: pointer; transition: border-color .12s;
}
.cp-island:hover { border-color: var(--olive); }
.cp-rh-island {
  cursor: default;
  background: color-mix(in srgb, var(--olive-pale) 54%, transparent);
}
.cp-rh-island:hover { border-color: var(--line); }
.cp-island-grow { flex: 1; min-width: 120px; }
.cp-island-label { font-size: 10px; color: var(--ink3); margin-bottom: 2px; }
.cp-island-val { font-size: 12px; font-weight: 600; color: var(--ink1); }
.cp-popover {
  position: absolute; bottom: 100%; left: 0; z-index: 20;
  background: var(--paper); border: 1px solid var(--line); border-radius: 10px;
  box-shadow: 0 -4px 16px rgba(0,0,0,.1); padding: 4px; min-width: 140px; max-height: 300px; overflow-y: auto;
  margin-bottom: 4px;
}
.cp-pop-item {
  display: block; width: 100%; padding: 8px 12px; border: none; background: none;
  text-align: left; font-size: 12px; cursor: pointer; border-radius: 6px; color: var(--ink1); font-family: inherit;
}
.cp-pop-item:hover { background: var(--olive-pale); }
.cp-pop-item.active { background: var(--olive-pale); color: var(--olive-dark); font-weight: 700; }

.cp-btn-group { display: flex; gap: 3px; flex-wrap: wrap; }
.cp-param-btn {
  padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px;
  background: none; font-size: 11px; cursor: pointer; color: var(--ink2); font-family: inherit;
}
.cp-param-btn.active { background: var(--olive); color: #fff; border-color: var(--olive); }
.cp-param-btn:hover { border-color: var(--olive); }
.cp-dur-row { display: flex; align-items: center; gap: 6px; }
.cp-dur-slider { flex: 1; accent-color: var(--olive); }
.cp-dur-val { font-size: 12px; font-weight: 700; color: var(--olive-dark); min-width: 28px; }

/* ★ 进度条 (增强) ★ */
.cp-progress-bar {
  height: 2px; background: rgba(107,142,35,.18); border-radius: 1px;
  overflow: hidden; margin: 0 12px; flex-shrink: 0;
}
.cp-progress-fill {
  height: 100%; border-radius: 1px;
  background: linear-gradient(90deg, var(--olive-dark), var(--olive));
  transition: width .5s;
}
.cp-progress-text { text-align: center; font-size: 10px; color: var(--ink3); padding: 2px 12px; flex-shrink: 0; }

/* ★ 提示词输入区 (增强版) ★ */
.cp-composer {
  display: flex; align-items: flex-end; gap: 8px; padding: 10px 12px 12px;
  border-top: 1px solid var(--line); flex-shrink: 0; background: var(--surface-alt);
}
.cp-upload-trigger {
  position: relative; width: 48px; height: 48px; min-width: 48px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 12px; border: 1.5px dashed var(--line); cursor: pointer; flex-shrink: 0;
  transition: all .15s; color: var(--ink3); overflow: hidden;
}
.cp-upload-trigger:hover { border-color: var(--olive); color: var(--olive); background: var(--olive-pale); }
.cp-upload-trigger.has-files { border-style: solid; border-color: var(--olive); background: var(--olive-pale); }
.cp-upload-trigger .mso { font-size: 22px; pointer-events: none; }
.cp-file-count {
  position: absolute; top: -4px; right: -4px;
  background: var(--olive); color: #fff; font-size: 9px; font-weight: 700;
  width: 16px; height: 16px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
}
.cp-prompt-wrap { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }

.cp-media-slots {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr));
  gap: 6px;
  margin-bottom: 2px;
}
.cp-media-slot {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 44px;
  padding: 7px 9px;
  border: 1px dashed var(--line);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink2);
  cursor: pointer;
  text-align: left;
  font: inherit;
}
.cp-media-slot:hover {
  border-color: var(--olive);
  background: var(--olive-pale);
}
.cp-media-slot.filled {
  border-style: solid;
  border-color: rgba(107,142,35,.38);
}
.cp-media-slot-icon {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: var(--surface-alt);
  color: var(--olive);
  font-size: 16px;
}
.cp-media-slot-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.cp-media-slot-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--ink1);
}
.cp-media-slot-label em {
  color: #c2410c;
  font-style: normal;
  margin-left: 2px;
}
.cp-media-slot-value {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: var(--ink3);
}

/* 文件芯片 (V3 风格) */
.cp-files { display: flex; flex-wrap: wrap; gap: 4px; }
.cp-file-chip {
  display: inline-flex; align-items: center; gap: 4px;
  background: var(--paper); border: 1px solid var(--line); border-radius: 8px;
  padding: 2px 4px; font-size: 10px; color: var(--ink2); max-width: 100px; position: relative;
}
.cp-file-chip img { width: 36px; height: 36px; object-fit: cover; border-radius: 6px; flex-shrink: 0; }
.cp-file-chip .mso { font-size: 18px; color: var(--olive); flex-shrink: 0; }
.cp-file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 50px; }
.cp-file-remove {
  background: none; border: none; cursor: pointer; color: var(--ink3);
  font-size: 12px; padding: 0; line-height: 1; display: flex;
}
.cp-file-remove .mso { font-size: 12px; }

.cp-suno-row { margin-bottom: 6px; }
.cp-suno-input {
  width: 100%; padding: 4px 0; border: none; border-bottom: 1px solid var(--line);
  background: none; font-size: 13px; color: var(--ink); outline: none; font-family: inherit;
}
.cp-inline-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 6px; }
.cp-aux-textarea {
  width: 100%; border: 1px solid var(--line); border-radius: 8px; background: var(--paper);
  color: var(--ink); resize: vertical; outline: none; font-family: inherit; font-size: 12px;
  line-height: 1.5; padding: 6px 8px; min-height: 44px; max-height: 120px; box-sizing: border-box;
}
.cp-number-island { cursor: default; }
.cp-number-row { display: flex; align-items: center; gap: 4px; }
.cp-number-sep { color: var(--ink3); font-size: 11px; }
.cp-mini-input {
  width: 54px; height: 24px; border: 1px solid var(--line); border-radius: 6px;
  background: var(--surface); color: var(--ink1); font: inherit; font-size: 11px;
  padding: 0 5px; box-sizing: border-box;
}
.cp-mini-input.wide { width: 74px; }
.cp-prompt-input {
  width: 100%; border: none; background: none; font-size: 13px; color: var(--ink);
  resize: none; outline: none; font-family: inherit; line-height: 1.6;
  min-height: 48px; max-height: 140px;
  field-sizing: content;
}
.cp-submit { flex-shrink: 0; }
.cp-send-btn {
  width: 40px; height: 40px; border-radius: 50%; border: none;
  background: var(--line); color: var(--surface); cursor: pointer; display: flex;
  align-items: center; justify-content: center; transition: all .3s;
  position: relative; pointer-events: none;
}
.cp-send-btn:disabled {
  opacity: .5;
  transform: none;
}
.cp-send-btn.ready {
  background: var(--olive); color: #fff; pointer-events: auto;
  animation: gcGlow 2.2s ease-in-out infinite;
}
.cp-send-btn.generating {
  background: var(--olive-dark); color: #fff; pointer-events: auto; cursor: pointer;
}
@keyframes gcGlow {
  0%, 100% { box-shadow: 0 0 10px rgba(107,142,35,.15); }
  50% { box-shadow: 0 0 22px rgba(107,142,35,.4); }
}
.cp-send-btn:hover { transform: scale(1.08); }
.cp-send-btn .mso { font-size: 18px; }
.cp-running-badge {
  position: absolute; top: -4px; right: -4px; min-width: 16px; height: 16px;
  border-radius: 8px; background: #ef4444; color: #fff; font-size: 10px;
  display: flex; align-items: center; justify-content: center; font-weight: 700;
}

/* ═══ 移动端适配 (mobile-web) ═══ */
@media (max-width: 768px) {
  /* P0: 参数栏溢出修复 */
  .cp-params {
    flex-direction: column;
    gap: 4px;
    padding: 6px 8px;
  }
  .cp-island {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .cp-popover {
    max-width: calc(100vw - 24px);
    left: 50%;
    transform: translateX(-50%);
  }
  .cp-btn-group {
    flex-wrap: wrap;
  }

  .cp-gallery-zone {
    padding: 6px 4px 4px;
  }

  /* P1: 提示词输入区紧凑化 */
  .cp-composer {
    padding: 6px 8px 8px;
    gap: 6px;
  }
  .cp-upload-trigger {
    width: 38px;
    height: 38px;
    min-width: 38px;
  }
  .cp-prompt-input {
    max-height: 80px;
    font-size: 16px; /* 防止 iOS 缩放 */
  }

  /* P1: 工具栏紧凑化 */
  .cp-toolbar {
    padding: 0 8px;
    gap: 4px;
  }
  .cp-toolbar-link-text {
    display: none; /* 只显示图标 */
  }
}

</style>

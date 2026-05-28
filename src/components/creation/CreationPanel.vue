<script setup lang="ts">
/**
 * CreationPanel — 创作面板
 * 用户显式选择模型，前端展示该模型参数；NewAPI 分组只在后台维护。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  RH_TASK_LABELS,
  RH_CREATION_MODELS,
  type CreationTask,
} from '@/data/creationModels'
import { validateMediaModelInputs } from '@/data/mediaModelInputValidation'
import {
  cpState,
  currentModel,
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
  switchTask,
  switchModel,
  setAspect,
  setSize,
  setResolution,
  setDuration,
  setMv,
  setLanguage,
  addFiles,
  removeFile,
  saveCpState,
} from '@/composables/useCreation'

import { onEvent, emitEvent } from '@/utils/eventBus'
import { isAllowedCreationResultUrl, isAllowedDownloadUrl, isAllowedMediaAttachmentUrl } from '@/utils/urlSafety'
import { useMediaTaskStore } from '@/stores/mediaTaskStore'
import type { MediaTask } from '@/stores/mediaTaskStore'

// --- 新增 UI 组件 ---
import GalleryCard from './GalleryCard.vue'
import GallerySizeControl from './GallerySizeControl.vue'
import GalleryLightbox from './GalleryLightbox.vue'
import GalleryLoadingCard from './GalleryLoadingCard.vue'

const mediaTaskStore = useMediaTaskStore()
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

watch(creationRunningCount, count => {
  cpState.runningTasks = count
  cpState.generating = count > 0
  if (count > 0) cpState.progressText = creationProgressText.value
}, { immediate: true })

// ─── 新版生成入口：走 mediaTaskStore 统一调度 ───
async function runCreationViaTaskStore() {
  try {
  console.log('[Creation] runCreationViaTaskStore called')
  const m = currentModel.value
  if (!m) { cpState.progressText = '请先选择模型'; console.log('[Creation] no model'); return }
  const task = m.capability.task

  const modelDef = m
  const mediaType = task === 'image' ? 'image' as const
    : task === 'audio' ? 'audio' as const : 'video' as const

  // 快照参数
  const refImages: string[] = []
  let firstImage = ''
  let firstVideo = ''
  let firstAudio = ''
  for (const f of cpState.files) {
    const dataUrl = await fileToDataUrl(f)
    if (f.type.startsWith('image/')) {
      refImages.push(dataUrl)
      if (!firstImage) firstImage = dataUrl
    } else if (f.type.startsWith('video/')) {
      if (!firstVideo) firstVideo = dataUrl
    } else if (f.type.startsWith('audio/')) {
      if (!firstAudio) firstAudio = dataUrl
    }
  }

  try {
    validateMediaModelInputs({
      modelId: cpState.modelKey,
      prompt: cpState.prompt,
      data: {
        title: cpState.title,
        tags: cpState.tags,
        negativeTags: cpState.negativeTags,
        text: cpState.text,
        refText: cpState.refText,
        voicePrompt: cpState.voicePrompt,
        language: cpState.language,
        startTime: cpState.startTime,
        endTime: cpState.endTime,
        width: cpState.width,
        height: cpState.height,
        value: cpState.value,
        mv: cpState.mv,
      },
      images: refImages,
      videos: firstVideo ? [firstVideo] : [],
      audios: firstAudio ? [firstAudio] : [],
      emptyMessage: '请补充生成参数',
    })
  } catch (e: any) {
    cpState.progressText = e?.message || '请补充生成参数'
    return
  }

  cpState.generating = true
  cpState.progressText = '提交中...'
  console.log('[Creation] submitting to mediaTaskStore, model=', modelDef.modelName)

  try {
    await mediaTaskStore.submitTask({
      type: mediaType,
      model: modelDef.modelName,
      modelLabel: modelDef.label,
      prompt: cpState.prompt,
      referenceImages: refImages,
      source: 'creation',
      imageParams: mediaType === 'image' ? {
        model: modelDef.modelName,
        prompt: cpState.prompt,
        size: cpState.size !== 'auto' ? cpState.size : undefined,
        aspectRatio: cpState.ar || '1:1',
        resolution: cpState.res || '1k',
        image: refImages.length > 1 ? refImages : refImages[0],
        responseFormat: 'url',
      } : undefined,
      videoParams: mediaType === 'video' ? {
        model: modelDef.modelName,
        prompt: cpState.prompt,
        aspectRatio: cpState.ar || '16:9',
        resolution: cpState.res,
        duration: cpState.dur,
        imageUrl: firstImage || refImages[0],
        imageUrls: refImages.length > 1 ? refImages : undefined,
        videoUrl: firstVideo,
        audioUrl: firstAudio,
        text: cpState.text,
        width: cpState.width,
        height: cpState.height,
        value: cpState.value,
      } : undefined,
      audioParams: mediaType === 'audio' ? {
        title: cpState.title,
        tags: cpState.tags,
        negativeTags: cpState.negativeTags,
        mv: cpState.mv,
        audioUrl: firstAudio,
        startTime: cpState.startTime,
        endTime: cpState.endTime,
        refText: cpState.refText,
        text: cpState.text,
        language: cpState.language,
        voicePrompt: cpState.voicePrompt,
      } : undefined,
    })
    console.log('[Creation] submitTask returned OK')
  } catch (e: any) {
    cpState.generating = creationRunningCount.value > 0
    cpState.progressText = `提交失败: ${(e.message || e).toString().slice(0, 100)}`
  }
  } catch (outerErr: any) {
    console.error('[Creation] FATAL:', outerErr)
    cpState.progressText = `❌ 错误: ${(outerErr.message || String(outerErr)).slice(0, 100)}`
  }
}

// 监听任务完成/失败事件，同步到旧版画廊和任务计数
const offTaskSettled = onEvent('media-task-settled', (payload: any) => {
  if (payload.source === 'creation') {
    if (payload.status === 'success' && payload.url && isAllowedCreationResultUrl(payload.url)) {
      // 插入到现有 cpState.results 头部
      cpState.results.unshift({
        url: payload.url,
        type: payload.type,
        content: payload.prompt || '',
        model: payload.model || 'unknown',
        task: payload.type,
        ts: Date.now(),
      })
      saveCpState()
    }
    const runningCount = creationRunningCount.value
    cpState.runningTasks = runningCount
    cpState.generating = runningCount > 0
    if (!cpState.generating) {
      const errMsg = payload.status === 'failed' ? `❌ 生成失败: ${payload.errorMsg || '请重试'}` : ''
      cpState.progressText = errMsg
      cpState.progress = 0
      // 失败消息保持 10 秒后自动消失
      if (errMsg) {
        setTimeout(() => {
          if (cpState.progressText === errMsg) cpState.progressText = ''
        }, 10000)
      }
    } else if (payload.status === 'failed') {
      cpState.progressText = `❌ 生成失败: ${payload.errorMsg || '请重试'}`
    } else {
      cpState.progressText = creationProgressText.value
    }
  }
})
onBeforeUnmount(offTaskSettled)

/** 图片/视频→dataURL：直接 FileReader（可靠不卡顿） */
function fileToDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(f)
  })
}

// 任务/模型 popover (原有逻辑不变)
const openPop = ref<string>('')
function togglePop(key: string) {
  openPop.value = openPop.value === key ? '' : key
}

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
  for (const [file, url] of fileObjectUrls.value.entries()) {
    if (!active.has(file)) {
      URL.revokeObjectURL(url)
      fileObjectUrls.value.delete(file)
    }
  }
}

watch(() => [...cpState.files], files => cleanupFileObjectUrls(files), { deep: false })
onBeforeUnmount(() => cleanupFileObjectUrls())

const fileThumbs = computed(() =>
  cpState.files.map((f, i) => {
    let url = ''
    if (f.type.startsWith('image/')) {
      url = fileObjectUrls.value.get(f) || ''
      if (!url) {
        url = URL.createObjectURL(f)
        fileObjectUrls.value.set(f, url)
      }
    }
    return {
      index: i,
      name: f.name,
      url,
      isVideo: f.type.startsWith('video/'),
      isAudio: f.type.startsWith('audio/'),
    }
  })
)

const tasks = computed(() =>
  Object.entries(RH_TASK_LABELS).map(([key, label]) => ({ key: key as CreationTask, label }))
)

const modelList = computed(() =>
  availableModels.value.map(k => ({ key: k, label: RH_CREATION_MODELS[k]?.label || k }))
)

// --- 新增：画廊尺寸切换 ---
const gallerySize = ref(localStorage.getItem('jc_gallery_size') || 'medium')
function onSizeChange(size: string) {
  gallerySize.value = size
  localStorage.setItem('jc_gallery_size', size)
}

// --- 新增：灯箱状态 ---
const lbShow = ref(false)
const lbIndex = ref(-1)
const lbResult = computed(() => {
  const r = cpState.results[lbIndex.value]
  return r || { url: '', type: 'image', content: '' }
})

function openLightbox(index: number) {
  lbIndex.value = index
  lbShow.value = true
}
function closeLightbox() {
  lbShow.value = false
}

/** 强制另存为（fetch → blob → objectURL + a.download） */
async function downloadResult(index: number) {
  const r = cpState.results[index]
  if (!r || !r.url) return
  if (!isAllowedDownloadUrl(r.url)) {
    cpState.progressText = '下载地址不安全，已阻止'
    return
  }
  const ext = r.type === 'video' ? 'mp4' : r.type === 'audio' ? 'mp3' : 'png'
  const filename = `creation_${r.type}_${Date.now()}.${ext}`
  try {
    // 尝试 fetch blob 下载（可能被 CORS 拦截）
    const res = await fetch(r.url, { mode: 'cors' })
    if (!res.ok) throw new Error('fetch failed')
    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000)
  } catch {
    // 降级：用 a[download] 直接链接（跨域时浏览器可能忽略 download 属性但仍能打开）
    const a = document.createElement('a')
    a.href = r.url
    a.download = filename
    a.target = '_blank'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }
}

/** 引用：将画廊素材添加到输入框参考文件中 */
async function referenceResult(index: number) {
  const r = cpState.results[index]
  if (!r || !r.url) return
  if (!isAllowedMediaAttachmentUrl(r.url)) {
    cpState.progressText = '引用失败: 素材地址不安全'
    return
  }
  try {
    const res = await fetch(r.url)
    const blob = await res.blob()
    const ext = r.type === 'video' ? 'mp4' : r.type === 'audio' ? 'mp3' : 'png'
    const mime = r.type === 'video' ? 'video/mp4' : r.type === 'audio' ? 'audio/mpeg' : 'image/png'
    const file = new File([blob], `ref_${Date.now()}.${ext}`, { type: mime })
    addFiles([file])
  } catch (e: any) {
    cpState.progressText = '引用失败: ' + (e.message || e)
  }
}

function deleteResult(index: number) {
  cpState.results.splice(index, 1)
  if (lbIndex.value === index) closeLightbox()
  saveCpState()
}
function lbDownload() {
  downloadResult(lbIndex.value)
}

// 提示词输入自适应高度
function autoGrow(e: Event) {
  const el = e.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 140) + 'px'
}

// 发送按钮状态
const canSend = computed(() =>
  Boolean(
    cpState.prompt?.trim()
    || cpState.text?.trim()
    || cpState.voicePrompt?.trim()
    || cpState.files.length > 0,
  )
)

const offSendToGallery = onEvent('send-to-gallery', (payload: any) => {
  if (!isAllowedCreationResultUrl(payload?.url || '')) return
  cpState.results.unshift({
    url: payload.url,
    type: payload.type,
    content: payload.name,
    model: 'reference',
    task: 'import',
    ts: Date.now()
  })
  saveCpState()
})

const offImportToCreation = onEvent('import-to-creation', async (payload: any) => {
  if (!isAllowedMediaAttachmentUrl(payload?.url || '')) return
  try {
    const res = await fetch(payload.url)
    const blob = await res.blob()
    let mime = 'image/png'
    if (payload.type === 'video') mime = 'video/mp4'
    else if (payload.type === 'audio') mime = 'audio/mpeg'
    const file = new File([blob], payload.name, { type: mime })
    addFiles([file])
  } catch (e) {
    console.error('Import failed', e)
  }
})
onBeforeUnmount(() => {
  offImportToCreation()
  offSendToGallery()
})
</script>

<template>
  <div class="cp" :class="'size-' + gallerySize">
    <div class="cp-toolbar">
      <span class="cp-title"><span class="mso">movie_filter</span><span class="cp-title-text">创作面板</span></span>
      <span class="cp-toolbar-spacer" />
      <GallerySizeControl :model-value="gallerySize" @update:model-value="onSizeChange" />
    </div>

    <!-- ★ 画廊区 — 全新 UI ★ -->
    <div class="cp-gallery-zone">
      <!-- 加载中占位卡 -->
      <GalleryLoadingCard v-if="creationRunningCount > 0" :text="creationProgressText" />

      <!-- 结果卡片 -->
      <template v-if="cpState.results.length">
        <GalleryCard
          v-for="(r, i) in cpState.results.slice(0, 24)"
          :key="i"
          :url="r.url"
          :type="r.type"
          :content="r.content"
          :index="i"
          @preview="openLightbox"
          @reference="referenceResult"
          @delete="deleteResult"
        />
      </template>

      <!-- 空状态 -->
      <div v-if="!cpState.results.length && creationRunningCount === 0" class="cp-empty">
        <span class="mso cp-empty-icon">auto_awesome</span>
        <div>在下方写下提示词<br/>AI 将在这里呈现你的作品</div>
      </div>
    </div>

    <!-- ★ 灯箱 ★ -->
    <GalleryLightbox
      :show="lbShow"
      :url="lbResult.url"
      :type="lbResult.type"
      :content="lbResult.content"
      @close="closeLightbox"
      @download="lbDownload"
    />

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
        <div class="cp-island-val">{{ currentModel?.label || cpState.modelKey }}</div>
        <div v-if="openPop === 'model'" class="cp-popover" @click.stop>
          <button v-for="m in modelList" :key="m.key" class="cp-pop-item"
                  :class="{ active: cpState.modelKey === m.key }"
                  @click="switchModel(m.key); openPop = ''">
            {{ m.label }}
          </button>
        </div>
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
    </div>

    <!-- 进度条 -->
    <div v-if="creationRunningCount > 0" class="cp-progress-bar">
      <div class="cp-progress-fill" :style="{ width: creationProgress + '%' }" />
    </div>
    <div v-if="creationRunningCount > 0" class="cp-progress-text">{{ creationProgressText }}</div>

    <!-- ★ 提示词输入区 (增强版) ★ -->
    <div class="cp-composer">
      <div v-if="acceptsFiles" class="cp-upload-trigger"
           @click="($refs.fileInput as HTMLInputElement).click()"
           @dragover.prevent @drop="onFileDrop" title="上传参考素材"
           :class="{ 'has-files': cpState.files.length > 0 }">
        <span class="mso">{{ cpState.files.length > 0 ? 'check' : 'add' }}</span>
        <span v-if="cpState.files.length" class="cp-file-count">{{ cpState.files.length }}</span>
        <input ref="fileInput" type="file" multiple :accept="acceptAttr"
               style="display:none" @change="onFileSelect" />
      </div>
      <div class="cp-prompt-wrap">
        <!-- 文件缩略图 -->
        <div v-if="fileThumbs.length" class="cp-files">
          <div v-for="f in fileThumbs" :key="f.index" class="cp-file-chip" :title="f.name">
            <img v-if="f.url" :src="f.url" alt="" />
            <span v-else-if="f.isVideo" class="mso">videocam</span>
            <span v-else-if="f.isAudio" class="mso">audio_file</span>
            <span v-else class="mso">attach_file</span>
            <span class="cp-file-name">{{ f.name }}</span>
            <button class="cp-file-remove" @click="removeFile(f.index)" title="移除">
              <span class="mso">close</span>
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
          <textarea v-model="cpState.text" rows="2" :placeholder="cpState.modelKey === 'rh-digital-human' ? '台词' : cpState.modelKey === 'rh-mimic' ? '动作说明' : '输出文字/文稿'" class="cp-aux-textarea" @blur="saveCpState()" />
        </div>
        <div v-if="showVoicePromptInput" class="cp-suno-row">
          <textarea v-model="cpState.voicePrompt" rows="2" placeholder="人设 + 音色特征 + 风格 + 情感 + 节奏" class="cp-aux-textarea" @blur="saveCpState()" />
        </div>
        <textarea v-model="cpState.prompt" rows="2" :placeholder="promptPlaceholder"
                  @blur="saveCpState()" @input="autoGrow" class="cp-prompt-input" />
      </div>
      <div class="cp-submit">
        <button class="cp-send-btn" :class="{ ready: canSend, generating: creationRunningCount > 0 }"
                @click="runCreationViaTaskStore" title="生成">
          <span v-if="creationRunningCount > 0" class="cp-running-badge">{{ creationRunningCount }}</span>
          <span class="mso">arrow_upward</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cp { display: flex; flex-direction: column; height: 100%; background: var(--surface); }

/* Toolbar */
.cp-toolbar {
  display: flex; align-items: center; padding: 0 16px; gap: 8px; height: var(--app-header-height); box-sizing: border-box;
  border-bottom: 1px solid var(--line); flex-shrink: 0;
}
.cp-title { font-size: 14px; font-weight: 700; color: var(--ink1); display: flex; align-items: center; gap: 4px; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cp-title .mso { font-size: 16px; color: var(--olive); }
@container (max-width: 250px) {
  .cp-title-text { display: none; }
}
.cp-toolbar-spacer { flex: 1; }

/* ★ 画廊网格 ★ */
.cp-gallery-zone {
  flex: 1; overflow-y: auto; padding: 10px 12px 6px; min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(170px, 100%), 1fr));
  gap: 8px; align-items: start; align-content: start;
}
.cp-gallery-zone::-webkit-scrollbar { width: 4px; }
.cp-gallery-zone::-webkit-scrollbar-thumb { background: rgba(0,0,0,.08); border-radius: 2px; }

/* 画廊网格动态尺寸由 GallerySizeControl v-model 驱动，这里提供 CSS 类 */
.cp.size-small .cp-gallery-zone { grid-template-columns: repeat(auto-fit, minmax(min(96px, 100%), 1fr)); gap: 5px; }
.cp.size-medium .cp-gallery-zone { grid-template-columns: repeat(auto-fit, minmax(min(170px, 100%), 1fr)); gap: 8px; }
.cp.size-large .cp-gallery-zone { grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr)); gap: 10px; }

/* 空状态 */
.cp-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; grid-column: 1 / -1; min-height: 200px;
  color: var(--ink3); text-align: center; font-size: 13px; line-height: 1.7;
}
.cp-empty-icon { font-size: 36px; color: var(--olive); animation: gcFloat 3s ease-in-out infinite; }
@keyframes gcFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }

/* Params (完全保持原有样式) */
.cp-params {
  display: flex; gap: 6px; padding: 8px 12px; border-top: 1px solid var(--line);
  flex-wrap: wrap; align-items: flex-start; flex-shrink: 0;
}
.cp-island {
  position: relative; padding: 6px 10px; border-radius: 8px;
  border: 1px solid var(--line); cursor: pointer; transition: border-color .12s;
}
.cp-island:hover { border-color: var(--olive); }
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
}
.cp-submit { flex-shrink: 0; }
.cp-send-btn {
  width: 40px; height: 40px; border-radius: 50%; border: none;
  background: var(--line); color: var(--surface); cursor: pointer; display: flex;
  align-items: center; justify-content: center; transition: all .3s;
  position: relative; pointer-events: none;
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
</style>

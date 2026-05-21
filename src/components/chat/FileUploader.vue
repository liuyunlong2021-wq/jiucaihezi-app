<script setup lang="ts">
/**
 * FileUploader.vue — 文件上传器（点击 + 拖拽 + 粘贴）
 * 支持：图片、文本/代码、PDF、DOCX/XLSX/PPTX（走后端）
 * V2: 统一走 useFileUpload，Office文件后端提取，图片大图走URL
 */
import { ref, computed } from 'vue'
import { processFile, type ProcessedFile } from '@/composables/useFileUpload'
import { formatSize } from '@/utils/fileProcessor'
import {
  buildMediaAttachmentSummary,
  cacheMediaFileForLocalProcessing,
  isAudioVideoFilename,
  type MediaCacheResult,
} from '@/utils/localContentTools'

export interface AttachedFile {
  file: File
  preview?: string
  textContent?: string
  remoteUrl?: string
  markdownFilename?: string
  markdownEngine?: string
  status: 'processing' | 'ready' | 'error'
  error?: string
  progress?: number
}

const attachedFiles = ref<AttachedFile[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)
const toastMsg = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

const isProcessing = computed(() => attachedFiles.value.some(f => f.status === 'processing'))
const hasFiles = computed(() => attachedFiles.value.length > 0)
const readyFiles = computed(() => attachedFiles.value.filter(f => f.status === 'ready'))

defineExpose({
  attachedFiles: readyFiles,
  isProcessing,
  clearAll,
  triggerFileInput,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handlePaste,
  addExternalFiles,
})

/** 外部调用：批量添加 File 对象 */
function addExternalFiles(files: File[]) {
  for (const f of files) {
    addFile(f)
  }
}

function showToast(msg: string) {
  toastMsg.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastMsg.value = '' }, 4000)
}

function triggerFileInput() {
  fileInput.value?.click()
}

function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files) return
  for (let i = 0; i < input.files.length; i++) {
    addFile(input.files[i])
  }
  input.value = ''
}

function handleDragOver(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  isDragging.value = true
}

function handleDragLeave(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  isDragging.value = false
}

function handleDrop(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  isDragging.value = false
  const files = e.dataTransfer?.files
  if (!files) return
  for (let i = 0; i < files.length; i++) {
    addFile(files[i])
  }
}

function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      const blob = items[i].getAsFile()
      if (blob) {
        const name = `粘贴图片_${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.png`
        const f = new File([blob], name, { type: blob.type })
        addFile(f)
      }
    }
  }
}

async function addFile(file: File) {
  // 去重
  if (attachedFiles.value.some(f => f.file.name === file.name && f.file.size === file.size)) return

  // 大小限制 100MB
  if (file.size > 100 * 1024 * 1024) {
    showToast(`${file.name} 过大（${formatSize(file.size)}），最大支持 100MB`)
    return
  }

  attachedFiles.value.push({ file, status: 'processing', progress: 0 })
  const idx = attachedFiles.value.length - 1

  try {
    // 图片：仅支持 Claude/GPT 接受的格式 (jpeg/png/gif/webp)
    // 其他图片格式 (bmp/svg/heic/ico) 不直接发送，避免 Bedrock 400 错误
    const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    const isImage = (
      SUPPORTED_IMAGE_TYPES.includes(file.type) ||
      /\.(png|jpe?g|gif|webp)$/i.test(file.name)
    )
    if (isImage) {
      const dataUrl = await simpleReadDataURL(file)
      attachedFiles.value[idx].preview = dataUrl
      attachedFiles.value[idx].status = 'ready'
      attachedFiles.value[idx].progress = 100
      return
    }

    if (isAudioVideoUpload(file)) {
      let cache: MediaCacheResult | null = null
      try {
        cache = await cacheMediaFileForLocalProcessing(file)
      } catch (err) {
        console.warn('[MediaCache] 本地缓存失败，仍保留元信息:', err)
      }
      const mediaSummary = await inspectAudioVideoFile(file, cache?.inputPath)
      attachedFiles.value[idx].textContent = mediaSummary
      attachedFiles.value[idx].status = 'ready'
      attachedFiles.value[idx].progress = 100
      return
    }

    // 非图片：走 processFile 处理 Office/PDF/文本等
    const result: ProcessedFile = await processFile(file, {
      maxTextLength: 500 * 1024,
      preferRemoteImage: false,
      onProgress: (pf) => { attachedFiles.value[idx].progress = pf.progress },
    })

    attachedFiles.value[idx].preview = result.previewUrl
    attachedFiles.value[idx].textContent = result.textContent
    attachedFiles.value[idx].remoteUrl = result.remoteUrl
    attachedFiles.value[idx].markdownFilename = result.markdownFilename
    attachedFiles.value[idx].markdownEngine = result.markdownEngine
    attachedFiles.value[idx].status = result.status === 'ready' ? 'ready' : 'error'
    attachedFiles.value[idx].error = result.error

    if (result.status === 'error') {
      showToast(result.error || '文件处理失败')
    }
  } catch (err: any) {
    attachedFiles.value[idx].status = 'error'
    attachedFiles.value[idx].error = (err as Error).message || '文件处理失败'
    showToast(attachedFiles.value[idx].error!)
  }
}

function isAudioVideoUpload(file: File): boolean {
  return file.type.startsWith('audio/') || file.type.startsWith('video/') || isAudioVideoFilename(file.name)
}

function inspectAudioVideoFile(file: File, cachedPath?: string): Promise<string> {
  return new Promise((resolve) => {
    const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(file.name)
    const url = URL.createObjectURL(file)
    const media = document.createElement(isVideo ? 'video' : 'audio') as HTMLMediaElement
    media.preload = 'metadata'

    const finish = () => {
      const video = media as HTMLVideoElement
      URL.revokeObjectURL(url)
      resolve(buildMediaAttachmentSummary({
        name: file.name,
        type: file.type || (isVideo ? 'video/*' : 'audio/*'),
        size: file.size,
        durationSeconds: Number.isFinite(media.duration) ? media.duration : undefined,
        width: isVideo && video.videoWidth ? video.videoWidth : undefined,
        height: isVideo && video.videoHeight ? video.videoHeight : undefined,
        cachedPath,
      }))
    }

    media.onloadedmetadata = finish
    media.onerror = finish
    media.src = url
  })
}

/** 直接读取文件为 data URL（旧版验证可靠的方式） */
function simpleReadDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

function removeFile(index: number) {
  attachedFiles.value.splice(index, 1)
}

function clearAll() {
  attachedFiles.value = []
}

function getIcon(name: string, type: string) {
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(name)) return 'audio_file'
  if (type.startsWith('video/') || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(name)) return 'video_file'
  if (/\.(srt|vtt)$/i.test(name)) return 'subtitles'
  if (/\.pdf$/i.test(name)) return 'picture_as_pdf'
  if (/\.(doc|docx)$/i.test(name)) return 'description'
  if (/\.(xls|xlsx|csv)$/i.test(name)) return 'table_chart'
  if (/\.(py|js|ts|java|go|rs|c|cpp|rb|php|swift|kt)$/i.test(name)) return 'code'
  if (/\.(json|yaml|yml|toml|xml|ini|conf)$/i.test(name)) return 'data_object'
  if (/\.(md|txt|log)$/i.test(name)) return 'article'
  return 'attach_file'
}
</script>

<template>
  <input
    ref="fileInput"
    type="file"
    multiple
    style="display:none"
    @change="handleFileSelect"
  />

  <!-- Toast 提示 -->
  <Transition name="toast">
    <div v-if="toastMsg" class="upload-toast">{{ toastMsg }}</div>
  </Transition>

  <!-- 附件预览条 -->
  <div v-if="hasFiles" class="attach-bar">
    <div v-for="(af, i) in attachedFiles" :key="i" class="attach-chip" :class="{ 'is-error': af.status === 'error' }">
      <!-- 处理中 spinner + 进度 -->
      <span v-if="af.status === 'processing'" class="attach-spinner"></span>
      <!-- 图片缩略图 -->
      <img v-else-if="af.preview" :src="af.preview" class="attach-thumb" />
      <!-- 文件图标 -->
      <span v-else class="mso attach-icon">{{ getIcon(af.file.name, af.file.type) }}</span>

      <span class="attach-name">{{ af.file.name }}</span>
      <span class="attach-size">({{ formatSize(af.file.size) }})</span>
      <span v-if="af.status === 'processing' && af.progress" class="attach-pct">{{ af.progress }}%</span>
      <span v-if="af.remoteUrl" class="attach-cloud" title="已上传到云端">
        <span class="mso" style="font-size:12px">cloud_done</span>
      </span>
      <span v-if="af.status === 'error'" class="attach-err" :title="af.error">!</span>
      <span class="mso attach-rm" @click="removeFile(i)">close</span>
      <!-- 上传进度条 -->
      <div v-if="af.status === 'processing' && af.progress" class="attach-progress">
        <div class="attach-progress-bar" :style="{ width: af.progress + '%' }"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.attach-bar {
  display: flex; flex-wrap: wrap; gap: 6px;
  padding: 6px 12px; border-top: 1px solid var(--line);
  background: var(--surface);
}
.attach-chip {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 8px; border-radius: 6px;
  background: var(--paper); border: 1px solid var(--line);
  font-size: 12px; color: var(--ink2);
  max-width: 240px; transition: border-color 0.2s;
}
.attach-chip.is-error {
  border-color: #e53935; background: rgba(229,57,53,0.05);
}
.attach-thumb {
  width: 24px; height: 24px; border-radius: 4px;
  object-fit: cover; flex-shrink: 0;
}
.attach-icon { font-size: 16px; color: var(--olive); flex-shrink: 0; }
.attach-name {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 120px; font-weight: 500;
}
.attach-size { color: var(--ink3); font-size: 11px; flex-shrink: 0; }
.attach-err {
  width: 16px; height: 16px; border-radius: 50%;
  background: #e53935; color: #fff; font-size: 11px;
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; flex-shrink: 0; cursor: help;
}
.attach-rm {
  font-size: 14px; color: var(--ink3); cursor: pointer;
  margin-left: 2px; flex-shrink: 0;
}
.attach-rm:hover { color: #e53935; }

.attach-pct {
  font-size: 10px; color: var(--olive); font-weight: 600;
  flex-shrink: 0; min-width: 28px; text-align: right;
}
.attach-cloud {
  flex-shrink: 0; color: var(--olive); display: flex; align-items: center;
}
.attach-progress {
  position: absolute; bottom: 0; left: 0; right: 0; height: 2px;
  background: var(--line); border-radius: 0 0 6px 6px; overflow: hidden;
}
.attach-progress-bar {
  height: 100%; background: var(--olive);
  transition: width 0.3s ease;
}
.attach-chip { position: relative; }

.attach-spinner {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid var(--line); border-top-color: var(--olive);
  animation: spin 0.8s linear infinite; flex-shrink: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }

.upload-toast {
  position: fixed; top: 60px; left: 50%; transform: translateX(-50%);
  background: rgba(30,30,30,0.92); color: #fff;
  padding: 8px 18px; border-radius: 8px; font-size: 13px;
  z-index: 9999; pointer-events: none;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}
.toast-enter-active, .toast-leave-active { transition: opacity 0.3s, transform 0.3s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(-8px); }
</style>

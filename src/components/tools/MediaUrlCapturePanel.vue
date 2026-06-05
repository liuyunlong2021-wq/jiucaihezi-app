<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { isTauriRuntime } from '@/utils/tauriEnv'

const emit = defineEmits<{ back: [] }>()

type CaptureState = 'idle' | 'inspecting' | 'ready' | 'downloading' | 'done' | 'cancelled' | 'error'
type MediaUrlDownloadKind = 'video' | 'audio' | 'subtitles' | 'metadata'

interface MediaUrlInspectResult {
  id: string
  url: string
  title: string
  site: string
  durationSeconds?: number
  thumbnailUrl?: string
  hasVideo: boolean
  hasAudio: boolean
  hasSubtitles: boolean
  hasMetadata: boolean
}

interface MediaUrlDownloadOutput {
  filename: string
  outputPath: string
  outputDir: string
  size?: number
  durationSeconds?: number
  format: string
}

interface MediaUrlDownloadSnapshot {
  kind: MediaUrlDownloadKind
  videoQuality: 'best' | 'compact'
  audioFormat: 'mp3' | 'wav'
  subtitleLanguage: 'zh' | 'en' | 'auto'
}

interface MediaUrlProgressEvent {
  jobId: string
  stage: string
  progress: number
  message: string
}

const state = ref<CaptureState>('idle')
const url = ref('')
const errorMessage = ref('')
const result = ref<MediaUrlInspectResult | null>(null)
const output = ref<MediaUrlDownloadOutput | null>(null)
const downloadKind = ref<MediaUrlDownloadKind>('video')
const videoQuality = ref<'best' | 'compact'>('best')
const audioFormat = ref<'mp3' | 'wav'>('mp3')
const subtitleLanguage = ref<'zh' | 'en' | 'auto'>('zh')
const progress = ref(0)
const progressText = ref('')
const outputDir = ref('~/Movies/韭菜盒子/网页媒体/')
const downloadSnapshot = ref<MediaUrlDownloadSnapshot | null>(null)
const currentJobId = ref('')
const useBrowserSessionForCurrentUrl = ref(false)
let stopProgressListener: (() => void) | null = null

const downloadLocked = computed(() => state.value === 'downloading')
const canInspect = computed(() =>
  url.value.trim().length > 0 &&
  state.value !== 'inspecting' &&
  state.value !== 'downloading'
)
const canDownload = computed(() => result.value && state.value !== 'downloading' && state.value !== 'error')
const modeLabel = computed(() => kindLabel(downloadSnapshot.value?.kind || downloadKind.value))

function kindLabel(kind: MediaUrlDownloadKind): string {
  return ({
    video: '视频',
    audio: '音频',
    subtitles: '字幕',
    metadata: '元数据',
  }[kind])
}

function downloadKindDisabledReason(kind: MediaUrlDownloadKind): string {
  const current = result.value
  if (!current || kind === 'metadata') return ''
  if (kind === 'video' && !current.hasVideo) return '这个链接没有可下载的视频。'
  if (kind === 'audio' && !current.hasAudio) return '这个链接没有可下载的音频。'
  if (kind === 'subtitles' && !current.hasSubtitles) return '这个链接没有可下载的字幕。'
  return ''
}

function firstAvailableDownloadKind(current: MediaUrlInspectResult): MediaUrlDownloadKind {
  if (current.hasVideo) return 'video'
  if (current.hasAudio) return 'audio'
  if (current.hasSubtitles) return 'subtitles'
  return 'metadata'
}

function selectDownloadKind(kind: MediaUrlDownloadKind) {
  const reason = downloadKindDisabledReason(kind)
  if (reason) {
    errorMessage.value = reason
    return
  }
  errorMessage.value = ''
  downloadKind.value = kind
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function formatDuration(seconds?: number): string {
  if (!Number.isFinite(seconds || NaN)) return '未知时长'
  const total = Math.max(0, Math.round(Number(seconds)))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}`
}

function formatBytes(size?: number): string {
  if (!Number.isFinite(size || NaN)) return '未知大小'
  const value = Number(size)
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function siteNameFromUrl(value: string): string {
  try {
    const host = new URL(value).hostname.replace(/^www\./, '')
    if (host.includes('xinpianchang')) return '新片场'
    if (host.includes('youtube')) return 'YouTube'
    if (host.includes('bilibili')) return '哔哩哔哩'
    return host
  } catch {
    return '网页媒体'
  }
}

function mockTitle(value: string): string {
  const site = siteNameFromUrl(value)
  if (site === '新片场') return '新片场作品标题'
  return `${site} 媒体素材`
}

function normalizeOutputDir(value?: string): string {
  return value || '~/Movies/韭菜盒子/网页媒体/'
}

function nextJobId(): string {
  return `media_url_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

async function invokeDesktop<T>(command: string, payload: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return await invoke<T>(command, payload)
}

function setError(message: string, options: { clearMedia?: boolean } = {}) {
  errorMessage.value = message
  if (options.clearMedia !== false) {
    result.value = null
    output.value = null
  }
  state.value = 'error'
}

function needsBrowserStateRetry(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '')
  return message.includes('浏览器访问状态')
}

async function inspectUrlWithBrowserState(rawUrl: string, useBrowserSession: boolean): Promise<MediaUrlInspectResult> {
  return await invokeDesktop<MediaUrlInspectResult>('media_url_inspect', {
    input: {
      url: rawUrl,
      jobId: currentJobId.value,
      useBrowserSession,
    },
  })
}

async function inspectUrl() {
  const rawUrl = url.value.trim()
  if (!rawUrl) return
  if (!isHttpUrl(rawUrl)) {
    setError('链接无效，请粘贴 http 或 https 开头的网页地址。')
    return
  }

  state.value = 'inspecting'
  errorMessage.value = ''
  result.value = null
  output.value = null
  useBrowserSessionForCurrentUrl.value = false
  currentJobId.value = nextJobId()

  try {
    if (isTauriRuntime()) {
      try {
        result.value = await inspectUrlWithBrowserState(rawUrl, false)
      } catch (error) {
        if (!needsBrowserStateRetry(error)) throw error
        progressText.value = '正在补充网站访问信息'
        result.value = await inspectUrlWithBrowserState(rawUrl, true)
        useBrowserSessionForCurrentUrl.value = true
      }
      outputDir.value = normalizeOutputDir()
    } else {
      await new Promise(resolve => window.setTimeout(resolve, 560))
      result.value = {
        id: currentJobId.value,
        url: rawUrl,
        title: mockTitle(rawUrl),
        site: siteNameFromUrl(rawUrl),
        durationSeconds: 222,
        thumbnailUrl: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 640 400%22%3E%3Crect width=%22640%22 height=%22400%22 fill=%22%23edf0df%22/%3E%3Crect x=%2248%22 y=%2244%22 width=%22544%22 height=%22312%22 rx=%2222%22 fill=%22%23d5c787%22 opacity=%22.52%22/%3E%3Ccircle cx=%22320%22 cy=%22200%22 r=%2256%22 fill=%22%236b8e23%22/%3E%3Cpath d=%22M304 168v64l54-32z%22 fill=%22white%22/%3E%3Ctext x=%22320%22 y=%22318%22 text-anchor=%22middle%22 font-size=%2228%22 font-family=%22sans-serif%22 fill=%22%233d4d1e%22%3E%E7%BD%91%E9%A1%B5%E5%AA%92%E4%BD%93%3C/text%3E%3C/svg%3E',
        hasVideo: true,
        hasAudio: true,
        hasSubtitles: true,
        hasMetadata: true,
      }
    }
    if (result.value && downloadKindDisabledReason(downloadKind.value)) {
      downloadKind.value = firstAvailableDownloadKind(result.value)
    }
    state.value = 'ready'
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error || '解析失败，请检查链接后重试。'))
  }
}

function outputFilename(snapshot: MediaUrlDownloadSnapshot = currentDownloadSnapshot()): string {
  const base = (result.value?.title || '网页媒体素材').replace(/[\\/:*?"<>|]+/g, '_')
  if (snapshot.kind === 'audio') return `${base}.${snapshot.audioFormat}`
  if (snapshot.kind === 'subtitles') return `${base}.srt`
  if (snapshot.kind === 'metadata') return `${base}.json`
  return `${base}.mp4`
}

function outputFormat(snapshot: MediaUrlDownloadSnapshot = currentDownloadSnapshot()): string {
  if (snapshot.kind === 'audio') return snapshot.audioFormat.toUpperCase()
  if (snapshot.kind === 'subtitles') return 'SRT'
  if (snapshot.kind === 'metadata') return 'JSON'
  return 'MP4'
}

function currentDownloadSnapshot(): MediaUrlDownloadSnapshot {
  return {
    kind: downloadKind.value,
    videoQuality: videoQuality.value,
    audioFormat: audioFormat.value,
    subtitleLanguage: subtitleLanguage.value,
  }
}

function outputSize(snapshot: MediaUrlDownloadSnapshot): number {
  if (snapshot.kind === 'metadata') return 48_200
  if (snapshot.kind === 'subtitles') return 18_600
  if (snapshot.kind === 'audio') return snapshot.audioFormat === 'wav' ? 42_000_000 : 8_400_000
  return snapshot.videoQuality === 'compact' ? 72_000_000 : 128_000_000
}

async function downloadMedia() {
  if (!result.value) return
  const snapshot = currentDownloadSnapshot()
  downloadSnapshot.value = snapshot
  state.value = 'downloading'
  output.value = null
  progress.value = 0
  errorMessage.value = ''
  currentJobId.value = result.value.id || currentJobId.value || nextJobId()

  try {
    if (isTauriRuntime()) {
      output.value = await invokeDesktop<MediaUrlDownloadOutput>('media_url_download', {
        input: {
          jobId: currentJobId.value,
          url: result.value.url,
          title: result.value.title,
          kind: snapshot.kind,
          videoQuality: snapshot.videoQuality,
          audioFormat: snapshot.audioFormat,
          subtitleLanguage: snapshot.subtitleLanguage,
          outputDir: outputDir.value,
          useBrowserSession: useBrowserSessionForCurrentUrl.value,
        },
      })
      outputDir.value = output.value.outputDir
      progress.value = 100
      progressText.value = '写入完成'
    } else {
      const steps = [
        { text: '正在获取媒体信息', value: 18 },
        { text: `正在下载${modeLabel.value}`, value: 56 },
        { text: snapshot.kind === 'video' ? '正在处理音视频' : '正在整理输出文件', value: 82 },
        { text: '正在写入本地文件', value: 100 },
      ]

      for (const step of steps) {
        progressText.value = step.text
        await new Promise(resolve => window.setTimeout(resolve, 420))
        progress.value = step.value
      }

      const filename = outputFilename(snapshot)
      output.value = {
        filename,
        outputPath: `${outputDir.value}${filename}`,
        outputDir: outputDir.value,
        size: outputSize(snapshot),
        durationSeconds: result.value.durationSeconds,
        format: outputFormat(snapshot),
      }
    }
    state.value = 'done'
  } catch (error) {
    if ((state.value as CaptureState) !== 'cancelled') {
      setError(error instanceof Error ? error.message : String(error || '下载失败，请稍后重试。'), { clearMedia: false })
    }
  } finally {
    downloadSnapshot.value = null
  }
}

async function cancelDownload() {
  if (state.value !== 'downloading') return
  state.value = 'cancelled'
  progressText.value = '已停止'
  try {
    if (isTauriRuntime() && currentJobId.value) {
      await invokeDesktop('cancel_media_url_download', { input: { jobId: currentJobId.value } })
    }
  } catch {
    // 取消失败不改变用户已经看到的停止状态。
  }
}

async function openOutput() {
  if (!output.value) return
  if (!isTauriRuntime()) {
    setError('打开播放需要桌面端运行环境。')
    return
  }
  try {
    await invokeDesktop('media_open_file', { path: output.value.outputPath })
  } catch (error) {
    setError(error instanceof Error ? error.message : '无法打开文件。', { clearMedia: false })
  }
}

async function revealOutput() {
  if (!output.value) return
  if (!isTauriRuntime()) {
    setError('在 Finder 中显示需要桌面端运行环境。')
    return
  }
  try {
    await invokeDesktop('media_reveal_file', { path: output.value.outputPath })
  } catch (error) {
    setError(error instanceof Error ? error.message : '无法在 Finder 中显示文件。', { clearMedia: false })
  }
}

function reset() {
  state.value = 'idle'
  errorMessage.value = ''
  result.value = null
  output.value = null
  downloadSnapshot.value = null
  useBrowserSessionForCurrentUrl.value = false
  progress.value = 0
  progressText.value = ''
}

onMounted(async () => {
  if (!isTauriRuntime()) return
  const { listen } = await import('@tauri-apps/api/event')
  stopProgressListener = await listen<MediaUrlProgressEvent>('media-url-capture-progress', event => {
    const payload = event.payload
    if (!payload || payload.jobId !== currentJobId.value) return
    progress.value = Math.max(0, Math.min(100, Math.round(payload.progress)))
    progressText.value = payload.message || payload.stage
  })
})

onUnmounted(() => {
  stopProgressListener?.()
  stopProgressListener = null
})
</script>

<template>
  <div class="muc">
    <div class="muc-head">
      <button class="muc-back" title="返回工具仓库" aria-label="返回工具仓库" @click="emit('back')">
        <span class="mso">arrow_back</span>
      </button>
      <div class="muc-title">
        <h3>网页媒体采集</h3>
        <span>把用户提供的链接变成本地素材</span>
      </div>
    </div>

    <div class="muc-body">
      <section class="muc-panel">
        <div class="muc-url">
          <span class="mso">link</span>
          <input
            v-model="url"
            :disabled="state === 'inspecting' || state === 'downloading'"
            type="url"
            placeholder="粘贴视频/音频网页链接"
            @keydown.enter="inspectUrl"
          />
          <button :disabled="!canInspect" @click="inspectUrl">
            {{ state === 'inspecting' ? '解析中' : '解析' }}
          </button>
        </div>
        <p class="muc-note">仅处理你明确提供的链接。下载前会先解析内容和可采集类型。</p>
      </section>

      <section v-if="state === 'error'" class="muc-error">
        <span class="mso">error</span>
        <div>
          <strong>{{ errorMessage }}</strong>
          <button @click="reset">重新开始</button>
        </div>
      </section>

      <section v-if="state === 'cancelled'" class="muc-error">
        <span class="mso">block</span>
        <div>
          <strong>下载已停止。</strong>
          <button @click="state = result ? 'ready' : 'idle'">继续处理</button>
        </div>
      </section>

      <section v-if="result" class="muc-panel result">
        <div class="muc-thumb">
          <img v-if="result.thumbnailUrl" :src="result.thumbnailUrl" alt="" />
          <span v-else class="mso">movie</span>
        </div>
        <div class="muc-result-main">
          <h4>{{ result.title }}</h4>
          <div class="muc-meta">
            <span>来源：{{ result.site }}</span>
            <span>时长：{{ formatDuration(result.durationSeconds) }}</span>
          </div>
          <div class="muc-tags">
            <span v-if="result.hasVideo">视频</span>
            <span v-if="result.hasAudio">音频</span>
            <span v-if="result.hasSubtitles">字幕</span>
            <span v-if="result.hasMetadata">元数据</span>
          </div>
        </div>
      </section>

      <section v-if="result && state !== 'done'" class="muc-panel">
        <div class="muc-section-title">下载内容</div>
        <div class="muc-segment">
          <button
            :disabled="downloadLocked || Boolean(downloadKindDisabledReason('video'))"
            :class="{ active: downloadKind === 'video' }"
            :title="downloadKindDisabledReason('video') || '视频'"
            @click="selectDownloadKind('video')"
          >
            <span class="mso">movie</span>
            视频
          </button>
          <button
            :disabled="downloadLocked || Boolean(downloadKindDisabledReason('audio'))"
            :class="{ active: downloadKind === 'audio' }"
            :title="downloadKindDisabledReason('audio') || '音频'"
            @click="selectDownloadKind('audio')"
          >
            <span class="mso">music_note</span>
            音频
          </button>
          <button
            :disabled="downloadLocked || Boolean(downloadKindDisabledReason('subtitles'))"
            :class="{ active: downloadKind === 'subtitles' }"
            :title="downloadKindDisabledReason('subtitles') || '字幕'"
            @click="selectDownloadKind('subtitles')"
          >
            <span class="mso">subtitles</span>
            字幕
          </button>
          <button
            :disabled="downloadLocked"
            :class="{ active: downloadKind === 'metadata' }"
            @click="selectDownloadKind('metadata')"
          >
            <span class="mso">data_object</span>
            元数据
          </button>
        </div>

        <div class="muc-options">
          <label v-if="downloadKind === 'video'">
            <span>视频质量</span>
            <select v-model="videoQuality" :disabled="downloadLocked">
              <option value="best">最佳</option>
              <option value="compact">省空间</option>
            </select>
          </label>
          <label v-if="downloadKind === 'audio'">
            <span>音频格式</span>
            <select v-model="audioFormat" :disabled="downloadLocked">
              <option value="mp3">mp3</option>
              <option value="wav">wav</option>
            </select>
          </label>
          <label v-if="downloadKind === 'subtitles'">
            <span>字幕语言</span>
            <select v-model="subtitleLanguage" :disabled="downloadLocked">
              <option value="zh">中文</option>
              <option value="en">英文</option>
              <option value="auto">自动</option>
            </select>
          </label>
          <div v-if="downloadKind === 'metadata'" class="muc-metadata">
            标题、描述、缩略图和 JSON
          </div>
        </div>
      </section>

      <section v-if="result && state !== 'done'" class="muc-panel">
        <div class="muc-section-title">保存到</div>
        <div class="muc-output-dir">
          <span class="mso">folder_open</span>
          <span>{{ outputDir }}</span>
          <button disabled>更改位置</button>
        </div>
      </section>

      <section v-if="state === 'downloading'" class="muc-panel">
        <div class="muc-section-title">正在下载</div>
        <div class="muc-progress">
          <div class="muc-progress-bar">
            <div :style="{ width: `${progress}%` }"></div>
          </div>
          <span>{{ progressText }} · {{ progress }}%</span>
        </div>
        <button class="muc-secondary" @click="cancelDownload">取消下载</button>
      </section>

      <button
        v-if="result && state !== 'done'"
        class="muc-primary"
        :disabled="!canDownload"
        @click="downloadMedia"
      >
        下载到本地
      </button>

      <section v-if="output" class="muc-panel output">
        <div class="muc-done">
          <span class="mso">check_circle</span>
          <strong>下载完成</strong>
        </div>
        <div class="muc-file">
          <span class="mso">draft</span>
          <div>
            <strong>{{ output.filename }}</strong>
            <span>{{ formatBytes(output.size) }} · {{ formatDuration(output.durationSeconds) }} · {{ output.format }}</span>
          </div>
        </div>
        <div class="muc-output-dir saved">
          <span class="mso">folder_open</span>
          <span>保存位置：{{ output.outputDir }}</span>
        </div>
        <div class="muc-actions">
          <button @click="openOutput">
            <span class="mso">play_circle</span>
            打开播放
          </button>
          <button @click="revealOutput">
            <span class="mso">folder_open</span>
            在 Finder 中显示
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.muc {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--surface);
}
.muc-head {
  min-height: 49px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  gap: 10px;
  box-sizing: border-box;
}
.muc-back {
  width: 30px;
  height: 30px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--paper);
  color: var(--ink2);
  display: grid;
  place-items: center;
  cursor: pointer;
}
.muc-back .mso {
  font-size: 18px;
}
.muc-title {
  display: grid;
  gap: 2px;
}
.muc-title h3 {
  margin: 0;
  color: var(--ink1);
  font-size: 15px;
  font-weight: 800;
}
.muc-title span,
.muc-note {
  color: var(--ink3);
  font-size: 11px;
}
.muc-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.muc-panel,
.muc-error {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  padding: 12px;
}
.muc-url {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg);
  padding: 6px 7px;
}
.muc-url .mso {
  color: var(--olive-dark);
  font-size: 18px;
}
.muc-url input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: none;
  color: var(--ink1);
  font-size: 13px;
  font-family: inherit;
}
.muc-url button,
.muc-primary,
.muc-secondary,
.muc-actions button,
.muc-output-dir button,
.muc-error button {
  border: 1px solid var(--line);
  border-radius: 7px;
  font-family: inherit;
  font-weight: 800;
  cursor: pointer;
}
.muc-url button,
.muc-primary {
  background: var(--olive);
  color: #fff;
}
.muc-secondary {
  margin-top: 10px;
  padding: 7px 10px;
  background: var(--surface);
  color: var(--ink2);
  font-size: 12px;
}
.muc-url button {
  padding: 6px 12px;
  font-size: 12px;
}
.muc-url button:disabled,
.muc-primary:disabled,
.muc-actions button:disabled,
.muc-output-dir button:disabled {
  opacity: .5;
  cursor: default;
}
.muc-note {
  margin: 8px 0 0;
}
.muc-error {
  display: flex;
  gap: 8px;
  color: var(--jc-error);
  background: rgba(185, 28, 28, .06);
  border-color: rgba(185, 28, 28, .24);
}
.muc-error .mso {
  font-size: 19px;
}
.muc-error div {
  display: grid;
  gap: 8px;
}
.muc-error strong {
  font-size: 12px;
}
.muc-error button {
  width: max-content;
  padding: 5px 9px;
  color: var(--ink2);
  background: var(--paper);
}
.muc-panel.result {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 12px;
}
.muc-thumb {
  aspect-ratio: 16 / 10;
  border-radius: 7px;
  background: linear-gradient(135deg, rgba(107,142,35,.14), rgba(213,199,135,.22));
  display: grid;
  place-items: center;
  overflow: hidden;
}
.muc-thumb .mso {
  color: var(--olive-dark);
  font-size: 28px;
}
.muc-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.muc-result-main {
  min-width: 0;
  display: grid;
  gap: 7px;
  align-content: center;
}
.muc-result-main h4 {
  margin: 0;
  color: var(--ink1);
  font-size: 14px;
  overflow-wrap: anywhere;
}
.muc-meta,
.muc-tags,
.muc-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.muc-meta {
  color: var(--ink3);
  font-size: 11px;
}
.muc-tags span {
  border-radius: 5px;
  background: rgba(213,199,135,.14);
  color: var(--olive-dark);
  font-size: 10px;
  font-weight: 800;
  padding: 2px 7px;
}
.muc-section-title {
  color: var(--ink1);
  font-size: 12px;
  font-weight: 800;
  margin-bottom: 8px;
}
.muc-segment {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}
.muc-segment button {
  min-height: 34px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--surface);
  color: var(--ink2);
  font-size: 11px;
  font-weight: 800;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  cursor: pointer;
}
.muc-segment button.active {
  border-color: rgba(107,142,35,.42);
  background: rgba(107,142,35,.1);
  color: var(--olive-dark);
}
.muc-segment button:disabled {
  cursor: default;
  opacity: .72;
}
.muc-segment .mso {
  font-size: 16px;
}
.muc-options {
  margin-top: 10px;
}
.muc-options label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--ink2);
  font-size: 12px;
}
.muc-options select {
  min-width: 108px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--bg);
  color: var(--ink1);
  padding: 6px 8px;
  font-family: inherit;
}
.muc-metadata {
  color: var(--ink2);
  font-size: 12px;
}
.muc-output-dir,
.muc-file {
  display: flex;
  align-items: center;
  gap: 8px;
}
.muc-output-dir {
  color: var(--ink2);
  font-size: 12px;
}
.muc-output-dir.saved {
  padding: 7px 8px;
  border-radius: 7px;
  background: var(--surface-alt);
}
.muc-output-dir .mso {
  color: var(--olive-dark);
  font-size: 18px;
}
.muc-output-dir span:nth-child(2) {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.muc-output-dir button {
  padding: 5px 8px;
  background: var(--surface);
  color: var(--ink2);
  font-size: 11px;
}
.muc-progress {
  display: grid;
  gap: 7px;
}
.muc-progress-bar {
  height: 6px;
  border-radius: 999px;
  background: var(--line);
  overflow: hidden;
}
.muc-progress-bar div {
  height: 100%;
  border-radius: inherit;
  background: var(--olive);
  transition: width .24s ease;
}
.muc-progress span {
  color: var(--ink3);
  font-size: 11px;
}
.muc-primary {
  min-height: 38px;
  font-size: 13px;
}
.muc-panel.output {
  display: grid;
  gap: 11px;
}
.muc-done {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--olive-dark);
  font-size: 13px;
}
.muc-done .mso {
  font-size: 19px;
}
.muc-file .mso {
  color: var(--olive-dark);
  font-size: 22px;
}
.muc-file div {
  min-width: 0;
  display: grid;
  gap: 2px;
}
.muc-file strong {
  color: var(--ink1);
  font-size: 13px;
  overflow-wrap: anywhere;
}
.muc-file span {
  color: var(--ink3);
  font-size: 11px;
}
.muc-actions button {
  padding: 6px 9px;
  background: var(--surface);
  color: var(--ink2);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
}
.muc-actions button:not(:disabled):hover,
.muc-back:hover {
  border-color: var(--olive);
  color: var(--olive-dark);
  background: rgba(107,142,35,.06);
}
.muc-actions .mso {
  font-size: 15px;
}
</style>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { emitEvent } from '@/utils/eventBus'

type MediaWorkbenchMode = 'info' | 'text' | 'convert' | 'caption'
type WorkbenchStatus = 'empty' | 'ready' | 'running' | 'done' | 'error'
type TextFormat = 'txt' | 'srt' | 'vtt'
type ConvertAction = 'compress' | 'mp4' | 'audio'
type CaptionSource = 'paste' | 'file' | 'recent'

interface MediaInspectResult {
  inputPath: string
  filename: string
  size: number
  format: string
  kind: string
  durationSeconds?: number
  width?: number
  height?: number
  fps?: number
  audioCodec?: string
  videoCodec?: string
  hasAudio: boolean
  hasVideo: boolean
  hasSubtitles: boolean
}

interface MediaOutput {
  outputPath: string
  outputFilename: string
  outputSize: number
  durationMs: number
}

interface TranscriptOutput extends MediaOutput {
  text: string
}

const props = withDefaults(defineProps<{ initialMode?: MediaWorkbenchMode }>(), {
  initialMode: 'info',
})
const emit = defineEmits<{ back: [] }>()

const mode = ref<MediaWorkbenchMode>(props.initialMode)
const status = ref<WorkbenchStatus>('empty')
const file = ref<MediaInspectResult | null>(null)
const output = ref<MediaOutput | null>(null)
const transcriptText = ref('')
const recentSrtText = ref('')
const errorMessage = ref('')
const progress = ref(0)
const progressText = ref('')
const textFormat = ref<TextFormat>('txt')
const textLanguage = ref('auto')
const textSpeed = ref<'fast' | 'clear'>('fast')
const convertAction = ref<ConvertAction>('compress')
const convertQuality = ref<'small' | 'balanced' | 'clean'>('balanced')
const captionSource = ref<CaptionSource>('paste')
const subtitleText = ref('')
const subtitleFilename = ref('')
let progressTimer: number | undefined

const modes: Array<{ value: MediaWorkbenchMode; label: string; icon: string }> = [
  { value: 'info', label: '查看信息', icon: 'info' },
  { value: 'text', label: '转文字', icon: 'record_voice_over' },
  { value: 'convert', label: '压缩转格式', icon: 'movie_filter' },
  { value: 'caption', label: '视频上字幕', icon: 'subtitles' },
]

function modeDisabledReason(targetMode: MediaWorkbenchMode): string {
  const current = file.value
  if (!current || targetMode === 'info') return ''
  if (targetMode === 'text' && !current.hasAudio) return '转文字需要文件中包含音频。'
  if (targetMode === 'caption' && !current.hasVideo) return '视频上字幕需要选择视频文件。'
  if (targetMode === 'convert' && !current.hasVideo && !current.hasAudio) return '压缩转格式需要选择音频或视频文件。'
  return ''
}

function choiceDisabledReason(action: ConvertAction): string {
  const current = file.value
  if (!current) return ''
  if ((action === 'compress' || action === 'mp4') && !current.hasVideo) return '这个动作需要选择视频文件。'
  if (action === 'audio' && !current.hasAudio) return '导出音频需要文件中包含音频。'
  return ''
}

const actionBlockedReason = computed(() => {
  const modeReason = modeDisabledReason(mode.value)
  if (modeReason) return modeReason
  if (mode.value === 'convert') return choiceDisabledReason(convertAction.value)
  if (mode.value === 'caption' && !captionText.value.trim()) return '请先提供字幕内容。'
  return ''
})

const canRun = computed(() => {
  if (!file.value || status.value === 'running') return false
  if (mode.value === 'info') return true
  return !actionBlockedReason.value
})

const actionLabel = computed(() => ({
  info: '查看信息',
  text: '开始转文字',
  convert: '开始处理',
  caption: '开始上字幕',
}[mode.value]))

const captionText = computed(() => {
  if (captionSource.value === 'recent') return recentSrtText.value
  return subtitleText.value
})

const summaryItems = computed(() => {
  const current = file.value
  if (!current) return []
  return [
    ['类型', current.kind === 'video' ? '视频' : current.kind === 'audio' ? '音频' : '媒体'],
    ['格式', current.format || '未知'],
    ['时长', formatDuration(current.durationSeconds)],
    ['大小', formatBytes(current.size)],
    ['画面', current.width && current.height ? `${current.width} x ${current.height}` : '无'],
    ['音轨', current.hasAudio ? current.audioCodec || '有' : '无'],
  ]
})

watch(() => props.initialMode, value => {
  mode.value = value
})

function basename(path: string): string {
  return String(path || '').split(/[\\/]/).filter(Boolean).at(-1) || 'media'
}

function stem(name: string): string {
  return basename(name).replace(/\.[^.]+$/, '') || 'media'
}

function formatBytes(size?: number): string {
  if (!Number.isFinite(size || NaN)) return '未知'
  const value = Math.max(0, Number(size))
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatDuration(seconds?: number): string {
  if (!Number.isFinite(seconds || NaN)) return '未知'
  const total = Math.max(0, Math.round(Number(seconds)))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  if (hours) return `${hours}:${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}`
  return `${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}`
}

function resetRunState() {
  errorMessage.value = ''
  output.value = null
  transcriptText.value = ''
  progress.value = 0
  progressText.value = ''
  stopSoftProgress()
}

function setError(message: string) {
  stopSoftProgress()
  errorMessage.value = message || '处理失败，请检查文件后重试。'
  progress.value = 0
  progressText.value = ''
  status.value = 'error'
}

function startSoftProgress(label: string, ceiling = 92) {
  stopSoftProgress()
  progress.value = Math.max(progress.value, 8)
  progressText.value = label
  progressTimer = window.setInterval(() => {
    if (status.value !== 'running') return
    progress.value = Math.min(ceiling, progress.value + Math.max(1, Math.round((ceiling - progress.value) / 9)))
  }, 900)
}

function stopSoftProgress() {
  if (progressTimer) window.clearInterval(progressTimer)
  progressTimer = undefined
}

async function selectMediaFile() {
  resetRunState()
  status.value = 'running'
  startSoftProgress('正在读取文件信息', 72)
  try {
    const selected = await invoke<MediaInspectResult | null>('media_select_file', {
      input: { title: '选择音频或视频' },
    })
    if (!selected) {
      stopSoftProgress()
      status.value = file.value ? 'ready' : 'empty'
      progress.value = 0
      progressText.value = ''
      return
    }
    file.value = selected
    if (modeDisabledReason(mode.value)) mode.value = 'info'
    if (choiceDisabledReason(convertAction.value)) {
      convertAction.value = selected.hasVideo ? 'compress' : 'audio'
    }
    stopSoftProgress()
    progress.value = 100
    progressText.value = '已读取'
    status.value = 'ready'
  } catch (error) {
    file.value = null
    setError(error instanceof Error ? error.message : String(error || '读取失败，请重新选择文件。'))
  }
}

async function selectSubtitleFile() {
  const selected = await openDialog({
    multiple: false,
    directory: false,
    title: '选择字幕文件',
    filters: [{ name: '字幕', extensions: ['srt', 'txt'] }],
  })
  if (typeof selected !== 'string' || !selected.trim()) return
  try {
    subtitleText.value = await readTextFile(selected)
    subtitleFilename.value = basename(selected)
    captionSource.value = 'file'
    errorMessage.value = ''
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error || '字幕读取失败。'))
  }
}

function crfForQuality() {
  if (convertQuality.value === 'small') return 30
  if (convertQuality.value === 'clean') return 20
  return 24
}

function selectMode(nextMode: MediaWorkbenchMode) {
  const reason = modeDisabledReason(nextMode)
  if (reason) {
    errorMessage.value = reason
    return
  }
  errorMessage.value = ''
  mode.value = nextMode
}

function selectConvertAction(action: ConvertAction) {
  const reason = choiceDisabledReason(action)
  if (reason) {
    errorMessage.value = reason
    return
  }
  errorMessage.value = ''
  convertAction.value = action
}

function outputNameForConvert() {
  const base = stem(file.value?.filename || 'media')
  if (convertAction.value === 'audio') return `${base}_audio.mp3`
  if (convertAction.value === 'mp4') return `${base}_mp4.mp4`
  return `${base}_small.mp4`
}

function targetFormatForConvert() {
  return convertAction.value === 'audio' ? 'mp3' : 'mp4'
}

function backendActionForConvert() {
  if (convertAction.value === 'audio') return 'extract_audio'
  if (convertAction.value === 'mp4') return 'convert'
  return 'compress'
}

async function runCurrentAction() {
  if (!file.value || !canRun.value) return
  resetRunState()
  status.value = 'running'

  try {
    if (mode.value === 'info') {
      startSoftProgress('正在刷新文件信息', 72)
      file.value = await invoke<MediaInspectResult>('media_inspect_file', {
        input: { inputPath: file.value.inputPath },
      })
      finishWithoutOutput('信息已更新')
      return
    }

    if (mode.value === 'text') {
      startSoftProgress('正在转成文字', 94)
      const result = await invoke<TranscriptOutput>('media_transcribe_file', {
        input: {
          inputPath: file.value.inputPath,
          outputFormat: textFormat.value,
          language: textLanguage.value === 'auto' ? undefined : textLanguage.value,
          model: textSpeed.value === 'clear' ? 'small' : 'base',
        },
      })
      output.value = result
      transcriptText.value = result.text || ''
      if (textFormat.value === 'srt') recentSrtText.value = result.text || ''
      finishWithOutput('文字已生成')
      return
    }

    if (mode.value === 'convert') {
      startSoftProgress('正在处理媒体', 94)
      const result = await invoke<MediaOutput>('media_process_file', {
        input: {
          inputPath: file.value.inputPath,
          action: backendActionForConvert(),
          targetFormat: targetFormatForConvert(),
          outputFilename: outputNameForConvert(),
          crf: crfForQuality(),
        },
      })
      output.value = result
      finishWithOutput('文件已生成')
      return
    }

    startSoftProgress('正在生成带字幕的视频', 94)
    const result = await invoke<MediaOutput>('media_burn_subtitles', {
      input: {
        inputPath: file.value.inputPath,
        subtitleText: captionText.value,
        outputFilename: `${stem(file.value.filename)}_captioned.mp4`,
      },
    })
    output.value = result
    finishWithOutput('视频已生成')
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error || '处理失败，请检查文件后重试。'))
  }
}

function finishWithoutOutput(message: string) {
  stopSoftProgress()
  progress.value = 100
  progressText.value = message
  status.value = 'ready'
}

function finishWithOutput(message: string) {
  stopSoftProgress()
  progress.value = 100
  progressText.value = message
  status.value = 'done'
}

async function openOutput() {
  if (!output.value) return
  await invoke('media_open_file', { path: output.value.outputPath })
}

async function revealOutput() {
  if (!output.value) return
  await invoke('media_reveal_file', { path: output.value.outputPath })
}

function sendTextToChat() {
  const text = transcriptText.value.trim()
  if (!text) return
  emitEvent('append-chat-input', text.slice(0, 12000))
  emitEvent('switch-panel', 'chat')
}
</script>

<template>
  <div class="mw">
    <div class="mw-head">
      <button class="mw-back" title="返回" @click="emit('back')">
        <span class="mso">arrow_back</span>
      </button>
      <div class="mw-title">
        <h3>音视频工坊</h3>
        <p>选择文件，直接得到本地结果。</p>
      </div>
    </div>

    <div class="mw-body">
      <div class="mw-modes" aria-label="音视频动作">
        <button
          v-for="item in modes"
          :key="item.value"
          class="mw-mode"
          :class="{ active: mode === item.value }"
          :disabled="Boolean(modeDisabledReason(item.value))"
          :title="modeDisabledReason(item.value) || item.label"
          @click="selectMode(item.value)"
        >
          <span class="mso">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </button>
      </div>

      <section class="mw-file">
        <button class="mw-pick" :disabled="status === 'running'" @click="selectMediaFile">
          <span class="mso">upload_file</span>
          <span>{{ file ? '更换文件' : '选择音频或视频' }}</span>
        </button>
        <div class="mw-file-text">
          <strong>{{ file?.filename || '尚未选择文件' }}</strong>
          <span>{{ file ? `${formatBytes(file.size)} · ${formatDuration(file.durationSeconds)}` : '支持常见音频和视频格式' }}</span>
        </div>
      </section>

      <section v-if="file" class="mw-info">
        <div v-for="[label, value] in summaryItems" :key="label" class="mw-info-item">
          <span>{{ label }}</span>
          <strong>{{ value }}</strong>
        </div>
      </section>

      <section class="mw-main">
        <div v-if="mode === 'info'" class="mw-action">
          <div class="mw-action-copy">
            <h4>查看信息</h4>
            <p>确认文件大小、时长、画面尺寸、音轨和字幕状态。</p>
          </div>
        </div>

        <div v-else-if="mode === 'text'" class="mw-action">
          <div class="mw-action-copy">
            <h4>转文字</h4>
            <p>把会议、采访、旁白或视频声音转成可复制文本。</p>
          </div>
          <div class="mw-controls">
            <label>
              <span>输出</span>
              <select v-model="textFormat">
                <option value="txt">TXT</option>
                <option value="srt">SRT</option>
                <option value="vtt">VTT</option>
              </select>
            </label>
            <label>
              <span>语言</span>
              <select v-model="textLanguage">
                <option value="auto">自动</option>
                <option value="zh">中文</option>
                <option value="en">英文</option>
                <option value="ja">日文</option>
              </select>
            </label>
            <label>
              <span>模式</span>
              <select v-model="textSpeed">
                <option value="fast">快速</option>
                <option value="clear">清晰</option>
              </select>
            </label>
          </div>
        </div>

        <div v-else-if="mode === 'convert'" class="mw-action">
          <div class="mw-action-copy">
            <h4>压缩转格式</h4>
            <p>压小视频、转成 MP4，或单独导出音频。</p>
          </div>
          <div class="mw-choice-grid">
            <button
              class="mw-choice"
              :class="{ active: convertAction === 'compress' }"
              :disabled="Boolean(choiceDisabledReason('compress'))"
              :title="choiceDisabledReason('compress') || '压缩视频'"
              @click="selectConvertAction('compress')"
            >
              <span class="mso">compress</span>
              <strong>压缩视频</strong>
              <small>生成更小的 MP4</small>
            </button>
            <button
              class="mw-choice"
              :class="{ active: convertAction === 'mp4' }"
              :disabled="Boolean(choiceDisabledReason('mp4'))"
              :title="choiceDisabledReason('mp4') || '转成 MP4'"
              @click="selectConvertAction('mp4')"
            >
              <span class="mso">movie</span>
              <strong>转成 MP4</strong>
              <small>便于播放和分享</small>
            </button>
            <button
              class="mw-choice"
              :class="{ active: convertAction === 'audio' }"
              :disabled="Boolean(choiceDisabledReason('audio'))"
              :title="choiceDisabledReason('audio') || '导出音频'"
              @click="selectConvertAction('audio')"
            >
              <span class="mso">graphic_eq</span>
              <strong>导出音频</strong>
              <small>生成 MP3 文件</small>
            </button>
          </div>
          <div v-if="convertAction === 'compress'" class="mw-segment">
            <button :class="{ active: convertQuality === 'small' }" @click="convertQuality = 'small'">更小</button>
            <button :class="{ active: convertQuality === 'balanced' }" @click="convertQuality = 'balanced'">均衡</button>
            <button :class="{ active: convertQuality === 'clean' }" @click="convertQuality = 'clean'">更清晰</button>
          </div>
        </div>

        <div v-else class="mw-action">
          <div class="mw-action-copy">
            <h4>视频上字幕</h4>
            <p>把 SRT 字幕合成到视频画面里，生成可直接播放的新视频。</p>
          </div>
          <div class="mw-segment">
            <button :class="{ active: captionSource === 'paste' }" @click="captionSource = 'paste'">粘贴字幕</button>
            <button :class="{ active: captionSource === 'file' }" @click="selectSubtitleFile">选择字幕</button>
            <button :disabled="!recentSrtText" :class="{ active: captionSource === 'recent' }" @click="captionSource = 'recent'">使用刚生成的字幕</button>
          </div>
          <textarea
            v-if="captionSource !== 'recent'"
            v-model="subtitleText"
            class="mw-subtitle"
            spellcheck="false"
            placeholder="粘贴 SRT 字幕，或点击“选择字幕”读取文件。"
          />
          <div v-else class="mw-recent">
            {{ recentSrtText ? '已选择刚生成的 SRT 字幕' : '还没有可用的 SRT 字幕' }}
          </div>
          <div v-if="subtitleFilename" class="mw-file-hint">{{ subtitleFilename }}</div>
        </div>
      </section>

      <section v-if="status === 'running'" class="mw-progress">
        <div class="mw-progress-line">
          <span :style="{ width: `${progress}%` }"></span>
        </div>
        <p>{{ progressText || '正在处理' }}</p>
      </section>

      <section v-if="errorMessage" class="mw-error">
        <span class="mso">error</span>
        <span>{{ errorMessage }}</span>
      </section>

      <section v-else-if="actionBlockedReason" class="mw-error muted">
        <span class="mso">info</span>
        <span>{{ actionBlockedReason }}</span>
      </section>

      <section v-if="output || transcriptText" class="mw-output">
        <div class="mw-output-main">
          <span class="mso">task_alt</span>
          <div>
            <strong>{{ output?.outputFilename || '文字结果' }}</strong>
            <span>{{ output ? formatBytes(output.outputSize) : '可复制使用' }}</span>
          </div>
        </div>
        <div class="mw-output-actions">
          <button v-if="output" @click="openOutput">
            <span class="mso">open_in_new</span>
            打开
          </button>
          <button v-if="output" @click="revealOutput">
            <span class="mso">folder_open</span>
            显示
          </button>
          <button v-if="transcriptText" @click="sendTextToChat">
            <span class="mso">chat</span>
            加入对话
          </button>
        </div>
      </section>

      <textarea
        v-if="transcriptText"
        class="mw-transcript"
        :value="transcriptText"
        readonly
        spellcheck="false"
      />
    </div>

    <div class="mw-foot">
      <button class="mw-primary" :disabled="!canRun" @click="runCurrentAction">
        {{ actionLabel }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.mw {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--surface);
  color: var(--ink1);
}

.mw-head {
  min-height: 64px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  gap: 12px;
  box-sizing: border-box;
}

.mw-back,
.mw-pick,
.mw-mode,
.mw-choice,
.mw-segment button,
.mw-output-actions button,
.mw-primary {
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--ink1);
  cursor: pointer;
  font: inherit;
}

.mw-back {
  width: 38px;
  height: 38px;
  border-radius: 8px;
  display: grid;
  place-items: center;
}

.mw-title h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
}

.mw-title p {
  margin: 3px 0 0;
  font-size: 12px;
  color: var(--ink3);
}

.mw-body {
  flex: 1;
  overflow: auto;
  padding: 14px 16px 88px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mw-modes {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.mw-mode {
  height: 40px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-weight: 700;
  font-size: 13px;
  white-space: nowrap;
}

.mw-mode.active,
.mw-choice.active,
.mw-segment button.active {
  border-color: color-mix(in srgb, var(--accent) 65%, var(--line));
  background: color-mix(in srgb, var(--accent) 16%, var(--panel));
  color: var(--accent-ink, var(--ink1));
}

.mw-file,
.mw-output,
.mw-progress,
.mw-error {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  box-sizing: border-box;
}

.mw-file {
  min-height: 72px;
  padding: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.mw-pick {
  height: 42px;
  padding: 0 14px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 750;
  white-space: nowrap;
}

.mw-file-text,
.mw-output-main div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mw-file-text strong,
.mw-output-main strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mw-file-text span,
.mw-output-main span {
  color: var(--ink3);
  font-size: 12px;
}

.mw-info {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.mw-info-item {
  min-height: 58px;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: color-mix(in srgb, var(--panel) 78%, var(--surface));
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
}

.mw-info-item span {
  color: var(--ink3);
  font-size: 12px;
}

.mw-info-item strong {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mw-main {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: color-mix(in srgb, var(--panel) 82%, var(--surface));
}

.mw-action {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.mw-action-copy h4 {
  margin: 0;
  font-size: 15px;
}

.mw-action-copy p {
  margin: 5px 0 0;
  color: var(--ink3);
  font-size: 13px;
  line-height: 1.5;
}

.mw-controls {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.mw-controls label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--ink3);
  font-size: 12px;
}

.mw-controls select {
  height: 36px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink1);
  padding: 0 10px;
}

.mw-choice-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.mw-choice {
  min-height: 86px;
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  text-align: left;
}

.mw-choice .mso {
  font-size: 22px;
}

.mw-choice strong {
  font-size: 13px;
}

.mw-choice small {
  color: var(--ink3);
  font-size: 12px;
}

.mw-segment {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.mw-segment button {
  min-height: 34px;
  border-radius: 8px;
  padding: 0 12px;
  font-weight: 700;
}

.mw-subtitle,
.mw-transcript {
  width: 100%;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink1);
  box-sizing: border-box;
  resize: vertical;
  font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.mw-subtitle {
  min-height: 132px;
  padding: 10px;
}

.mw-transcript {
  min-height: 160px;
  padding: 12px;
}

.mw-recent,
.mw-file-hint {
  color: var(--ink3);
  font-size: 12px;
}

.mw-progress {
  padding: 12px;
}

.mw-progress-line {
  height: 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--line) 65%, transparent);
  overflow: hidden;
}

.mw-progress-line span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width .2s ease;
}

.mw-progress p {
  margin: 8px 0 0;
  color: var(--ink3);
  font-size: 12px;
}

.mw-error {
  padding: 12px;
  color: #b9442c;
  display: flex;
  align-items: center;
  gap: 8px;
}

.mw-output {
  padding: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.mw-output-main {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.mw-output-main > .mso {
  color: var(--accent);
}

.mw-output-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.mw-output-actions button {
  min-height: 32px;
  border-radius: 8px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: 700;
}

.mw-foot {
  position: sticky;
  bottom: 0;
  padding: 12px 16px;
  border-top: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  backdrop-filter: blur(12px);
}

.mw-primary {
  width: 100%;
  height: 44px;
  border-radius: 8px;
  border-color: color-mix(in srgb, var(--accent) 70%, var(--line));
  background: var(--accent);
  color: var(--accent-ink, white);
  font-weight: 800;
}

button:disabled {
  opacity: .52;
  cursor: not-allowed;
}

@media (max-width: 760px) {
  .mw-modes,
  .mw-info,
  .mw-controls,
  .mw-choice-grid {
    grid-template-columns: 1fr 1fr;
  }

  .mw-output,
  .mw-file {
    align-items: stretch;
    flex-direction: column;
  }

  .mw-output-actions {
    justify-content: flex-start;
  }
}
</style>

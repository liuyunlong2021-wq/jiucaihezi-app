<script setup lang="ts">
/**
 * GalleryCard.vue — 单张画廊卡片
 * 支持图片/视频/音频/文本/失败卡片，所有业务动作由父组件处理。
 */
import { computed, ref, watch } from 'vue'
import { formatRelativeTime } from '@/utils/timeFormat'

const props = defineProps<{
  url: string
  type: string
  content?: string
  model?: string
  ts?: number
  index: number
  resultKey: string
  selectMode?: boolean
  selected?: boolean
  compactPreview?: boolean
  resolveStatus?: 'loading' | 'ready' | 'failed'
  resolveError?: string
}>()

const emit = defineEmits<{
  preview: [index: number]
  reference: [index: number]
  retry: [index: number]
  delete: [index: number]
  toggleSelect: [key: string]
  contextmenu: [index: number, event: MouseEvent]
}>()

const imgError = ref(false)
const videoRef = ref<HTMLVideoElement | null>(null)
const videoDuration = ref(0)
const audioRef = ref<HTMLAudioElement | null>(null)
const audioPlaying = ref(false)
const audioProgress = ref(0)
const audioDuration = ref(0)
const audioCurrentTime = ref(0)

const isImage = computed(() => props.type === 'image')
const isVideo = computed(() => props.type === 'video')
const isAudio = computed(() => props.type === 'audio')
const isText = computed(() => props.type === 'text')
const isFailed = computed(() => props.type === 'failed')
const isMedia = computed(() => isImage.value || isVideo.value || isAudio.value)
const infoTime = computed(() => props.ts ? formatRelativeTime(props.ts) : '')
const promptTitle = computed(() => (props.content || '音频作品').trim().slice(0, 42))

function onCardClick() {
  if (props.selectMode) emit('toggleSelect', props.resultKey)
  else emit('preview', props.index)
}

watch(() => props.url, () => {
  imgError.value = false
})

function onImgError() {
  imgError.value = true
}

function onVideoMeta() {
  if (videoRef.value && Number.isFinite(videoRef.value.duration)) {
    videoDuration.value = videoRef.value.duration
  }
}

function playVideoPreview() {
  if (props.compactPreview) return
  videoRef.value?.play().catch(() => {})
}

function pauseAndResetVideo() {
  if (!videoRef.value) return
  videoRef.value.pause()
  videoRef.value.currentTime = 0
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function toggleAudioPlay(e: Event) {
  e.stopPropagation()
  if (!audioRef.value) return
  if (audioPlaying.value) audioRef.value.pause()
  else audioRef.value.play().catch(() => {})
}

function onAudioLoaded() {
  if (audioRef.value && Number.isFinite(audioRef.value.duration)) {
    audioDuration.value = audioRef.value.duration
  }
}

function onAudioTimeUpdate() {
  if (!audioRef.value) return
  audioCurrentTime.value = audioRef.value.currentTime
  audioProgress.value = audioDuration.value > 0
    ? (audioRef.value.currentTime / audioDuration.value) * 100
    : 0
}

function seekAudio(e: MouseEvent) {
  e.stopPropagation()
  const bar = e.currentTarget as HTMLElement
  const ratio = e.offsetX / Math.max(bar.offsetWidth, 1)
  if (audioRef.value && audioDuration.value) {
    audioRef.value.currentTime = ratio * audioDuration.value
  }
}
</script>

<template>
  <div
    class="gc-card"
    :class="{ 'is-text': isText, 'select-mode': selectMode, selected }"
    @click="onCardClick"
    @contextmenu.prevent="emit('contextmenu', index, $event)"
  >
    <div class="gc-card-media">
      <img v-if="isImage && url && !imgError" :src="url" alt="" loading="lazy" decoding="async" @error="onImgError" />
      <div v-else-if="isImage && imgError" class="gc-card-broken">
        <span class="mso">broken_image</span>
        <span>图片已失效</span>
      </div>

      <video
        v-else-if="isVideo"
        ref="videoRef"
        :src="url"
        muted
        loop
        preload="metadata"
        @loadedmetadata="onVideoMeta"
        @mouseenter="playVideoPreview"
        @mouseleave="pauseAndResetVideo"
      />

      <div v-else-if="isAudio" class="gc-card-audio">
        <audio
          ref="audioRef"
          :src="url"
          preload="metadata"
          @loadedmetadata="onAudioLoaded"
          @timeupdate="onAudioTimeUpdate"
          @play="audioPlaying = true"
          @pause="audioPlaying = false"
          @ended="audioPlaying = false"
        />
        <div class="gc-audio-visual">
          <span class="mso">graphic_eq</span>
          <span class="gc-audio-title">{{ promptTitle }}</span>
        </div>
        <div class="gc-audio-controls" @click.stop>
          <button class="gc-audio-play-btn" @click="toggleAudioPlay" :title="audioPlaying ? '暂停' : '播放'">
            <span class="mso">{{ audioPlaying ? 'pause' : 'play_arrow' }}</span>
          </button>
          <div class="gc-audio-progress" @click="seekAudio">
            <div class="gc-audio-progress-fill" :style="{ width: audioProgress + '%' }" />
          </div>
          <span class="gc-audio-time">{{ formatDuration(audioCurrentTime) }}/{{ formatDuration(audioDuration) }}</span>
        </div>
      </div>

      <div v-else-if="isMedia && resolveStatus === 'failed'" class="gc-card-broken">
        <span class="mso">broken_image</span>
        <span>{{ resolveError || '媒体无法显示' }}</span>
      </div>
      <div v-else-if="isMedia && (resolveStatus === 'loading' || !url)" class="gc-card-loading">
        <span class="mso">hourglass_empty</span>
        <span>正在载入媒体</span>
      </div>

      <div v-else-if="isText" class="gc-card-text">{{ content || '无返回内容' }}</div>
      <div v-else-if="isFailed" class="gc-card-failed">
        <span class="mso">error</span>
        <strong>生成失败</strong>
        <span>{{ content || '请稍后重试' }}</span>
      </div>

      <div v-if="selectMode" class="gc-select-check">
        <span v-if="selected" class="mso">check</span>
      </div>
      <div v-else-if="isFailed" class="gc-card-tag failed">
        <span class="mso">error</span>失败
      </div>
      <div v-if="isVideo" class="gc-card-type-badge">
        <span class="mso">videocam</span>
        <span v-if="videoDuration">{{ formatDuration(videoDuration) }}</span>
      </div>
      <div v-if="isAudio" class="gc-card-type-badge">
        <span class="mso">music_note</span>
        <span v-if="audioDuration">{{ formatDuration(audioDuration) }}</span>
      </div>
      <div v-if="isVideo" class="gc-card-play">
        <span class="mso">play_circle</span>
      </div>

      <div class="gc-card-actions">
        <button class="gc-act" @click.stop="emit('preview', index)" title="查看">
          <span class="mso">visibility</span>
        </button>
        <button v-if="!isText && !isFailed" class="gc-act" @click.stop="emit('reference', index)" title="引用到输入框">
          <span class="mso">arrow_downward</span>
        </button>
        <button v-if="isFailed" class="gc-act retry" @click.stop="emit('retry', index)" title="重试">
          <span class="mso">refresh</span>
        </button>
        <button class="gc-act danger" @click.stop="emit('delete', index)" title="删除">
          <span class="mso">delete</span>
        </button>
      </div>
    </div>

    <div class="gc-card-info">
      <span class="gc-card-model" :title="model">{{ model || 'unknown' }}</span>
      <span class="gc-card-time">{{ infoTime }}</span>
    </div>
  </div>
</template>

<style scoped>
.gc-card {
  border-radius: 12px;
  overflow: hidden;
  position: relative;
  cursor: pointer;
  border: 1px solid var(--line);
  background: var(--paper);
  box-shadow: 0 2px 8px var(--jc-shadow-color, rgba(0,0,0,.08));
  transition: transform .2s, box-shadow .2s;
}
.gc-card:hover { transform: translateY(-2px); box-shadow: var(--jc-shadow-sm, 0 8px 24px rgba(0,0,0,.14)); }
.gc-card.select-mode { cursor: default; }
.gc-card.selected { outline: 2px solid var(--olive); outline-offset: -2px; }
.gc-card-media {
  position: relative;
  overflow: hidden;
  aspect-ratio: 1;
  background: var(--surface-alt);
}
.gc-card img, .gc-card video {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  background: var(--surface-alt);
}
.gc-card-broken {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--ink3);
  font-size: 11px;
  background: var(--surface-alt);
}
.gc-card-broken .mso { font-size: 28px; opacity: .5; }
.gc-card-loading {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--ink3);
  font-size: 11px;
  background: var(--surface-alt);
}
.gc-card-loading .mso { font-size: 28px; opacity: .55; }
.gc-card-audio {
  height: 100%;
  min-height: 150px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background:
    radial-gradient(circle at 20% 18%, rgba(107,142,35,.22), transparent 35%),
    linear-gradient(135deg, rgba(244,247,238,.96), var(--surface-alt));
}
.gc-audio-visual {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 92px;
  padding: 18px 14px 10px;
  text-align: center;
}
.gc-audio-visual .mso { font-size: 34px; color: var(--olive); }
.gc-audio-title {
  max-width: 100%;
  color: var(--ink2);
  font-size: 11px;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}
.gc-audio-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px 12px;
}
.gc-audio-play-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: var(--olive);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.gc-audio-play-btn .mso { font-size: 16px; }
.gc-audio-progress {
  flex: 1;
  height: 4px;
  background: rgba(107,142,35,.15);
  border-radius: 2px;
  cursor: pointer;
  position: relative;
}
.gc-audio-progress-fill {
  height: 100%;
  background: var(--olive);
  border-radius: 2px;
  transition: width .1s linear;
}
.gc-audio-time {
  font-size: 10px;
  color: var(--ink3);
  flex-shrink: 0;
  min-width: 62px;
  text-align: right;
}
.gc-card-text {
  height: 100%;
  box-sizing: border-box;
  font-size: 11px;
  line-height: 1.6;
  color: var(--ink2);
  padding: 10px;
  white-space: pre-wrap;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 7;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.gc-card-failed {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 14px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 7px;
  background: rgba(198, 40, 40, .08);
  color: #c62828;
  font-size: 11px;
  line-height: 1.45;
}
.gc-card-failed .mso { font-size: 26px; }
.gc-card-failed strong { font-size: 13px; }
.gc-card-failed span:last-child {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}
.gc-card-play {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,.14);
  pointer-events: none;
  transition: opacity .15s;
}
.gc-card:hover .gc-card-play { opacity: .3; }
.gc-card-play .mso { font-size: 32px; color: #fff; text-shadow: 0 2px 12px rgba(0,0,0,.5); }
.gc-card-tag,
.gc-card-type-badge,
.gc-select-check {
  position: absolute;
  top: 7px;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.gc-card-tag {
  left: 7px;
  gap: 3px;
  padding: 3px 7px;
  border-radius: 999px;
  background: rgba(0,0,0,.46);
  backdrop-filter: blur(6px);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
}
.gc-card-tag.failed { background: rgba(198,40,40,.86); }
.gc-card-tag .mso { font-size: 12px; }
.gc-card-type-badge {
  right: 7px;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(0,0,0,.5);
  backdrop-filter: blur(6px);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
}
.gc-card-type-badge .mso { font-size: 12px; }
.gc-select-check {
  left: 7px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,.75);
  background: rgba(0,0,0,.3);
  color: #fff;
}
.gc-card.selected .gc-select-check {
  background: var(--olive);
  border-color: var(--olive);
}
.gc-select-check .mso { font-size: 13px; }
.gc-card-actions {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  gap: 6px;
  justify-content: center;
  padding: 8px;
  background: linear-gradient(transparent, rgba(0,0,0,.55));
  opacity: 0;
  transition: opacity .18s;
  pointer-events: none;
}
.gc-card:hover .gc-card-actions { opacity: 1; pointer-events: auto; }
.gc-act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,.18);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,.25);
  color: #fff;
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 50%;
  cursor: pointer;
  font-family: inherit;
  transition: background .15s, transform .12s;
}
.gc-act:hover { background: rgba(255,255,255,.36); transform: scale(1.1); }
.gc-act.retry { background: rgba(107,142,35,.78); }
.gc-act.danger { background: rgba(210,61,61,.72); border-color: rgba(255,255,255,.22); }
.gc-act.danger:hover { background: rgba(190,42,42,.94); transform: scale(1.1); }
.gc-act .mso { font-size: 16px; }
.gc-card-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  font-size: 10px;
  color: var(--ink3);
  border-top: 1px solid var(--line);
  min-height: 26px;
  box-sizing: border-box;
}
.gc-card-model {
  font-weight: 600;
  color: var(--ink2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 65%;
}
.gc-card-time {
  flex-shrink: 0;
  white-space: nowrap;
}
</style>

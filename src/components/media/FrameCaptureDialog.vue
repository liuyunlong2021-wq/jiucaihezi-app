<script setup lang="ts">
/**
 * FrameCaptureDialog — 视频截帧弹窗：精调时间轴 → 截一帧 → 交给宿主。
 * 宿主负责落地（创作面板与记忆工作台都指向「加入参考图第一位」）。
 */
import { computed, ref, watch } from 'vue'
import { resolveJcMediaUrl } from '@/utils/mediaFileReader'
import { captureVideoFrame, videoCrossOriginFor } from '@/utils/videoFrame'

const props = defineProps<{
  show: boolean
  url: string
  title?: string
}>()

const emit = defineEmits<{
  close: []
  captured: [file: File, seconds: number]
}>()

const videoEl = ref<HTMLVideoElement | null>(null)
const resolvedSrc = ref('')
const duration = ref(0)
const currentTime = ref(0)
const error = ref('')
const capturing = ref(false)

const crossOrigin = computed(() => videoCrossOriginFor(resolvedSrc.value))

watch(
  () => [props.show, props.url] as const,
  async ([show, url]) => {
    if (!show || !url) return
    error.value = ''
    capturing.value = false
    currentTime.value = 0
    duration.value = 0
    resolvedSrc.value = await resolveJcMediaUrl(url)
  },
  { immediate: true },
)

function onLoadedMetadata() {
  duration.value = videoEl.value?.duration || 0
  videoEl.value?.pause()
}

function onTimeUpdate() {
  currentTime.value = videoEl.value?.currentTime || 0
}

function togglePlay() {
  const video = videoEl.value
  if (!video) return
  if (video.paused) void video.play()
  else video.pause()
}

function seekTo(seconds: number) {
  const video = videoEl.value
  if (!video) return
  video.pause()
  video.currentTime = Math.max(0, Math.min(seconds, duration.value || seconds))
  currentTime.value = video.currentTime
}

function step(delta: number) {
  seekTo((videoEl.value?.currentTime || 0) + delta)
}

function formatTime(seconds: number): string {
  const value = Math.max(0, seconds)
  const minutes = Math.floor(value / 60)
  return `${minutes}:${(value - minutes * 60).toFixed(1).padStart(4, '0')}`
}

async function captureFrame() {
  const video = videoEl.value
  if (!video || capturing.value || !resolvedSrc.value) return
  capturing.value = true
  error.value = ''
  try {
    video.pause()
    const blob = await captureVideoFrame(video)
    const seconds = Math.max(0, Math.round(video.currentTime || 0))
    const base = (props.title || '视频').replace(/\.[^.]+$/, '') || '视频'
    emit('captured', new File([blob], `截帧_${base}_${seconds}s.png`, { type: 'image/png' }), seconds)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    capturing.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="fcd-overlay" @click.self="emit('close')">
      <section class="fcd-card">
        <header class="fcd-head">
          <JcIcon name="photo_camera" />
          <strong>截帧 · 取一帧当参考图</strong>
          <span v-if="title" class="fcd-title" :title="title">{{ title }}</span>
          <button class="fcd-close" type="button" title="关闭" @click="emit('close')"><JcIcon name="close" /></button>
        </header>
        <div class="fcd-stage">
          <video
            v-if="resolvedSrc"
            ref="videoEl"
            :key="resolvedSrc"
            :src="resolvedSrc"
            :crossorigin="crossOrigin"
            class="fcd-video"
            @loadedmetadata="onLoadedMetadata"
            @timeupdate="onTimeUpdate"
            @click="togglePlay"
          />
        </div>
        <div class="fcd-controls">
          <input
            class="fcd-range"
            type="range"
            min="0"
            :max="duration || 0"
            step="0.05"
            :value="currentTime"
            @input="seekTo(Number(($event.target as HTMLInputElement).value))"
          />
          <div class="fcd-row">
            <button class="fcd-step" type="button" @click="step(-0.1)"><JcIcon name="chevron_left" />0.1s</button>
            <button class="fcd-step" type="button" @click="step(0.1)">0.1s<JcIcon name="chevron_right" /></button>
            <span class="fcd-time">{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</span>
            <button class="fcd-primary" type="button" :disabled="capturing || !resolvedSrc" @click="captureFrame">
              <JcIcon name="photo_camera" />{{ capturing ? '截取中…' : '截此帧 → 存入图片并加入画布' }}
            </button>
          </div>
          <p class="fcd-hint">拖到你想要的那一帧再截。截完会保存到项目「图片」目录，并放到画布；之后可在画布中选中它作为参考图。</p>
          <p v-if="error" class="fcd-error">{{ error }}</p>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.fcd-overlay { position: fixed; inset: 0; z-index: 10050; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, .6); backdrop-filter: blur(4px); }
.fcd-card { display: flex; width: min(880px, 92vw); max-height: 92vh; flex-direction: column; overflow: hidden; border-radius: 14px; background: #fff; box-shadow: 0 24px 64px rgba(0, 0, 0, .35); }
.fcd-head { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--line, #e5e5e5); }
.fcd-head strong { color: var(--ink, #111); font-size: calc(var(--font-base, 14px) + 1px); }
.fcd-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink3, #999); font-size: calc(var(--font-base, 14px) - 2px); }
.fcd-close { display: grid; width: 28px; height: 28px; flex: 0 0 28px; margin-left: auto; place-items: center; border: 0; border-radius: 8px; background: transparent; color: var(--ink3, #999); cursor: pointer; }
.fcd-close:hover { background: rgba(0, 0, 0, .06); }
.fcd-stage { display: flex; min-height: 240px; flex: 1; align-items: center; justify-content: center; background: #0c0c0c; }
.fcd-video { max-width: 100%; max-height: 56vh; cursor: pointer; }
.fcd-controls { padding: 12px 16px 14px; }
.fcd-range { width: 100%; margin: 0 0 10px; accent-color: var(--olive, #6b7f3a); }
.fcd-row { display: flex; align-items: center; gap: 10px; }
.fcd-step { display: inline-flex; align-items: center; gap: 2px; padding: 5px 8px; border: 1px solid var(--line, #ddd); border-radius: 8px; background: #fff; color: var(--ink2, #444); font-size: calc(var(--font-base, 14px) - 2px); cursor: pointer; }
.fcd-step:hover { background: rgba(0, 0, 0, .04); }
.fcd-time { color: var(--ink2, #444); font-size: calc(var(--font-base, 14px) - 1px); font-variant-numeric: tabular-nums; }
.fcd-primary { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; padding: 8px 16px; border: 0; border-radius: 10px; background: var(--olive, #6b7f3a); color: #fff; font-size: calc(var(--font-base, 14px) - 1px); cursor: pointer; }
.fcd-primary:disabled { opacity: .5; cursor: default; }
.fcd-hint { margin: 10px 0 0; color: var(--ink3, #999); font-size: calc(var(--font-base, 14px) - 2px); line-height: 1.5; }
.fcd-error { margin: 8px 0 0; color: #c0392b; font-size: calc(var(--font-base, 14px) - 2px); }
</style>

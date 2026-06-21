<script setup lang="ts">
/**
 * MediaViewer — 统一媒体查看器
 * 支持图片/视频/音频/文本/失败状态，后续可被创作面板、画布和聊天媒体复用。
 */
import { computed, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue'
import { formatRelativeTime } from '@/utils/timeFormat'
import { resolveJcMediaUrl } from '@/utils/mediaFileReader'

const props = defineProps<{
  show: boolean
  url: string
  type: string
  content?: string
  model?: string
  ts?: number
  currentIndex?: number
  totalCount?: number
  status?: 'loading' | 'ready' | 'failed'
  errorMsg?: string
  sourceUrl?: string
}>()

const emit = defineEmits<{
  close: []
  download: []
  reference: []
  regenerate: []
  sendToCanvas: []
  copyUrl: []
  prev: []
  next: []
}>()

const infoTime = computed(() => props.ts ? formatRelativeTime(props.ts) : '')
const canNavigate = computed(() => (props.totalCount || 0) > 1)
const isMedia = computed(() => props.type === 'image' || props.type === 'video' || props.type === 'audio' || props.type === 'text')
const currentNumber = computed(() => Math.max((props.currentIndex ?? 0) + 1, 1))
const totalNumber = computed(() => Math.max(props.totalCount || 1, 1))
const urlLabel = computed(() => {
  const raw = String(props.sourceUrl || '').trim()
  if (raw && !raw.startsWith('jc-media://')) {
    try { const parsed = new URL(raw); return `${parsed.host}${parsed.pathname}` } catch { return raw }
  }
  const u = String(props.url || '').trim()
  if (u && !u.startsWith('jc-media://')) {
    try { const parsed = new URL(u); return `${parsed.host}${parsed.pathname}` } catch { return u }
  }
  return ''
})

// P1: jc-media:// → convertFileSrc 懒解析
const resolvedSrc = ref('')
let resolveId = 0
watchEffect(() => {
  const rid = ++resolveId
  resolveJcMediaUrl(props.url).then(u => { if (rid === resolveId) resolvedSrc.value = u })
})

function onKeydown(e: KeyboardEvent) {
  if (!props.show) return
  if (e.key === 'Escape') {
    emit('close')
    e.preventDefault()
  } else if (e.key === 'ArrowLeft') {
    emit('prev')
    e.preventDefault()
  } else if (e.key === 'ArrowRight') {
    emit('next')
    e.preventDefault()
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="mv-overlay" @click.self="emit('close')">
      <button class="mv-close" @click="emit('close')" title="关闭">
        <JcIcon name="close" />
      </button>

      <button v-if="canNavigate" class="mv-nav prev" @click="emit('prev')" title="上一个">
        <JcIcon name="chevron_left" />
      </button>
      <button v-if="canNavigate" class="mv-nav next" @click="emit('next')" title="下一个">
        <JcIcon name="chevron_right" />
      </button>

      <div v-if="status === 'loading' || (!resolvedSrc && isMedia && type !== 'text')" class="mv-state">
        <JcIcon name="hourglass_empty" />
        <strong>{{ status === 'loading' ? '正在载入媒体' : '正在解析媒体' }}</strong>
      </div>
      <div v-else-if="status === 'failed'" class="mv-state failed">
        <JcIcon name="broken_image" />
        <strong>{{ errorMsg || '媒体无法显示' }}</strong>
      </div>
      <img v-else-if="type === 'image' && resolvedSrc" :src="resolvedSrc" class="mv-media" />
      <video v-else-if="type === 'video' && resolvedSrc" :src="resolvedSrc" controls autoplay class="mv-media" />
      <audio v-else-if="type === 'audio' && resolvedSrc" :src="resolvedSrc" controls autoplay class="mv-media mv-audio" />
      <pre v-else-if="type === 'text'" class="mv-media mv-text">{{ content || '无返回内容' }}</pre>
      <pre v-else-if="type === 'failed'" class="mv-media mv-text mv-failed">{{ errorMsg || content || '生成失败' }}</pre>

      <div class="mv-info-bar">
        <span class="mv-info-model">{{ model || 'unknown' }}</span>
        <span v-if="infoTime" class="mv-info-time">{{ infoTime }}</span>
        <span class="mv-info-content" v-if="content">{{ content }}</span>
        <span v-if="urlLabel" class="mv-info-url" :title="sourceUrl || url">{{ urlLabel }}</span>
        <span class="mv-info-index">{{ currentNumber }} / {{ totalNumber }}</span>
      </div>

      <div class="mv-actions">
        <button v-if="isMedia && urlLabel" class="mv-btn ghost" @click="emit('copyUrl')" title="复制URL">
          <JcIcon name="link" />
        </button>
        <button v-if="isMedia" class="mv-btn ghost" @click="emit('reference')" title="设为参考">
          <JcIcon name="arrow_downward" />
        </button>
        <button v-if="isMedia" class="mv-btn ghost" @click="emit('regenerate')" title="重新生成">
          <JcIcon name="restart_alt" />
        </button>
        <button v-if="isMedia" class="mv-btn ghost" @click="emit('sendToCanvas')" title="发送到画布">
          <JcIcon name="account_tree" />
        </button>
        <button v-if="isMedia" class="mv-btn primary" @click="emit('download')" title="下载">
          <JcIcon name="download" />
        </button>
        <button class="mv-btn ghost" @click="emit('close')" title="关闭">
          <JcIcon name="close" />
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mv-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0,0,0,.82);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 12px;
  animation: mv-fade .2s ease;
}
@keyframes mv-fade { from { opacity: 0; } to { opacity: 1; } }
.mv-close {
  position: absolute;
  top: 16px;
  right: 16px;
  background: rgba(255,255,255,.12);
  border: none;
  color: #fff;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background .15s;
  z-index: 2;
}
.mv-close:hover { background: rgba(255,255,255,.25); }
.mv-close .mso { font-size: 20px; }
.mv-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 46px;
  height: 78px;
  border: 1px solid rgba(255,255,255,.2);
  border-radius: 999px;
  background: rgba(255,255,255,.1);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background .15s, transform .15s;
}
.mv-nav.prev { left: 22px; }
.mv-nav.next { right: 22px; }
.mv-nav:hover { background: rgba(255,255,255,.2); transform: translateY(-50%) scale(1.04); }
.mv-nav .mso { font-size: 30px; }
.mv-media {
  max-width: 88vw;
  max-height: 70vh;
  border-radius: 12px;
  box-shadow: 0 8px 48px rgba(0,0,0,.6);
  display: block;
}
.mv-audio {
  width: min(680px, 88vw);
  max-height: none;
  padding: 18px;
  border-radius: 14px;
  background: rgba(255,255,255,.12);
}
.mv-text,
.mv-state {
  max-width: min(88vw, 760px);
  max-height: 70vh;
  overflow: auto;
  padding: 18px;
  border-radius: 12px;
  background: var(--paper);
  color: var(--ink);
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}
.mv-state {
  min-width: min(420px, 88vw);
  min-height: 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
}
.mv-state .mso { font-size: 36px; color: var(--ink3); }
.mv-state.failed { color: #c62828; }
.mv-failed { color: #c62828; }
.mv-info-bar {
  width: min(760px, 88vw);
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 12px;
  border-radius: 10px;
  box-sizing: border-box;
  background: rgba(255,255,255,.11);
  border: 1px solid rgba(255,255,255,.16);
  color: rgba(255,255,255,.82);
  font-size: 12px;
}
.mv-info-model {
  font-weight: 700;
  color: #fff;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mv-info-time,
.mv-info-index {
  flex-shrink: 0;
  color: rgba(255,255,255,.68);
}
.mv-info-content {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mv-info-url {
  flex: 1;
  min-width: 90px;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(255,255,255,.72);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.mv-info-index { margin-left: auto; }
.mv-actions { display: flex; gap: 12px; }
.mv-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
  transition: all .15s;
}
.mv-btn .mso { font-size: 18px; }
.mv-btn.primary { background: var(--olive); color: #fff; }
.mv-btn.primary:hover { background: var(--olive-dark); transform: scale(1.08); }
.mv-btn.ghost {
  background: rgba(255,255,255,.12);
  color: #fff;
  border: 1px solid rgba(255,255,255,.25);
}
.mv-btn.ghost:hover { background: rgba(255,255,255,.22); transform: scale(1.08); }
@media (max-width: 640px) {
  .mv-nav {
    width: 38px;
    height: 58px;
  }
  .mv-nav.prev { left: 8px; }
  .mv-nav.next { right: 8px; }
  .mv-info-bar { width: calc(100vw - 24px); }
}
</style>

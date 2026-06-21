<script setup lang="ts">
/**
 * GalleryLightbox.vue — 全屏灯箱预览
 * 支持图片/视频/音频/文本，ESC 关闭，左右键切换。
 */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { formatRelativeTime } from '@/utils/timeFormat'

const props = defineProps<{
  show: boolean
  url: string
  type: string
  content?: string
  model?: string
  ts?: number
  currentIndex: number
  totalCount: number
}>()

const emit = defineEmits<{
  close: []
  download: []
  prev: []
  next: []
}>()

const infoTime = computed(() => props.ts ? formatRelativeTime(props.ts) : '')
const canNavigate = computed(() => props.totalCount > 1)

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
    <div v-if="show" class="lb-overlay" @click.self="emit('close')">
      <button class="lb-close" @click="emit('close')" title="关闭">
        <JcIcon name="close" />
      </button>

      <button v-if="canNavigate" class="lb-nav prev" @click="emit('prev')" title="上一个">
        <JcIcon name="chevron_left" />
      </button>
      <button v-if="canNavigate" class="lb-nav next" @click="emit('next')" title="下一个">
        <JcIcon name="chevron_right" />
      </button>

      <img v-if="type === 'image'" :src="url" class="lb-media" />
      <video v-else-if="type === 'video'" :src="url" controls autoplay class="lb-media" />
      <audio v-else-if="type === 'audio'" :src="url" controls autoplay class="lb-media lb-audio" />
      <pre v-else-if="type === 'text'" class="lb-media lb-text">{{ content || '无返回内容' }}</pre>
      <pre v-else-if="type === 'failed'" class="lb-media lb-text lb-failed">{{ content || '生成失败' }}</pre>

      <div class="lb-info-bar">
        <span class="lb-info-model">{{ model || 'unknown' }}</span>
        <span v-if="infoTime" class="lb-info-time">{{ infoTime }}</span>
        <span class="lb-info-content" v-if="content">{{ content }}</span>
        <span class="lb-info-index">{{ currentIndex + 1 }} / {{ totalCount }}</span>
      </div>

      <div class="lb-actions">
        <button v-if="type !== 'text' && type !== 'failed'" class="lb-btn primary" @click="emit('download')" title="保存到本地">
          <JcIcon name="download" />
        </button>
        <button class="lb-btn ghost" @click="emit('close')" title="关闭">
          <JcIcon name="close" />
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.lb-overlay {
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
  animation: lb-fade .2s ease;
}
@keyframes lb-fade { from { opacity: 0; } to { opacity: 1; } }
.lb-close {
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
.lb-close:hover { background: rgba(255,255,255,.25); }
.lb-close .mso { font-size: 20px; }
.lb-nav {
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
.lb-nav.prev { left: 22px; }
.lb-nav.next { right: 22px; }
.lb-nav:hover { background: rgba(255,255,255,.2); transform: translateY(-50%) scale(1.04); }
.lb-nav .mso { font-size: 30px; }
.lb-media {
  max-width: 88vw;
  max-height: 70vh;
  border-radius: 12px;
  box-shadow: 0 8px 48px rgba(0,0,0,.6);
  display: block;
}
.lb-audio {
  width: min(680px, 88vw);
  max-height: none;
  padding: 18px;
  border-radius: 14px;
  background: rgba(255,255,255,.12);
}
.lb-text {
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
.lb-failed { color: #c62828; }
.lb-info-bar {
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
.lb-info-model {
  font-weight: 700;
  color: #fff;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lb-info-time,
.lb-info-index {
  flex-shrink: 0;
  color: rgba(255,255,255,.68);
}
.lb-info-content {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lb-info-index { margin-left: auto; }
.lb-actions { display: flex; gap: 12px; }
.lb-btn {
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
.lb-btn .mso { font-size: 18px; }
.lb-btn.primary { background: var(--olive); color: #fff; }
.lb-btn.primary:hover { background: var(--olive-dark); transform: scale(1.08); }
.lb-btn.ghost {
  background: rgba(255,255,255,.12);
  color: #fff;
  border: 1px solid rgba(255,255,255,.25);
}
.lb-btn.ghost:hover { background: rgba(255,255,255,.22); transform: scale(1.08); }
@media (max-width: 640px) {
  .lb-nav {
    width: 38px;
    height: 58px;
  }
  .lb-nav.prev { left: 8px; }
  .lb-nav.next { right: 8px; }
  .lb-info-bar { width: calc(100vw - 24px); }
}
</style>

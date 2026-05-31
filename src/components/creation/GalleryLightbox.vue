<script setup lang="ts">
/**
 * GalleryLightbox.vue — 全屏灯箱预览
 * 支持图片/视频/音频/文本，ESC 关闭
 * 纯 UI 组件，不碰业务逻辑
 */
import { watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps<{
  show: boolean
  url: string
  type: string
  content?: string
}>()

const emit = defineEmits<{
  close: []
  download: []
}>()

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.show) {
    emit('close')
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
        <span class="mso">close</span>
      </button>

      <!-- 图片 -->
      <img v-if="type === 'image'" :src="url" class="lb-media" />
      <!-- 视频 -->
      <video v-else-if="type === 'video'" :src="url" controls autoplay class="lb-media" />
      <!-- 音频 -->
      <audio v-else-if="type === 'audio'" :src="url" controls autoplay class="lb-media lb-audio" />
      <!-- 文本 -->
      <pre v-else-if="type === 'text'" class="lb-media lb-text">{{ content || '无返回内容' }}</pre>
      <pre v-else-if="type === 'failed'" class="lb-media lb-text lb-failed">{{ content || '生成失败' }}</pre>

      <div class="lb-actions">
        <button v-if="type !== 'text' && type !== 'failed'" class="lb-btn primary" @click="emit('download')" title="保存到本地">
          <span class="mso" style="font-size:18px">download</span>
        </button>
        <button class="lb-btn ghost" @click="emit('close')" title="关闭">
          <span class="mso" style="font-size:18px">close</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.lb-overlay {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(0,0,0,.82); backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  flex-direction: column; gap: 12px;
  animation: lb-fade .2s ease;
}
@keyframes lb-fade { from { opacity: 0; } to { opacity: 1; } }

.lb-close {
  position: absolute; top: 16px; right: 16px;
  background: rgba(255,255,255,.12); border: none; color: #fff;
  width: 36px; height: 36px; border-radius: 50%; font-size: 20px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: background .15s;
}
.lb-close:hover { background: rgba(255,255,255,.25); }

.lb-media {
  max-width: 88vw; max-height: 72vh; border-radius: 12px;
  box-shadow: 0 8px 48px rgba(0,0,0,.6); display: block;
}
.lb-audio {
  width: min(680px, 88vw); max-height: none; padding: 18px;
  border-radius: 14px; background: rgba(255,255,255,.12);
}
.lb-text {
  max-width: min(88vw, 760px); max-height: 72vh; overflow: auto;
  padding: 18px; border-radius: 12px; background: var(--paper);
  color: var(--ink); font-size: 13px; line-height: 1.7;
  white-space: pre-wrap; word-break: break-word;
}
.lb-failed { color: #c62828; }

.lb-actions { display: flex; gap: 12px; }
.lb-btn {
  width: 44px; height: 44px; border-radius: 50%; border: none;
  font-size: 13px; font-weight: 600; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-family: inherit; transition: all .15s;
}
.lb-btn.primary { background: var(--olive); color: #fff; }
.lb-btn.primary:hover { background: var(--olive-dark); transform: scale(1.08); }
.lb-btn.ghost {
  background: rgba(255,255,255,.12); color: #fff;
  border: 1px solid rgba(255,255,255,.25);
}
.lb-btn.ghost:hover { background: rgba(255,255,255,.22); transform: scale(1.08); }
</style>

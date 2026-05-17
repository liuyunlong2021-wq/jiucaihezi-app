<script setup lang="ts">
/**
 * GalleryCard.vue — 单张画廊卡片
 * 支持: 图片/视频/音频/文本 四种类型
 * 悬浮操作栏: 查看 / 下载 / 删除
 * 纯 UI，不碰生产逻辑
 */
import { computed, ref } from 'vue'

const props = defineProps<{
  url: string
  type: string         // image | video | audio | text
  content?: string     // 文本类型内容
  index: number
}>()

const imgError = ref(false)
function onImgError() { imgError.value = true }

const emit = defineEmits<{
  preview: [index: number]
  reference: [index: number]
  delete: [index: number]
}>()

const isImage = computed(() => props.type === 'image')
const isVideo = computed(() => props.type === 'video')
const isAudio = computed(() => props.type === 'audio')
const isText = computed(() => props.type === 'text')
</script>

<template>
  <div class="gc-card" :class="{ 'is-text': isText }" @click="emit('preview', index)">
    <!-- 图片 -->
    <img v-if="isImage && !imgError" :src="url" alt="" loading="lazy" decoding="async" @error="onImgError" />
    <div v-else-if="isImage && imgError" class="gc-card-broken">
      <span class="mso">broken_image</span>
      <span>图片已失效</span>
    </div>
    <!-- 视频 -->
    <video v-else-if="isVideo" :src="url" muted preload="metadata" />
    <!-- 音频 -->
    <div v-else-if="isAudio" class="gc-card-audio">
      <span class="mso">graphic_eq</span>
      <audio :src="url" controls preload="metadata" @click.stop />
    </div>
    <!-- 文本 -->
    <div v-else-if="isText" class="gc-card-text">{{ content || '无返回内容' }}</div>

    <!-- 视频播放图标 -->
    <div v-if="isVideo" class="gc-card-play">
      <span class="mso">play_circle</span>
    </div>

    <!-- 已生成标记 -->
    <div class="gc-card-tag"><span class="mso">check_circle</span>已生成</div>

    <!-- 悬浮操作栏 — 纯图标 -->
    <div class="gc-card-actions">
      <button class="gc-act" @click.stop="emit('preview', index)" title="查看">
        <span class="mso">visibility</span>
      </button>
      <button v-if="!isText" class="gc-act" @click.stop="emit('reference', index)" title="引用到输入框">
        <span class="mso">arrow_downward</span>
      </button>
      <button class="gc-act danger" @click.stop="emit('delete', index)" title="删除">
        <span class="mso">delete</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.gc-card {
  aspect-ratio: 1; border-radius: 12px; overflow: hidden;
  position: relative; cursor: pointer; border: 1px solid var(--line);
  background: var(--surface-alt);
  transition: transform .2s, box-shadow .2s;
}
.gc-card:hover { transform: translateY(-2px); box-shadow: 0 6px 24px rgba(0,0,0,.12); }
.gc-card img, .gc-card video {
  width: 100%; height: 100%; display: block; object-fit: cover; background: var(--surface-alt);
}
.gc-card-broken {
  width: 100%; height: 100%; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 6px;
  color: var(--ink3); font-size: 11px;
  background: var(--surface-alt);
}
.gc-card-broken .mso { font-size: 28px; opacity: .5; }

/* 音频卡 */
.gc-card-audio {
  min-height: 136px; padding: 18px 12px 14px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  background: linear-gradient(135deg, rgba(107,142,35,.1), var(--surface-alt));
}
.gc-card-audio .mso { font-size: 30px; color: var(--olive); }
.gc-card-audio audio { width: 100%; height: 34px; }

/* 文本卡 */
.gc-card-text {
  font-size: 11px; line-height: 1.6; color: var(--ink2); padding: 10px;
  white-space: pre-wrap; word-break: break-word;
  display: -webkit-box; -webkit-line-clamp: 7; -webkit-box-orient: vertical; overflow: hidden;
}

/* 播放按钮 */
.gc-card-play {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,.14);
}
.gc-card-play .mso { font-size: 32px; color: #fff; text-shadow: 0 2px 12px rgba(0,0,0,.5); }

/* 已生成标记 */
.gc-card-tag {
  position: absolute; left: 7px; top: 7px;
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 7px; border-radius: 999px;
  background: rgba(0,0,0,.46); backdrop-filter: blur(6px);
  color: #fff; font-size: 10px; font-weight: 700; z-index: 2;
}
.gc-card-tag .mso { font-size: 12px; }

/* 悬浮操作栏 */
.gc-card-actions {
  position: absolute; bottom: 0; left: 0; right: 0;
  display: flex; gap: 6px; justify-content: center; padding: 8px;
  background: linear-gradient(transparent, rgba(0,0,0,.55));
  opacity: 0; transition: opacity .18s; pointer-events: none;
}
.gc-card:hover .gc-card-actions { opacity: 1; pointer-events: auto; }
.gc-act {
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,.18); backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,.25); color: #fff;
  width: 32px; height: 32px; padding: 0;
  border-radius: 50%; cursor: pointer; font-family: inherit;
  transition: background .15s, transform .12s;
}
.gc-act:hover { background: rgba(255,255,255,.36); transform: scale(1.1); }
.gc-act.danger { background: rgba(210,61,61,.72); border-color: rgba(255,255,255,.22); }
.gc-act.danger:hover { background: rgba(190,42,42,.94); transform: scale(1.1); }
.gc-act .mso { font-size: 16px; }
</style>

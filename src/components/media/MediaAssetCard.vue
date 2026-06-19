<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import { formatRelativeTime } from '@/utils/timeFormat'
import type { MediaDisplayAsset } from '@/utils/mediaDisplayAsset'
import { resolveJcMediaUrl } from '@/utils/mediaFileReader'

const props = defineProps<{
  asset: MediaDisplayAsset
}>()

const emit = defineEmits<{
  preview: [asset: MediaDisplayAsset]
  download: [asset: MediaDisplayAsset]
  reference: [asset: MediaDisplayAsset]
  copyUrl: [asset: MediaDisplayAsset]
  delete: [asset: MediaDisplayAsset]
}>()

const isImage = computed(() => props.asset.kind === 'image')
const isVideo = computed(() => props.asset.kind === 'video')
const isAudio = computed(() => props.asset.kind === 'audio')
const isText = computed(() => props.asset.kind === 'text')
const infoTime = computed(() => props.asset.createdAt ? formatRelativeTime(props.asset.createdAt) : '')
const videoDuration = computed(() => {
  const seconds = Math.max(0, Math.round(props.asset.duration || 0))
  if (!seconds) return ''
  const min = Math.floor(seconds / 60)
  const sec = String(seconds % 60).padStart(2, '0')
  return `${min}:${sec}`
})
const videoPlaceholderText = computed(() =>
  props.asset.thumbnailFailedAt ? '无法生成首帧' : '首帧生成中'
)

// P1: jc-media:// → convertFileSrc 懒解析（共享 resolveJcMediaUrl）
const resolvedSrc = ref('')
const resolvedThumbnailSrc = ref('')
let resolveId = 0
watchEffect(() => {
  const rid = ++resolveId
  resolveJcMediaUrl(props.asset.displayUrl || '').then(u => { if (rid === resolveId) resolvedSrc.value = u })
  resolveJcMediaUrl(props.asset.thumbnailUrl || '').then(u => { if (rid === resolveId) resolvedThumbnailSrc.value = u })
})
</script>

<template>
  <div class="ma-card" @click="emit('preview', asset)">
    <div class="ma-media">
      <img v-if="isImage && resolvedSrc" :src="resolvedSrc" alt="" loading="lazy" decoding="async" />
      <img v-else-if="isVideo && resolvedThumbnailSrc" :src="resolvedThumbnailSrc" alt="" loading="lazy" decoding="async" />
      <div v-else-if="isVideo" class="ma-video">
        <span class="mso">movie</span>
        <span>{{ videoPlaceholderText }}</span>
      </div>
      <div v-else-if="isAudio" class="ma-audio">
        <span class="mso">graphic_eq</span>
        <span>{{ asset.name || '音频' }}</span>
      </div>
      <div v-else-if="isText" class="ma-text">
        <span class="mso">article</span>
        <span>{{ asset.content?.slice(0, 80) || asset.name || '文本' }}</span>
      </div>
      <div v-else class="ma-empty">
        <span class="mso">broken_image</span>
        <span>{{ asset.errorMsg || '媒体不可用' }}</span>
      </div>

      <div class="ma-type">
        <span class="mso">{{ isVideo ? 'videocam' : isAudio ? 'music_note' : isText ? 'article' : 'image' }}</span>
      </div>
      <div v-if="isVideo && videoDuration" class="ma-duration">{{ videoDuration }}</div>
      <div class="ma-actions">
        <button @click.stop="emit('preview', asset)" title="查看"><span class="mso">visibility</span></button>
        <button @click.stop="emit('reference', asset)" title="设为参考"><span class="mso">arrow_downward</span></button>
        <button @click.stop="emit('copyUrl', asset)" title="复制URL"><span class="mso">link</span></button>
        <button @click.stop="emit('download', asset)" title="下载"><span class="mso">download</span></button>
        <button class="danger" @click.stop="emit('delete', asset)" title="删除"><span class="mso">delete</span></button>
      </div>
    </div>
    <div class="ma-info">
      <span class="ma-name" :title="asset.name">{{ asset.name }}</span>
      <span v-if="infoTime" class="ma-time">{{ infoTime }}</span>
    </div>
  </div>
</template>

<style scoped>
.ma-card {
  width: 100%;
  align-self: start;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--line);
  background: var(--paper);
  cursor: pointer;
  box-shadow: 0 2px 8px var(--jc-shadow-color, rgba(0,0,0,.08));
}
.ma-card:hover { box-shadow: var(--jc-shadow-sm, 0 8px 24px rgba(0,0,0,.14)); }
.ma-media {
  position: relative;
  height: 148px;
  min-height: 148px;
  background: var(--surface-alt);
  overflow: hidden;
}
.ma-media img,
.ma-media video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  background: color-mix(in srgb, var(--surface-alt) 86%, #000);
}
.ma-video,
.ma-audio,
.ma-empty {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px;
  box-sizing: border-box;
  color: var(--ink3);
  font-size: 11px;
  text-align: center;
}
.ma-video .mso,
.ma-audio .mso,
.ma-empty .mso { font-size: 30px; opacity: .7; }
.ma-type {
  position: absolute;
  left: 8px;
  top: 8px;
  border-radius: 999px;
  padding: 3px 6px;
  background: rgba(0,0,0,.48);
  color: #fff;
  display: flex;
  align-items: center;
}
.ma-type .mso { font-size: 14px; }
.ma-duration {
  position: absolute;
  right: 8px;
  bottom: 8px;
  height: 22px;
  padding: 0 7px;
  border-radius: 999px;
  background: rgba(0,0,0,.58);
  color: #fff;
  font-size: 11px;
  font-weight: 800;
  display: flex;
  align-items: center;
}
.ma-actions {
  position: absolute;
  right: 8px;
  top: 8px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity .15s;
}
.ma-card:hover .ma-actions { opacity: 1; }
.ma-actions button {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 999px;
  background: rgba(0,0,0,.54);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.ma-actions button.danger { background: rgba(198,40,40,.74); }
.ma-actions .mso { font-size: 15px; }
.ma-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 8px;
  font-size: 11px;
}
.ma-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink);
  font-weight: 600;
}
.ma-time {
  flex-shrink: 0;
  color: var(--ink3);
}
</style>

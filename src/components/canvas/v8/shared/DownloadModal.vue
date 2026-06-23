<template>
  <div v-if="visible" class="dm-overlay" @click.self="close">
    <div class="dm-card">
      <div class="dm-header">
        <span>素材下载</span>
        <button @click="close" class="dm-close"><JcIcon name="close" /></button>
      </div>
      <div class="dm-stats">
        <span>图片 {{ images.length }} 张</span>
        <span>视频 {{ videos.length }} 个</span>
      </div>
      <div v-if="images.length" class="dm-section">
        <h4>图片素材</h4>
        <div class="dm-grid">
          <div v-for="(asset, idx) in images" :key="idx" class="dm-item" @click="download(asset)">
            <img :src="asset.url" class="dm-thumb" />
            <div class="dm-item-overlay"><JcIcon name="download" /></div>
          </div>
        </div>
      </div>
      <div v-if="videos.length" class="dm-section">
        <h4>视频素材</h4>
        <div class="dm-grid">
          <div v-for="(asset, idx) in videos" :key="idx" class="dm-item" @click="download(asset)">
            <video :src="asset.url" class="dm-thumb" />
            <div class="dm-item-overlay"><JcIcon name="download" /></div>
          </div>
        </div>
      </div>
      <button @click="downloadAll" class="dm-dl-all"><JcIcon name="download" /> 全部下载</button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ visible: boolean; images: Array<{url:string;label?:string}>; videos: Array<{url:string;label?:string}> }>()
const emit = defineEmits<{ 'update:visible': [boolean] }>()
const close = () => emit('update:visible', false)
const download = (asset: {url:string;label?:string}) => { const a = document.createElement('a'); a.href = asset.url; a.download = asset.label || 'download'; a.click() }
const downloadAll = () => { /* implement if needed */ }
</script>

<style scoped>
.dm-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 10000; display: flex; align-items: center; justify-content: center; }
.dm-card { background: var(--paper); border-radius: var(--radius); width: 560px; max-width: 90vw; max-height: 80vh; overflow-y: auto; padding: 20px; box-shadow: var(--jc-shadow-lg); }
.dm-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-size: 16px; font-weight: 700; color: var(--ink); }
.dm-close { border: none; background: none; cursor: pointer; color: var(--ink3); }
.dm-stats { display: flex; gap: 16px; font-size: 12px; color: var(--ink2); margin-bottom: 12px; }
.dm-section { margin-bottom: 16px; }
.dm-section h4 { font-size: 13px; font-weight: 600; color: var(--ink); margin-bottom: 8px; }
.dm-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; max-height: 200px; overflow-y: auto; }
.dm-item { aspect-ratio: 1; border-radius: 8px; overflow: hidden; background: var(--surface); cursor: pointer; position: relative; }
.dm-thumb { width: 100%; height: 100%; object-fit: cover; }
.dm-item-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.15s; color: #fff; }
.dm-item:hover .dm-item-overlay { opacity: 1; }
.dm-dl-all { width: 100%; padding: 10px; border-radius: 8px; border: none; background: var(--olive); color: #fff; font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; font-family: var(--jc-font-body); }
</style>

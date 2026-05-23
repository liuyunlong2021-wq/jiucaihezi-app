<script setup lang="ts">
import type { CanvasNodeType } from '@/types/canvas'

const emit = defineEmits<{
  (e: 'add-node', type: CanvasNodeType): void
  (e: 'drag-node', event: DragEvent, type: CanvasNodeType): void
}>()

const groups: Array<{ title: string; items: Array<{ type: CanvasNodeType; icon: string; label: string; desc: string }> }> = [
  {
    title: '基础',
    items: [
      { type: 'text', icon: 'notes', label: '文本', desc: '提示词、脚本、备注' },
      { type: 'file', icon: 'draft', label: '文件', desc: '引用第二列文件' },
      { type: 'imageResult', icon: 'image', label: '图片', desc: '上传或承接生成结果' },
      { type: 'videoResult', icon: 'movie', label: '视频', desc: '上传或承接生成结果' },
      { type: 'audioResult', icon: 'audio_file', label: '音频', desc: '上传或承接生成结果' },
      { type: 'group', icon: 'folder_open', label: '分组', desc: '章节、镜头、工具链' },
    ],
  },
  {
    title: 'AI',
    items: [
      { type: 'llm', icon: 'smart_toy', label: 'AI 文本', desc: '云端或 Ollama' },
      { type: 'imageGen', icon: 'image', label: '图片生成', desc: '自动产出图片节点' },
      { type: 'videoGen', icon: 'movie', label: '视频生成', desc: '自动产出视频节点' },
      { type: 'audioGen', icon: 'music_note', label: '音频生成', desc: '自动产出音频节点' },
    ],
  },
  {
    title: '工具',
    items: [
      { type: 'tool', icon: 'construction', label: '本地工具', desc: 'ToMD、浏览器读取' },
    ],
  },
]
</script>

<template>
  <aside class="cnl">
    <div class="cnl-title">节点</div>
    <div v-for="group in groups" :key="group.title" class="cnl-group">
      <div class="cnl-group-title">{{ group.title }}</div>
      <button v-for="item in group.items" :key="item.type" class="cnl-item" draggable="true" @dragstart="emit('drag-node', $event, item.type)" @click="emit('add-node', item.type)">
        <span class="mso">{{ item.icon }}</span>
        <span class="cnl-copy">
          <strong>{{ item.label }}</strong>
          <small>{{ item.desc }}</small>
        </span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.cnl {
  width: 172px;
  border-right: 1px solid var(--border);
  background: var(--surface);
  padding: 10px;
  overflow: auto;
  flex-shrink: 0;
}
.cnl-title { font-size: 13px; font-weight: 800; color: var(--ink1); margin: 2px 0 12px; }
.cnl-group { margin-bottom: 14px; }
.cnl-group-title { font-size: 11px; color: var(--ink3); margin-bottom: 6px; }
.cnl-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink1);
  cursor: pointer;
  text-align: left;
  margin-bottom: 6px;
}
.cnl-item:hover { border-color: var(--olive-dark); background: var(--olive-pale); }
.cnl-item .mso { font-size: 19px; color: var(--olive-dark); }
.cnl-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.cnl-copy strong { font-size: 12px; }
.cnl-copy small { font-size: 10px; color: var(--ink3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>

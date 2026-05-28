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
      { type: 'output', icon: 'preview', label: '输出', desc: '预览透传上游结果' },
    ],
  },
  {
    title: 'AI 生成',
    items: [
      { type: 'llm', icon: 'smart_toy', label: 'AI 文本', desc: '云端或 Ollama' },
      { type: 'imageGen', icon: 'image', label: '图片生成', desc: '自动产出图片节点' },
      { type: 'videoGen', icon: 'movie', label: '视频生成', desc: '自动产出视频节点' },
      { type: 'audioGen', icon: 'music_note', label: '音频生成', desc: '自动产出音频节点' },
      { type: 'runninghub', icon: 'workflow', label: 'RunningHub', desc: '单次工作流' },
      { type: 'rhTools', icon: 'apps', label: 'RH 工具集', desc: '工作流仓库' },
      { type: 'seedance', icon: 'movie', label: 'Seedance', desc: 'Seedance 2.0 视频' },
    ],
  },
  {
    title: '素材',
    items: [
      { type: 'upload', icon: 'upload_file', label: '上传', desc: '图像/视频/音频上传' },
      { type: 'materialSet', icon: 'collections', label: '素材集', desc: '同类型素材打包' },
    ],
  },
  {
    title: '流程',
    items: [
      { type: 'loop', icon: 'repeat', label: '循环器', desc: '串联/并联下游执行' },
      { type: 'pickFromSet', icon: 'filter_alt', label: '从合集取', desc: '按索引取单个素材' },
      { type: 'textSplit', icon: 'splitscreen', label: '文本分割', desc: '分段/分镜/按行' },
      { type: 'framePair', icon: 'film_frames', label: '首尾帧', desc: '视频抽首尾帧' },
    ],
  },
  {
    title: '图像处理',
    items: [
      { type: 'resize', icon: 'aspect_ratio', label: '尺寸调整', desc: '宽高/缩放' },
      { type: 'combine', icon: 'join', label: '合并', desc: '多图拼接' },
      { type: 'gridCrop', icon: 'grid_view', label: '宫格剪裁', desc: '网格切图' },
      { type: 'imageCompare', icon: 'compare', label: '对比', desc: '双图对比' },
    ],
  },
  {
    title: '工具箱',
    items: [
      { type: 'cinematic', icon: 'theaters', label: '电影感', desc: '风格/镜头/光影组合' },
      { type: 'videoMotion', icon: 'videocam', label: '运镜', desc: '场景/动作/路径组合' },
      { type: 'multiAngleVisual', icon: '360', label: '多角度', desc: '方位/俯仰/距离' },
    ],
  },
  {
    title: '辅助',
    items: [
      { type: 'idea', icon: 'lightbulb', label: '灵感', desc: '灵感记录' },
      { type: 'bp', icon: 'account_tree', label: '蓝图', desc: '流程蓝图' },
      { type: 'relay', icon: 'swap_horiz', label: '中继', desc: '数据透传' },
      { type: 'rhConfig', icon: 'settings', label: 'RH 配置', desc: 'API Key 与余额' },
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

<script setup lang="ts">
import type { CanvasNodeType } from '@/types/canvas'

const emit = defineEmits<{
  (e: 'add-node', type: CanvasNodeType): void
  (e: 'drag-node', event: DragEvent, type: CanvasNodeType): void
}>()

const groups: Array<{ 
  title: string; 
  zone: 'context' | 'core' | 'orchestration' | 'legacy';
  collapsed?: boolean;
  items: Array<{ type: CanvasNodeType; icon: string; label: string; desc: string }> 
}> = [
  // 上下文
  {
    title: '上下文',
    zone: 'context',
    items: [
      { type: 'skill', icon: 'smart_toy', label: 'Skill', desc: '官方 Skill 注入 system prompt' },
      { type: 'toolset', icon: 'construction', label: '工具集', desc: '宽容暴露，LLM 自主决定' },
    ],
  },
  // 核心
  {
    title: '生成',
    zone: 'core',
    items: [
      { type: 'text', icon: 'notes', label: '文本', desc: '提示词输入 · 支持 AI 润色' },
      { type: 'llm', icon: 'smart_toy', label: 'LLM', desc: '模型生成 · 系统提示词 · 输出拆分' },
      { type: 'imageGen', icon: 'image', label: '图片生成', desc: '文生图 · 模型/尺寸可选' },
      { type: 'videoGen', icon: 'movie', label: '视频生成', desc: '模型/比例/时长可选' },
      { type: 'audioGen', icon: 'music_note', label: '音频生成', desc: '标题/标签/MV' },
      { type: 'imageResult', icon: 'image', label: '图片结果', desc: '预览/下载/右键操作' },
      { type: 'videoResult', icon: 'movie', label: '视频结果', desc: '播放/下载' },
      { type: 'audioResult', icon: 'audio_file', label: '音频结果', desc: '播放/下载' },
    ],
  },
  // 编排
  {
    title: '编排',
    zone: 'orchestration',
    collapsed: true,
    items: [
      { type: 'group', icon: 'folder_open', label: 'Group', desc: '子图分组 · N 端口防丢数据' },
      { type: 'loop', icon: 'repeat', label: '循环器', desc: '迭代执行 + 进度' },
      { type: 'textSplit', icon: 'splitscreen', label: '文本分割', desc: '动态输出端口' },
    ],
  },
  // 其他（legacy，折叠避免干扰 · 旧节点保留兼容）
  {
    title: '其他（Legacy）',
    zone: 'legacy',
    collapsed: true,
    items: [
      { type: 'tool', icon: 'construction', label: '本地工具', desc: 'ToMD、浏览器读取（旧）' },
      { type: 'output', icon: 'preview', label: '输出', desc: '预览透传上游结果' },
      { type: 'file', icon: 'draft', label: '文件', desc: '引用第二列文件' },
      { type: 'upload', icon: 'upload_file', label: '上传', desc: '图像/视频/音频上传' },
      { type: 'materialSet', icon: 'collections', label: '素材集', desc: '同类型素材打包' },
      { type: 'pickFromSet', icon: 'filter_alt', label: '从合集取', desc: '按索引取单个素材' },
      { type: 'framePair', icon: 'film_frames', label: '首尾帧', desc: '视频抽首尾帧' },
      { type: 'resize', icon: 'aspect_ratio', label: '尺寸调整', desc: '宽高/缩放' },
      { type: 'combine', icon: 'join', label: '合并', desc: '多图拼接' },
      { type: 'gridCrop', icon: 'grid_view', label: '宫格剪裁', desc: '网格切图' },
      { type: 'imageCompare', icon: 'compare', label: '对比', desc: '双图对比' },
      { type: 'cinematic', icon: 'theaters', label: '电影感', desc: '风格/镜头/光影组合' },
      { type: 'videoMotion', icon: 'videocam', label: '运镜', desc: '场景/动作/路径组合' },
      { type: 'multiAngleVisual', icon: '360', label: '多角度', desc: '方位/俯仰/距离' },
      { type: 'idea', icon: 'lightbulb', label: '灵感', desc: '灵感记录' },
      { type: 'bp', icon: 'account_tree', label: '蓝图', desc: '流程蓝图' },
      { type: 'relay', icon: 'swap_horiz', label: '中继', desc: '数据透传' },
      { type: 'runninghub', icon: 'workflow', label: 'RunningHub', desc: '单次工作流（可迁移 V8）' },
      { type: 'rhTools', icon: 'apps', label: 'RH 工具集', desc: '工作流仓库' },
      { type: 'seedance', icon: 'movie', label: 'Seedance', desc: 'Seedance 2.0 视频（可迁移 V8）' },
      { type: 'rhConfig', icon: 'settings', label: 'RH 配置', desc: 'API Key 与余额' },
    ],
  },
]
</script>

<template>
  <aside class="cnl">
    <div class="cnl-title">节点库</div>

    <!-- 上下文区 -->
    <div class="cnl-zone cnl-zone-context">
      <div class="cnl-zone-title">上下文</div>
      <template v-for="group in groups.filter(g => g.zone === 'context')" :key="group.title">
        <div class="cnl-group">
          <div class="cnl-group-title">{{ group.title }}</div>
          <button v-for="item in group.items" :key="item.type" class="cnl-item cnl-item-context" draggable="true" @dragstart="emit('drag-node', $event, item.type)" @click="emit('add-node', item.type)">
            <span class="mso">{{ item.icon }}</span>
            <span class="cnl-copy">
              <strong>{{ item.label }}</strong>
              <small>{{ item.desc }}</small>
            </span>
          </button>
        </div>
      </template>
    </div>

    <!-- 核心区 -->
    <div class="cnl-zone cnl-zone-core">
      <div class="cnl-zone-title">生成</div>
      <template v-for="group in groups.filter(g => g.zone === 'core')" :key="group.title">
        <div class="cnl-group">
          <div class="cnl-group-title">{{ group.title }}</div>
          <button v-for="item in group.items" :key="item.type" class="cnl-item" draggable="true" @dragstart="emit('drag-node', $event, item.type)" @click="emit('add-node', item.type)">
            <span class="mso">{{ item.icon }}</span>
            <span class="cnl-copy">
              <strong>{{ item.label }}</strong>
              <small>{{ item.desc }}</small>
            </span>
          </button>
        </div>
      </template>
    </div>

    <!-- 编排区（默认折叠） -->
    <div class="cnl-zone cnl-zone-orchestration">
      <details :open="!groups.find(g => g.zone === 'orchestration')?.collapsed">
        <summary class="cnl-zone-title">编排</summary>
        <template v-for="group in groups.filter(g => g.zone === 'orchestration')" :key="group.title">
          <div class="cnl-group">
            <div class="cnl-group-title">{{ group.title }}</div>
            <button v-for="item in group.items" :key="item.type" class="cnl-item" draggable="true" @dragstart="emit('drag-node', $event, item.type)" @click="emit('add-node', item.type)">
              <span class="mso">{{ item.icon }}</span>
              <span class="cnl-copy">
                <strong>{{ item.label }}</strong>
                <small>{{ item.desc }}</small>
              </span>
            </button>
          </div>
        </template>
      </details>
    </div>

    <!-- Legacy 折叠 -->
    <div class="cnl-zone cnl-zone-legacy">
      <details>
        <summary class="cnl-zone-title">其他</summary>
        <template v-for="group in groups.filter(g => g.zone === 'legacy')" :key="group.title">
          <div class="cnl-group">
            <div class="cnl-group-title">{{ group.title }}</div>
            <button v-for="item in group.items" :key="item.type" class="cnl-item cnl-item-legacy" draggable="true" @dragstart="emit('drag-node', $event, item.type)" @click="emit('add-node', item.type)">
              <span class="mso">{{ item.icon }}</span>
              <span class="cnl-copy">
                <strong>{{ item.label }}</strong>
                <small>{{ item.desc }}</small>
              </span>
            </button>
          </div>
        </template>
      </details>
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

/* Phase 3 3-zone experience layer (Week 7-9) */
.cnl-zone {
  margin-bottom: 8px;
}
.cnl-zone-context {
  background: linear-gradient(180deg, rgba(167,139,250,0.08), transparent);
  border-radius: 6px;
  padding: 2px;
}
.cnl-zone-context .cnl-zone-title {
  color: #6d28d9;
  font-weight: 700;
  font-size: 11px;
  padding: 4px 8px;
}
.cnl-item-context {
  border-left: 3px dashed #a78bfa; /* 紫色 dashed 呼应 Context Provider 哲学 (user-evidence only) */
}
.cnl-zone-orchestration details,
.cnl-zone-legacy details {
  border-top: 1px solid var(--border);
  padding-top: 4px;
}
.cnl-zone-title {
  font-size: 10px;
  font-weight: 600;
  color: var(--ink3);
  padding: 2px 8px;
  user-select: none;
}
.cnl-item-legacy {
  opacity: 0.75;
}
</style>

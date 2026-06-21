<script setup lang="ts">
import { useCanvasStore } from '@/stores/canvasStore'

const emit = defineEmits<{
  (e: 'new-canvas'): void
  (e: 'run-selected'): void
  (e: 'run-all'): void
  (e: 'delete-selected'): void
  (e: 'toggle-workflows'): void
  (e: 'export-canvas'): void
  (e: 'import-canvas'): void
  (e: 'screenshot'): void
  (e: 'save-canvas'): void
  (e: 'save-to-files'): void
}>()

const canvasStore = useCanvasStore()
</script>

<template>
  <div class="cw-toolbar">
    <button class="cw-btn" @click="emit('new-canvas')">
      <JcIcon name="add_box" />
      新建
    </button>
    <button class="cw-btn" :disabled="!canvasStore.canUndo" @click="canvasStore.undo()">
      <JcIcon name="undo" />
    </button>
    <button class="cw-btn" :disabled="!canvasStore.canRedo" @click="canvasStore.redo()">
      <JcIcon name="redo" />
    </button>
    <span class="cw-divider"></span>
    <button class="cw-btn" :disabled="!canvasStore.selectedNode" @click="canvasStore.duplicateNode(canvasStore.selectedNodeId)">
      <JcIcon name="content_copy" />
      复制
    </button>
    <button class="cw-btn danger" :disabled="!canvasStore.selectedNode" @click="emit('delete-selected')">
      <JcIcon name="delete" />
      删除
    </button>
    <span class="cw-divider"></span>
    <button class="cw-btn" @click="canvasStore.autoLayout()">
      <JcIcon name="account_tree" />
      整理
    </button>
    <button class="cw-btn" @click="canvasStore.groupSelectedNodes()">
      <JcIcon name="select_all" />
      分组
    </button>
    <button class="cw-btn" @click="emit('import-canvas')">
      <JcIcon name="upload_file" />
      导入
    </button>
    <button class="cw-btn" @click="emit('export-canvas')">
      <JcIcon name="download" />
      导出
    </button>
    <button class="cw-btn" @click="emit('screenshot')">
      <JcIcon name="photo_camera" />
      截图
    </button>
    <button class="cw-btn" @click="emit('toggle-workflows')">
      <JcIcon name="account_tree" />
      模板
    </button>
    <button class="cw-btn primary" :disabled="!canvasStore.selectedNode" @click="emit('run-selected')">
      <JcIcon name="play_arrow" />
      执行节点
    </button>
    <button class="cw-btn" @click="emit('run-all')">
      <JcIcon name="play_circle" />
      执行全部
    </button>
    <button class="cw-btn" @click="emit('save-canvas')">
      <JcIcon name="save" />
      保存
    </button>
  </div>
</template>

<style scoped>
.cw-toolbar {
  height: 44px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-alt);
  flex-shrink: 0;
}
.cw-btn {
  height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--paper);
  color: var(--ink2);
  padding: 0 9px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.cw-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.cw-btn.primary { background: var(--olive); color: var(--jc-on-primary); border-color: transparent; font-weight: 700; }
.cw-btn.danger:hover { color: var(--jc-error); }
.cw-btn .mso { font-size: 16px; }
.cw-divider { width: 1px; height: 20px; background: var(--border); margin: 0 3px; }
</style>

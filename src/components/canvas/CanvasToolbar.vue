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
  (e: 'close-canvas'): void
}>()

const canvasStore = useCanvasStore()
</script>

<template>
  <div class="cw-toolbar">
    <button class="cw-btn" @click="emit('new-canvas')">
      <span class="mso">add_box</span>
      新建
    </button>
    <button class="cw-btn" :disabled="!canvasStore.canUndo" @click="canvasStore.undo()">
      <span class="mso">undo</span>
    </button>
    <button class="cw-btn" :disabled="!canvasStore.canRedo" @click="canvasStore.redo()">
      <span class="mso">redo</span>
    </button>
    <span class="cw-divider"></span>
    <button class="cw-btn" :disabled="!canvasStore.selectedNode" @click="canvasStore.duplicateNode(canvasStore.selectedNodeId)">
      <span class="mso">content_copy</span>
      复制
    </button>
    <button class="cw-btn danger" :disabled="!canvasStore.selectedNode" @click="emit('delete-selected')">
      <span class="mso">delete</span>
      删除
    </button>
    <span class="cw-divider"></span>
    <button class="cw-btn" @click="canvasStore.autoLayout()">
      <span class="mso">account_tree</span>
      整理
    </button>
    <button class="cw-btn" @click="canvasStore.groupSelectedNodes()">
      <span class="mso">select_all</span>
      分组
    </button>
    <button class="cw-btn" @click="emit('import-canvas')">
      <span class="mso">upload_file</span>
      导入
    </button>
    <button class="cw-btn" @click="emit('export-canvas')">
      <span class="mso">download</span>
      导出
    </button>
    <button class="cw-btn" @click="emit('screenshot')">
      <span class="mso">photo_camera</span>
      截图
    </button>
    <button class="cw-btn" @click="emit('toggle-workflows')">
      <span class="mso">account_tree</span>
      模板
    </button>
    <button class="cw-btn primary" :disabled="!canvasStore.selectedNode" @click="emit('run-selected')">
      <span class="mso">play_arrow</span>
      执行节点
    </button>
    <button class="cw-btn" @click="emit('run-all')">
      <span class="mso">play_circle</span>
      执行全部
    </button>
    <button class="cw-btn" @click="emit('save-canvas')">
      <span class="mso">save</span>
      保存
    </button>
    <span class="cw-spacer"></span>
    <button class="cw-btn cw-btn-close" @click="emit('close-canvas')">
      <span class="mso">close</span>
      返回对话
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
.cw-spacer { flex: 1; }
.cw-btn-close { background: var(--jc-error); color: #fff; border-color: transparent; }
.cw-btn-close:hover { opacity: 0.85; }
</style>

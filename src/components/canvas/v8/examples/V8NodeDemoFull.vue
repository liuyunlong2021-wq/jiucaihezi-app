<template>
  <div class="v8-full-demo">
    <h3>V8 Phase 0 - 手感基础设施演示</h3>
    <p>拖拽右下角缩放手柄，观察是否流畅（冻结策略已启用）</p>

    <NodeFrame
      id="demo-full-1"
      label="AI 大脑 (演示)"
      icon="smart_toy"
      role="think"
      :collapsed="collapsed"
      :status="status"
      executable
      :show-stop="status === 'running'"
      @toggle-collapse="collapsed = !collapsed"
      @run="handleRun"
      @stop="handleStop"
      @delete="handleDelete"
      @resize-start="handleResizeStart"
    >
      <div style="padding: 8px; background: #f8f8f8; border-radius: 6px;">
        <p>这是内容区。折叠后内容完全不渲染。</p>
        <p>当前尺寸: {{ currentWidth }} × {{ currentHeight }}</p>
      </div>
    </NodeFrame>

    <div style="margin-top: 16px; font-size: 12px; color: #666;">
      冻结状态: {{ isInteracting ? '已冻结 (高性能模式)' : '正常' }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import NodeFrame from '../NodeFrame.vue'
import { useV8NodeBehavior } from '../composables/useV8NodeBehavior'

const collapsed = ref(false)
const status = ref<'idle' | 'running'>('idle')
const currentWidth = ref(320)
const currentHeight = ref(180)


const fakeNode = {
  id: 'demo-full-1',
  data: { width: currentWidth.value, height: currentHeight.value }
} as any

const { onResizeHandlePointerDown, resizingId, isInteracting } = useV8NodeBehavior(fakeNode, {
  onResizeEnd: (id, w, h) => {
    currentWidth.value = w
    currentHeight.value = h
    console.log('[V8 Demo] Resize 结束:', w, h)
  }
})

function handleResizeStart(e: PointerEvent) {
  onResizeHandlePointerDown(e)
}

function handleRun() {
  status.value = 'running'
}

function handleStop() {
  status.value = 'idle'
}

function handleDelete() {
  alert('删除节点（演示）')
}
</script>

<style scoped>
.v8-full-demo {
  padding: 20px;
  background: #f0f0f0;
  border-radius: 8px;
}
</style>
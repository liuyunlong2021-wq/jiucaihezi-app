<template>
  <!-- 
    V8 节点使用示例（仅用于开发测试）
    这个文件不会打包进正式产品，仅用于验证手感
  -->
  <div class="v8-demo">
    <NodeFrame
      id="demo-1"
      label="AI 大脑"
      icon="smart_toy"
      role="think"
      :collapsed="isCollapsed"
      executable
      :status="status"
      @toggle-collapse="isCollapsed = !isCollapsed"
      @run="runDemo"
      @stop="stopDemo"
      @delete="console.log('delete')"
      @resize-start="handleResizeStart"
    >
      <div class="demo-content">
        <p>这是 V8 新 Frame 的内容区</p>
        <p>Collapsed 状态下内容会完全不渲染</p>
      </div>
    </NodeFrame>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import NodeFrame from '../NodeFrame.vue'
import { useV8NodeResize } from '../composables/useV8NodeResize'

const isCollapsed = ref(false)
const status = ref<'idle' | 'running'>('idle')

const { handlePointerDown } = useV8NodeResize({
  onResizeEnd: (id, w, h) => {
    console.log('Demo resize end:', w, h)
  }
})

function handleResizeStart(e: PointerEvent) {
  // 在真实节点中，这里会传入当前 node 数据
  const fakeNode = { id: 'demo-1', data: { width: 300, height: 180 } } as any
  handlePointerDown(e, fakeNode)
}

function runDemo() {
  status.value = 'running'
  setTimeout(() => {
    status.value = 'idle'
  }, 2000)
}

function stopDemo() {
  status.value = 'idle'
}
</script>

<style scoped>
.v8-demo {
  padding: 40px;
  background: #f5f5f5;
}
.demo-content {
  padding: 12px;
  background: #fff;
  border-radius: 6px;
}
</style>
<template>
  <div class="v8-handfeel-demo">
    <div class="demo-header">
      <h3>V8 Phase 0 - 手感基础设施实时演示</h3>
      <div class="status">
        冻结状态: 
        <span :class="isInteracting ? 'frozen' : 'normal'">
          {{ isInteracting ? '已激活 (高性能模式)' : '正常' }}
        </span>
        <span v-if="resizingId" class="resizing"> | 正在缩放: {{ resizingId }}</span>
      </div>
    </div>

    <div class="node-container">
      <!-- 使用 V8 NodeFrame + Behavior -->
      <NodeFrame
        id="demo-llm"
        label="AI 大脑"
        icon="smart_toy"
        role="think"
        :collapsed="collapsed"
        :status="status"
        executable
        :show-stop="status === 'running'"
        @toggle-collapse="collapsed = !collapsed"
        @run="startRun"
        @stop="stopRun"
        @delete="onDelete"
        @resize-start="onResizeStart"
      >
        <div class="node-body">
          <p>这是 V8 新 Frame 的内容区。</p>
          <p>拖拽右下角手柄测试缩放流畅度。</p>
          <p>折叠后内容完全不渲染。</p>
          <div class="size-info">
            当前尺寸: {{ width }} × {{ height }}
          </div>
        </div>
      </NodeFrame>
    </div>

    <div class="instructions">
      <strong>测试方法：</strong><br>
      1. 拖拽右下角缩放手柄，观察是否卡顿<br>
      2. 点击折叠按钮，内容应立即消失<br>
      3. 执行/停止按钮测试状态<br>
      4. 打开控制台运行 <code>window.runV8Phase0Benchmark()</code> 看性能数据
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watchEffect } from 'vue'
import NodeFrame from '../NodeFrame.vue'
import { 
  useV8NodeBehavior, 
  freezeManager 
} from '@/components/canvas/v8'

// 模拟节点数据
const nodeData = reactive({
  id: 'demo-llm',
  type: 'llm',
  label: 'AI 大脑',
  position: { x: 0, y: 0 },
  data: {},
  width: 320,
  height: 200
})

const collapsed = ref(false)
const status = ref<'idle' | 'running'>('idle')

const { 
  resizingId, 
  onResizeHandlePointerDown 
} = useV8NodeBehavior(nodeData as any, {
  onResizeEnd: (id, w, h) => {
    nodeData.width = w
    nodeData.height = h
    console.log('[V8 Demo] Resize 完成:', w, h)
  }
})

const isInteracting = freezeManager.isFrozen

// 实时尺寸（用于演示）
const width = ref(nodeData.width)
const height = ref(nodeData.height)

// 监听 resizeId 来更新实时尺寸显示
watchEffect(() => {
  if (resizingId.value) {
    // 在真实 resize 中，useV8NodeResize 会通过 RAF 更新 DOM
    // 这里我们模拟显示
  }
})

function onResizeStart(e: PointerEvent) {
  onResizeHandlePointerDown(e)
}

function startRun() {
  status.value = 'running'
  setTimeout(() => {
    if (status.value === 'running') {
      status.value = 'idle'
    }
  }, 2500)
}

function stopRun() {
  status.value = 'idle'
}

function onDelete() {
  alert('删除节点（演示）')
}
</script>

<style scoped>
.v8-handfeel-demo {
  padding: 20px;
  background: #f8f5f0;
  border-radius: 12px;
  max-width: 420px;
}

.demo-header {
  margin-bottom: 12px;
}

.status {
  font-size: 12px;
  color: #666;
  margin-top: 4px;
}

.frozen { color: #f59e0b; font-weight: 600; }
.normal { color: #10b981; }
.resizing { color: #8b5cf6; }

.node-container {
  margin: 16px 0;
}

.node-body {
  padding: 10px;
  background: white;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.5;
}

.size-info {
  margin-top: 8px;
  font-size: 11px;
  color: #888;
  font-family: monospace;
}

.instructions {
  margin-top: 16px;
  padding: 12px;
  background: #fff;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.6;
  border-left: 3px solid #d4af37;
}

code {
  background: #f0f0f0;
  padding: 1px 4px;
  border-radius: 3px;
  font-family: monospace;
}
</style>

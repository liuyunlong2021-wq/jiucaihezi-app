<!--
  开发专用面板
  用于在当前画布环境中快速测试 Phase 0 手感
  仅开发模式使用
-->
<template>
  <div class="dev-v8-panel">
    <button @click="toggleDemo">切换 手感 Demo</button>
    <button @click="runBenchmark">运行 Phase 0 基准</button>
  </div>

  <Teleport to="body">
    <div v-if="showDemo" class="dev-demo-overlay">
      <V8HandfeelDemo />
      <button class="close-btn" @click="toggleDemo">关闭</button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import HandfeelDemo from '../examples/HandfeelDemo.vue'
import { runPhase0Benchmark } from '../examples/runBenchmark'
import { activatePhase0 } from '../activate'

const showDemo = ref(false)

function toggleDemo() {
  if (!showDemo.value) {
    activatePhase0()
  }
  showDemo.value = !showDemo.value
}

async function runBenchmark() {
  activatePhase0()
  await runPhase0Benchmark({ useSimulation: true })
}
</script>

<style scoped>
.dev-v8-panel {
  position: fixed;
  bottom: 12px;
  right: 12px;
  z-index: 9999;
  display: flex;
  gap: 8px;
  background: white;
  padding: 8px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  font-size: 12px;
}

.dev-demo-overlay {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 10000;
  background: white;
  padding: 20px;
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.2);
}

.close-btn {
  position: absolute;
  top: 8px;
  right: 8px;
}
</style>
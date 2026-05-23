<script setup lang="ts">
import { useCanvasStore } from '@/stores/canvasStore'

const canvasStore = useCanvasStore()
</script>

<template>
  <details class="cel" @pointerdown.stop>
    <summary>执行日志 <span>{{ canvasStore.executionLogs.length }}</span></summary>
    <div class="cel-actions">
      <button @click="canvasStore.clearExecutionLogs()">清空</button>
    </div>
    <div class="cel-list">
      <div v-for="log in canvasStore.executionLogs" :key="log.id" class="cel-row" :class="log.level">
        <span>{{ new Date(log.createdAt).toLocaleTimeString() }}</span>
        <p>{{ log.message }}</p>
      </div>
    </div>
  </details>
</template>

<style scoped>
.cel { position:absolute; right:0; top:0; z-index:28; width:clamp(260px, 24vw, 360px); max-height:min(420px, calc(100% - 16px)); border:1px solid var(--border); border-radius:0 0 0 10px; background:var(--paper); box-shadow:var(--jc-shadow-md); color:var(--ink1); overflow:hidden; }
.cel summary { height:34px; display:flex; align-items:center; justify-content:space-between; padding:0 10px; cursor:pointer; font-size:12px; font-weight:800; }
.cel summary span { color:var(--ink3); font-weight:600; }
.cel-actions { padding:0 8px 7px; border-top:1px solid var(--border2); }
.cel-actions button { height:24px; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--ink3); font:inherit; font-size:11px; cursor:pointer; }
.cel-list { max-height:min(340px, calc(100vh - 220px)); overflow:auto; padding:0 8px 8px; }
.cel-row { display:grid; grid-template-columns:64px 1fr; gap:6px; padding:6px 0; border-top:1px solid var(--border2); }
.cel-row span { font-size:10px; color:var(--ink3); }
.cel-row p { margin:0; font-size:11px; line-height:1.4; color:var(--ink2); }
.cel-row.error p { color:var(--jc-error); }
.cel-row.success p { color:var(--olive-dark); }
</style>

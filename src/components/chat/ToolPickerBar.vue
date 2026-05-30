<script setup lang="ts">
/**
 * ToolPickerBar.vue — 输入框上方工具状态栏
 *
 * 工具默认关闭；用户显式开启后，LLM 才能看到允许暴露的工具 definitions。
 */
import { computed } from 'vue'
import { useToolStore } from '@/stores/toolStore'

const toolStore = useToolStore()

const statusLabel = computed(() => toolStore.localToolsEnabled ? '工具已开启' : '工具关闭')
const statusTitle = computed(() => toolStore.localToolsEnabled
  ? '本轮对话可使用已允许的本地工具；写入和需确认工具仍不会自动暴露'
  : '工具关闭时，模型请求不会携带工具定义'
)
</script>

<template>
  <div class="tpb">
    <button
      class="tpb-toggle"
      :class="{ on: toolStore.localToolsEnabled }"
      type="button"
      :aria-pressed="toolStore.localToolsEnabled"
      :title="statusTitle"
      @click="toolStore.toggleLocalTools()"
    >
      <span class="mso tpb-icon">{{ toolStore.localToolsEnabled ? 'toggle_on' : 'toggle_off' }}</span>
      <span class="tpb-label">工具</span>
      <span class="tpb-status">{{ statusLabel }}</span>
    </button>
  </div>
</template>

<style scoped>
.tpb {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--line);
}

.tpb-toggle {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 10px; border: 1px solid var(--line); border-radius: 6px;
  background: var(--paper); color: var(--ink2); cursor: pointer;
  font-size: 12px; font-weight: 600; font-family: inherit;
  transition: all .12s;
}
.tpb-toggle:hover { border-color: var(--olive); color: var(--olive); }
.tpb-toggle.on {
  border-color: var(--olive);
  background: rgba(107,142,35,.1);
  color: var(--olive);
}
.tpb-icon { font-size: 17px; }
.tpb-label { color: inherit; }
.tpb-status { color: var(--ink3); font-size: 11px; font-weight: 600; }
.tpb-toggle.on .tpb-status { color: var(--olive); }

@media (max-width: 768px) {
  .tpb { flex-wrap: wrap; padding: 6px 10px; }
  .tpb-toggle { max-width: 100%; }
}
</style>

<script setup lang="ts">
/**
 * ToolPickerBar.vue — 兼容保留的只读工具状态栏
 * OpenCode 被动工具由官方 runtime、permission/question 机制承载，不由聊天区开关控制。
 */
const statusTitle = 'OpenCode 被动工具由官方运行时和权限系统管理'
</script>

<template>
  <div class="tpb">
    <div class="tpb-status-card" :title="statusTitle">
      <span class="mso tpb-icon">account_tree</span>
      <span class="tpb-label">工具</span>
      <span class="tpb-status">OpenCode 管理</span>
    </div>
  </div>
</template>

<style scoped>
.tpb {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--line);
}

.tpb-status-card {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 10px; border: 1px solid var(--line); border-radius: 6px;
  background: var(--paper); color: var(--ink2);
  font-size: 12px; font-weight: 600; font-family: inherit;
}
.tpb-icon { font-size: 17px; }
.tpb-label { color: inherit; }
.tpb-status { color: var(--ink3); font-size: 11px; font-weight: 600; }

@media (max-width: 768px) {
  .tpb { flex-wrap: wrap; padding: 6px 10px; }
  .tpb-status-card { max-width: 100%; }
}
</style>

<script setup lang="ts">
/**
 * ToolPickerBar.vue — 兼容保留的只读工具状态栏
 * 被动工具由运行内核和权限/提问机制承载，不由聊天区开关控制。
 */
const statusTitle = '韭菜盒子统一管理被动工具和权限'
</script>

<template>
  <div class="tpb">
    <div class="tpb-status-card" :title="statusTitle">
      <JcIcon name="account_tree" class="tpb-icon" />
      <span class="tpb-label">工具</span>
      <span class="tpb-status">韭菜盒子管理</span>
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

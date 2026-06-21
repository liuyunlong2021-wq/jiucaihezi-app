<script setup lang="ts">
import { ref } from 'vue'
import type { OpenCodePermissionReply, OpenCodePermissionRequest } from '@/opencodeClient/interactive'

const props = defineProps<{
  requests: OpenCodePermissionRequest[]
  onDecide?: (requestId: string, reply: OpenCodePermissionReply) => void | Promise<void>
}>()

const responding = ref('')

async function decide(request: OpenCodePermissionRequest, reply: OpenCodePermissionReply) {
  if (responding.value) return
  responding.value = request.id
  try {
    await props.onDecide?.(request.id, reply)
  } finally {
    responding.value = ''
  }
}
</script>

<template>
  <div v-if="props.requests.length" class="permission-dock">
    <div v-for="request in props.requests" :key="request.id" class="permission-card">
      <div class="permission-head">
        <JcIcon name="warning" class="permission-icon" />
        <div class="permission-main">
          <div class="permission-title">OpenCode 请求权限</div>
          <div class="permission-subtitle">{{ request.permission }}</div>
        </div>
      </div>
      <div v-if="request.patterns.length" class="permission-patterns">
        <code v-for="pattern in request.patterns" :key="pattern">{{ pattern }}</code>
      </div>
      <div class="permission-actions">
        <button class="dock-btn ghost" :disabled="!!responding" @click="decide(request, 'reject')">拒绝</button>
        <button class="dock-btn secondary" :disabled="!!responding" @click="decide(request, 'always')">始终允许</button>
        <button class="dock-btn primary" :disabled="!!responding" @click="decide(request, 'once')">本次允许</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.permission-dock {
  display: grid;
  gap: 8px;
  padding: 8px 12px 0;
}
.permission-card {
  border: 1px solid color-mix(in srgb, #c58b00 42%, var(--line));
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 86%, #fff4d6);
  overflow: hidden;
}
.permission-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px 7px;
}
.permission-icon {
  color: #a66a00;
  font-size: 17px;
}
.permission-main {
  min-width: 0;
  flex: 1;
}
.permission-title {
  color: var(--ink1);
  font-size: 12px;
  font-weight: 700;
}
.permission-subtitle {
  color: var(--ink3);
  font-size: 11px;
  overflow-wrap: anywhere;
}
.permission-patterns {
  display: grid;
  gap: 4px;
  padding: 0 10px 9px 35px;
}
.permission-patterns code {
  color: var(--ink2);
  font-size: 11px;
  overflow-wrap: anywhere;
}
.permission-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  border-top: 1px solid color-mix(in srgb, #c58b00 25%, var(--line));
  padding: 8px 10px;
}
.dock-btn {
  border: 1px solid var(--line);
  border-radius: 6px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 5px 9px;
}
.dock-btn:disabled {
  cursor: wait;
  opacity: .6;
}
.dock-btn.ghost {
  background: transparent;
  color: var(--ink2);
}
.dock-btn.secondary {
  background: var(--surface);
  color: var(--olive-dark);
}
.dock-btn.primary {
  border-color: var(--olive);
  background: var(--olive);
  color: white;
}
</style>

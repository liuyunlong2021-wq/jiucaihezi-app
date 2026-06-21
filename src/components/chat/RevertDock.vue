<script setup lang="ts">
import { computed, ref } from 'vue'

export interface RevertItem {
  id: string
  text: string
}

const props = defineProps<{
  items?: RevertItem[]
  restoring?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  restore: [id: string]
}>()

const collapsed = ref(true)
const list = computed(() => props.items || [])
const preview = computed(() => list.value[0]?.text || '')
</script>

<template>
  <div v-if="list.length" class="revert-dock" data-component="session-revert-dock">
    <button class="revert-head" type="button" @click="collapsed = !collapsed">
      <JcIcon name="history" />
      <span>{{ list.length }} 条 Revert 可恢复项</span>
      <span v-if="collapsed && preview" class="revert-preview">{{ preview }}</span>
      <JcIcon :name="collapsed ? 'expand_more' : 'expand_less'" />
    </button>
    <div v-if="!collapsed" class="revert-list">
      <div v-for="item in list" :key="item.id" class="revert-item">
        <span class="revert-text">{{ item.text }}</span>
        <button
          type="button"
          :disabled="disabled || Boolean(restoring)"
          @click="emit('restore', item.id)"
        >
          {{ restoring === item.id ? '恢复中' : '恢复消息' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.revert-dock {
  border-top: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 90%, var(--olive-pale));
  padding: 7px 12px;
}
.revert-head {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink2);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 750;
}
.revert-preview {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink3);
  text-align: left;
  font-weight: 650;
}
.revert-list {
  display: grid;
  gap: 6px;
  margin-top: 7px;
}
.revert-item {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  padding: 7px 8px;
}
.revert-text {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink2);
  font-size: 12px;
}
.revert-item button {
  border: 1px solid var(--olive);
  border-radius: 7px;
  background: var(--olive);
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 800;
  padding: 5px 9px;
}
.revert-item button:disabled {
  opacity: .55;
  cursor: default;
}
</style>

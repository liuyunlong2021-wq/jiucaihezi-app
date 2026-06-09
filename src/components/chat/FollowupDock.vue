<script setup lang="ts">
import { computed, ref } from 'vue'

export interface FollowupItem {
  id: string
  text: string
}

const props = defineProps<{
  items?: FollowupItem[]
  sending?: string
}>()

const emit = defineEmits<{
  send: [id: string]
  edit: [id: string]
}>()

const collapsed = ref(false)
const list = computed(() => props.items || [])
const preview = computed(() => list.value[0]?.text || '')
</script>

<template>
  <div v-if="list.length" class="followup-dock" data-component="session-followup-dock">
    <button class="followup-head" type="button" @click="collapsed = !collapsed">
      <span class="mso">playlist_add</span>
      <span>{{ list.length }} 条后续操作建议</span>
      <span v-if="collapsed && preview" class="followup-preview">{{ preview }}</span>
      <span class="mso">{{ collapsed ? 'expand_more' : 'expand_less' }}</span>
    </button>
    <div v-if="!collapsed" class="followup-list">
      <div v-for="item in list" :key="item.id" class="followup-item">
        <span class="followup-text">{{ item.text }}</span>
        <button type="button" :disabled="Boolean(sending)" @click="emit('send', item.id)">
          {{ sending === item.id ? '发送中' : '发送建议' }}
        </button>
        <button type="button" class="ghost" :disabled="Boolean(sending)" @click="emit('edit', item.id)">
          编辑后发送
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.followup-dock {
  border-top: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 92%, var(--olive-pale));
  padding: 7px 12px;
}
.followup-head {
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
.followup-preview {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink3);
  text-align: left;
  font-weight: 650;
}
.followup-list {
  display: grid;
  gap: 6px;
  margin-top: 7px;
}
.followup-item {
  display: flex;
  align-items: center;
  gap: 7px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  padding: 7px 8px;
}
.followup-text {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink2);
  font-size: 12px;
}
.followup-item button {
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
.followup-item button.ghost {
  background: transparent;
  color: var(--olive-dark);
}
.followup-item button:disabled {
  opacity: .55;
  cursor: default;
}
</style>

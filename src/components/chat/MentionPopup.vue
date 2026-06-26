<script setup lang="ts">
import { computed, ref, watch } from 'vue'

export interface MentionItem {
  type: 'file' | 'agent'
  value: string
  label: string
  group: string
}

const props = defineProps<{
  text: string
  cursorPos: number
  visible: boolean
  items: MentionItem[]
  selectedIdx: number
}>()

const emit = defineEmits<{
  (e: 'select', payload: { type: 'file' | 'agent'; value: string; label: string }): void
  (e: 'close'): void
  (e: 'update:selectedIdx', idx: number): void
}>()

const filter = ref('')

const triggerRange = computed(() => {
  const text = props.text
  const pos = props.cursorPos
  for (let i = pos - 1; i >= 0; i--) {
    if (text[i] === '@' && (i === 0 || text[i - 1] === ' ' || text[i - 1] === '\n')) {
      return { start: i, filter: text.slice(i + 1, pos) }
    }
  }
  return null
})

watch(() => props.visible, (v) => {
  if (v) {
    const t = triggerRange.value
    filter.value = t?.filter || ''
  }
})

const mentions = computed(() => {
  const f = filter.value.toLowerCase()
  return props.items.filter(item =>
    !f || item.label.toLowerCase().includes(f) || item.value.toLowerCase().includes(f)
  )
})

const grouped = computed(() => {
  const map = new Map<string, MentionItem[]>()
  for (const m of mentions.value) {
    const g = map.get(m.group) || []
    g.push(m)
    map.set(m.group, g)
  }
  return [...map.entries()]
})

function selectMention(m: MentionItem) {
  emit('select', { type: m.type, value: m.value, label: m.label })
}
</script>

<template>
  <div v-if="visible && mentions.length > 0" class="mention-popup">
    <div v-for="[group, items] in grouped" :key="group" class="mention-group">
      <div class="mention-group-label">{{ group }}</div>
      <div
        v-for="(m, idx) in items"
        :key="m.value"
        class="mention-item"
        :class="{ selected: mentions.indexOf(m) === props.selectedIdx }"
        @click="selectMention(m)"
        @mouseenter="$emit('update:selectedIdx', mentions.indexOf(m))"
      >
        <JcIcon :name="m.type === 'file' ? 'description' : 'psychology'" class="mention-icon" />
        <span class="mention-label">{{ m.label }}</span>
        <span class="mention-type">{{ m.type === 'file' ? '@file' : '@agent' }}</span>
      </div>
    </div>
    <div class="mention-hint">↑↓ 选择 · ↵ 确认 · Esc 关闭</div>
  </div>
</template>

<style scoped>
.mention-popup {
  position: absolute;
  bottom: 100%;
  left: 12px;
  margin-bottom: 4px;
  min-width: 240px;
  max-width: 360px;
  max-height: 260px;
  overflow-y: auto;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.1);
  z-index: 100;
  padding: 4px 0;
}
.mention-group-label {
  padding: 4px 12px 2px;
  font-size: 10px; font-weight: 700; color: var(--ink3);
  text-transform: uppercase; letter-spacing: 0.5px;
}
.mention-item {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 12px; cursor: pointer; font-size: 13px;
}
.mention-item:hover, .mention-item.selected {
  background: color-mix(in srgb, var(--olive) 15%, transparent);
}
.mention-icon { font-size: 14px; color: var(--ink3); flex-shrink: 0; }
.mention-label { flex: 1; color: var(--ink1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mention-type { font-size: 10px; color: var(--ink3); padding: 1px 5px; border-radius: 3px; background: var(--surface); }
.mention-hint { padding: 4px 12px 0; font-size: 10px; color: var(--ink3); text-align: center; border-top: 1px solid var(--line); margin-top: 4px; }
</style>

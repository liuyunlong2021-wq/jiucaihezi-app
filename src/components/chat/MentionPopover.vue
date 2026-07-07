<script setup lang="ts">
/**
 * MentionPopover — 照抄 OpenCode slash-popover.tsx
 * 支持 @ (agent/file/resource/reference) 和 / (slash commands)
 */
import { computed } from 'vue'
import JcIcon from '@/components/icons/JcIcon.vue'
import type { AtOption } from '@/types/mention'
import type { SlashCommand } from '@/types/mention'

const props = defineProps<{
  popover: 'at' | 'slash' | null
  atFlat: AtOption[]
  atActive: string
  atKey: (item: AtOption) => string
  slashFlat: SlashCommand[]
  slashActive: string
  slashKey: (item: SlashCommand) => string
}>()

const emit = defineEmits<{
  (e: 'atSelect', item: AtOption): void
  (e: 'slashSelect', item: SlashCommand): void
  (e: 'setAtActive', id: string): void
  (e: 'setSlashActive', id: string): void
}>()

const visible = computed(() => props.popover !== null)
const atItems = computed(() => props.atFlat.slice(0, 10))
const hasAtItems = computed(() => atItems.value.length > 0)
</script>

<template>
  <div
    v-if="visible"
    class="mention-popover"
    @mousedown.prevent
  >
    <!-- @ 提及 -->
    <template v-if="popover === 'at'">
      <div v-if="!hasAtItems" class="mention-empty">无匹配结果</div>
      <button
        v-for="item in atItems"
        :key="atKey(item)"
        class="mention-item"
        :class="{ active: atActive === atKey(item) }"
        @click="emit('atSelect', item)"
        @pointermove="emit('setAtActive', atKey(item))"
      >
        <!-- agent -->
        <template v-if="item.type === 'agent'">
          <JcIcon name="psychology" class="mention-icon agent-icon" />
          <span class="mention-label">@{{ item.name }}</span>
        </template>

        <!-- resource -->
        <template v-else-if="item.type === 'resource'">
          <JcIcon name="extension" class="mention-icon resource-icon" />
          <span class="mention-label">@{{ item.name }}</span>
          <span v-if="item.description" class="mention-desc">{{ item.description }}</span>
        </template>

        <!-- reference -->
        <template v-else-if="item.type === 'reference'">
          <JcIcon name="folder" class="mention-icon ref-icon" />
          <span class="mention-label">@{{ item.name }}</span>
          <span v-if="item.description" class="mention-desc">{{ item.description }}</span>
        </template>

        <!-- file -->
        <template v-else>
          <JcIcon name="description" class="mention-icon file-icon" />
          <span class="mention-label">@{{ item.display }}</span>
        </template>
      </button>
    </template>

    <!-- / 斜杠指令 -->
    <template v-if="popover === 'slash'">
      <button
        v-for="cmd in slashFlat"
        :key="slashKey(cmd)"
        class="mention-item"
        :class="{ active: slashActive === slashKey(cmd) }"
        @click="emit('slashSelect', cmd)"
        @pointermove="emit('setSlashActive', slashKey(cmd))"
      >
        <JcIcon name="terminal" class="mention-icon slash-icon" />
        <span class="mention-label">/{{ cmd.title }}</span>
        <span v-if="cmd.description" class="mention-desc">{{ cmd.description }}</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.mention-popover {
  position: absolute;
  bottom: 100%;
  left: 12px;
  margin-bottom: 4px;
  min-width: 240px;
  max-width: 400px;
  max-height: 260px;
  overflow-y: auto;
  z-index: 100;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.18);
  padding: 4px;
  display: flex;
  flex-direction: column;
}
.mention-empty {
  padding: 8px 12px;
  font-size: 13px;
  color: var(--ink3);
}
.mention-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 4px 8px;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--ink1);
  text-align: left;
}
.mention-item.active {
  background: var(--olive-pale);
}
.mention-icon {
  flex-shrink: 0;
  font-size: 16px;
}
.agent-icon { color: var(--olive); }
.resource-icon { color: var(--olive-dark); }
.ref-icon { color: var(--olive); }
.file-icon { color: var(--ink2); }
.slash-icon { color: var(--ink3); }
.mention-label {
  white-space: nowrap;
}
.mention-desc {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--ink3);
  margin-left: 4px;
}
</style>

<script setup lang="ts">
import { computed } from 'vue'
import type { CentralSkillBundle } from '@/types/skillsManage'

const props = defineProps<{
  bundle: CentralSkillBundle
  previewNames?: string[]
  deleting?: boolean
}>()

const emit = defineEmits<{
  (e: 'open', bundle: CentralSkillBundle): void
  (e: 'delete', bundle: CentralSkillBundle): void
}>()

const preview = computed(() => (props.previewNames || []).slice(0, 3).join('、'))
</script>

<template>
  <article class="folder-card">
    <button type="button" class="folder-main" @click="emit('open', bundle)">
      <div class="folder-title">
        <span class="mso">folder_open</span>
        <h4>{{ bundle.name }}</h4>
        <span v-if="bundle.isSymlink" class="symlink-pill">
          <span class="mso">link</span>
          symlink
        </span>
      </div>
      <p class="path">{{ bundle.path }}</p>
      <div class="meta">
        <span>{{ bundle.skillCount }} 个 Skill</span>
        <span v-if="bundle.linkedAgentCount">{{ bundle.linkedAgentCount }} 个安装目标</span>
        <span v-if="bundle.readOnlyAgentCount">{{ bundle.readOnlyAgentCount }} 共享 / 自动包含</span>
      </div>
      <p v-if="preview" class="preview">{{ preview }}</p>
    </button>
    <button
      type="button"
      class="delete"
      title="删除 Skill 文件夹"
      :disabled="deleting"
      @click="emit('delete', bundle)"
    >
      <span class="mso" :class="{ spin: deleting }">{{ deleting ? 'progress_activity' : 'delete' }}</span>
    </button>
  </article>
</template>

<style scoped>
.folder-card {
  min-height: 132px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 30px;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--paper) 88%, var(--surface));
  box-shadow: var(--jc-shadow-sm);
}
.folder-main {
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.folder-title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
.folder-title > .mso {
  color: var(--olive-dark);
  font-size: 18px;
}
h4 {
  margin: 0;
  min-width: 0;
  color: var(--ink1);
  font-size: 14px;
  font-weight: 950;
  overflow-wrap: anywhere;
}
.symlink-pill {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--olive-pale);
  color: var(--olive-dark);
  font-size: 10px;
  font-weight: 900;
}
.symlink-pill .mso { font-size: 12px; }
.path,
.preview {
  margin: 7px 0 0;
  color: var(--ink3);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 8px;
}
.meta span {
  padding: 3px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface-alt) 86%, transparent);
  color: var(--ink3);
  font-size: 11px;
  font-weight: 850;
}
.delete {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ink3);
  cursor: pointer;
}
.delete:hover:not(:disabled) {
  background: var(--olive-pale);
  color: var(--olive-dark);
}
.delete:disabled {
  opacity: .5;
  cursor: default;
}
.delete .mso { font-size: 16px; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>

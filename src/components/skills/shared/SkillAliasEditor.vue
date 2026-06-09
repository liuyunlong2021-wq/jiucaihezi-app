<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useSkillsManageStore } from '@/stores/skillsManageStore'
import type { SkillWithLinks } from '@/types/skillsManage'

const props = defineProps<{
  skill: Pick<SkillWithLinks, 'id' | 'name'>
}>()

const emit = defineEmits<{
  (e: 'saved'): void
}>()

const store = useSkillsManageStore()
const draft = ref('')
const error = ref('')

const currentAlias = computed(() => store.getSkillDisplayAlias(props.skill.id)?.alias || '')

watch(
  () => [props.skill.id, currentAlias.value],
  () => {
    draft.value = currentAlias.value
    error.value = ''
  },
  { immediate: true }
)

function saveAlias() {
  error.value = ''
  try {
    store.setSkillDisplayAlias(props.skill.id, draft.value)
    emit('saved')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err || '保存显示别名失败')
  }
}

function clearAlias() {
  error.value = ''
  store.clearSkillDisplayAlias(props.skill.id)
  draft.value = ''
  emit('saved')
}
</script>

<template>
  <section class="alias-editor" aria-label="显示别名">
    <label>
      <span>显示别名</span>
      <input
        v-model="draft"
        type="text"
        placeholder="例如：帮我整理文件"
        @keydown.enter.prevent="saveAlias"
      />
    </label>
    <div class="alias-official">
      官方 Skill name:
      <code>{{ skill.name }}</code>
    </div>
    <p v-if="error" class="alias-error">{{ error }}</p>
    <div class="alias-actions">
      <button type="button" class="primary" @click="saveAlias">
        <span class="mso">save</span>
        保存
      </button>
      <button type="button" :disabled="!currentAlias && !draft" @click="clearAlias">
        <span class="mso">backspace</span>
        清空
      </button>
    </div>
  </section>
</template>

<style scoped>
.alias-editor {
  display: grid;
  gap: 8px;
  min-width: 0;
}
label {
  display: grid;
  gap: 5px;
  color: var(--ink2);
  font-size: 12px;
  font-weight: 900;
}
input {
  min-width: 0;
  height: 34px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink1);
  font: inherit;
}
input:focus {
  outline: 2px solid color-mix(in srgb, var(--olive) 26%, transparent);
  border-color: var(--olive);
}
.alias-official {
  color: var(--ink3);
  font-size: 11px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
code {
  color: var(--ink2);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.alias-error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}
.alias-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
button {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink2);
  font-weight: 900;
  cursor: pointer;
}
button.primary {
  border-color: color-mix(in srgb, var(--olive) 48%, var(--border));
  background: var(--olive-pale);
  color: var(--olive-dark);
}
button:disabled {
  opacity: .55;
  cursor: default;
}
.mso { font-size: 15px; }
</style>

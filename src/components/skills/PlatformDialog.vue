<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AgentWithStatus, CustomPlatformConfig } from '@/types/skillsManage'

const props = defineProps<{
  platform: AgentWithStatus | null
  saving?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', payload: { agentId?: string; config: CustomPlatformConfig }): void
}>()

const displayName = ref('')
const globalSkillsDir = ref('')
const category = ref('coding')
const validationError = ref('')

const isEditMode = computed(() => Boolean(props.platform))

watch(
  () => props.platform,
  () => {
    displayName.value = props.platform?.display_name || ''
    globalSkillsDir.value = props.platform?.global_skills_dir || ''
    category.value = props.platform?.category || 'coding'
    validationError.value = ''
  },
  { immediate: true }
)

function submit() {
  const name = displayName.value.trim()
  const dir = globalSkillsDir.value.trim()
  if (!name || !dir) {
    validationError.value = 'Platform 名称和 Skill 目录不能为空。'
    return
  }
  emit('save', {
    agentId: props.platform?.id,
    config: {
      display_name: name,
      global_skills_dir: dir,
      category: category.value.trim() || 'coding',
    },
  })
}
</script>

<template>
  <div class="dialog-backdrop" @click.self="emit('close')">
    <section class="dialog" role="dialog" aria-modal="true" aria-label="编辑 custom Platform">
      <header>
        <div>
          <h3>{{ isEditMode ? '编辑 custom Platform' : '添加 custom Platform' }}</h3>
          <p>注册自定义 Platform，并指定它读取 Skill 的目录。</p>
        </div>
        <button type="button" title="关闭" @click="emit('close')"><span class="mso">close</span></button>
      </header>
      <main>
        <label>
          <span>Platform 名称</span>
          <input v-model="displayName" type="text" placeholder="例如：Lab Platform" :disabled="saving" @input="validationError = ''" />
        </label>
        <label>
          <span>Skill 目录</span>
          <input v-model="globalSkillsDir" type="text" placeholder="例如：~/.lab/skills" :disabled="saving" @input="validationError = ''" />
        </label>
        <label>
          <span>分类</span>
          <select v-model="category" :disabled="saving">
            <option value="coding">coding</option>
            <option value="lobster">lobster</option>
            <option value="other">other</option>
          </select>
        </label>
        <p v-if="validationError" class="error">{{ validationError }}</p>
      </main>
      <footer>
        <button type="button" :disabled="saving" @click="emit('close')">取消</button>
        <button type="button" class="primary" :disabled="saving" @click="submit">
          <span class="mso" :class="{ spin: saving }">{{ saving ? 'progress_activity' : 'save' }}</span>
          保存
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.dialog-backdrop { position: absolute; inset: 0; z-index: 12; display: grid; place-items: center; padding: 16px; background: color-mix(in srgb, var(--ink1) 18%, transparent); }
.dialog { width: min(540px, 100%); display: flex; flex-direction: column; gap: 14px; padding: 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: var(--jc-shadow-lg); }
header, footer { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
h3 { margin: 0; color: var(--ink1); font-size: 15px; font-weight: 950; letter-spacing: 0; }
p { margin: 4px 0 0; color: var(--ink3); font-size: 12px; line-height: 1.45; }
header button { width: 32px; height: 32px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink2); cursor: pointer; }
main { display: grid; gap: 10px; }
label { display: grid; gap: 5px; color: var(--ink2); font-size: 12px; font-weight: 850; }
input, select { height: 34px; min-width: 0; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink1); padding: 0 9px; }
.error { color: var(--jc-error); }
footer { justify-content: flex-end; }
footer button { min-height: 32px; display: inline-flex; align-items: center; gap: 5px; padding: 0 11px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink2); font-weight: 850; cursor: pointer; }
footer button.primary { border-color: color-mix(in srgb, var(--olive) 45%, var(--border)); background: var(--olive-pale); color: var(--olive-dark); }
button:disabled { opacity: .55; cursor: default; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>

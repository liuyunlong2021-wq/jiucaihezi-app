<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AgentWithStatus, BatchInstallResult, SkillWithLinks } from '@/types/skillsManage'

const props = defineProps<{
  skill: SkillWithLinks | null
  agents: AgentWithStatus[]
  installing?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'install', payload: { skill: SkillWithLinks; agentIds: string[]; method: 'symlink' | 'copy' }): void
}>()

const selectedAgentIds = ref<string[]>([])
const method = ref<'symlink' | 'copy'>('symlink')
const error = ref('')
const lastResult = ref<BatchInstallResult | null>(null)

const targetAgents = computed(() =>
  props.agents.filter((agent) => agent.is_enabled && agent.id !== 'central' && agent.category !== 'central')
)

watch(
  () => props.skill?.id,
  () => {
    selectedAgentIds.value = []
    method.value = 'symlink'
    error.value = ''
    lastResult.value = null
  },
  { immediate: true }
)

function toggleAgent(agentId: string, checked: boolean) {
  const next = new Set(selectedAgentIds.value)
  if (checked) next.add(agentId)
  else next.delete(agentId)
  selectedAgentIds.value = Array.from(next)
}

function confirmInstall() {
  error.value = ''
  if (!props.skill) return
  const readOnly = new Set(props.skill.read_only_agents || [])
  const agentIds = selectedAgentIds.value.filter((agentId) => !readOnly.has(agentId))
  if (agentIds.length === 0) {
    error.value = '请选择至少一个可安装目标。'
    return
  }
  emit('install', { skill: props.skill, agentIds, method: method.value })
}

defineExpose({
  setResult(result: BatchInstallResult | null) {
    lastResult.value = result
  },
})
</script>

<template>
  <div v-if="skill" class="dialog-backdrop" @click.self="emit('close')">
    <section class="install-dialog" role="dialog" aria-modal="true" aria-label="安装 Skill">
      <header>
        <div>
          <h3>安装 {{ skill.name }}</h3>
          <p>选择要安装到的工具，并选择 symlink 或 copy。</p>
        </div>
        <button type="button" title="关闭" @click="emit('close')"><JcIcon name="close" /></button>
      </header>

      <div class="agent-grid" role="group" aria-label="选择安装目标">
        <label v-for="agent in targetAgents" :key="agent.id" :class="{ readonly: skill.read_only_agents?.includes(agent.id) }">
          <input
            type="checkbox"
            :checked="selectedAgentIds.includes(agent.id)"
            :disabled="skill.read_only_agents?.includes(agent.id)"
            @change="toggleAgent(agent.id, ($event.target as HTMLInputElement).checked)"
          />
          <span>
            <strong>{{ agent.display_name }}</strong>
            <small>
              {{ skill.read_only_agents?.includes(agent.id) ? '共享 / 自动包含' : skill.linked_agents.includes(agent.id) ? '已安装' : agent.is_detected ? '可安装' : '未检测到' }}
            </small>
          </span>
        </label>
        <p v-if="targetAgents.length === 0" class="empty">暂无可安装目标。</p>
      </div>

      <div class="method-box">
        <label>
          <input v-model="method" type="radio" value="symlink" />
          <span><strong>symlink</strong><small>推荐方式，只创建引用，不复制文件。</small></span>
        </label>
        <label>
          <input v-model="method" type="radio" value="copy" />
          <span><strong>copy</strong><small>复制一份 Skill 到目标工具。</small></span>
        </label>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="lastResult?.failed.length" class="error">
        部分工具安装失败：{{ lastResult.failed.map(item => item.agent_id).join('、') }}
      </p>

      <footer>
        <button type="button" @click="emit('close')">取消</button>
        <button type="button" class="primary" :disabled="installing" @click="confirmInstall">
          <JcIcon :name="installing ? 'progress_activity' : 'add_link'" :class="{ spin: installing }" />
          安装
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.dialog-backdrop {
  position: absolute;
  inset: 0;
  z-index: 7;
  display: grid;
  place-items: center;
  padding: 16px;
  background: color-mix(in srgb, var(--ink1) 18%, transparent);
}
.install-dialog {
  width: min(620px, 100%);
  max-height: min(720px, calc(100vh - 32px));
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--jc-shadow-lg);
}
header {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
h3 { margin: 0; font-size: 15px; font-weight: 950; }
p { margin: 4px 0 0; color: var(--ink3); font-size: 12px; line-height: 1.45; }
header button {
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
.agent-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  overflow: auto;
}
.agent-grid label,
.method-box label {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
}
.agent-grid label.readonly { opacity: .68; }
label span {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
strong { font-size: 12px; color: var(--ink1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
small { font-size: 11px; color: var(--ink3); }
.method-box { display: grid; gap: 8px; }
.error {
  margin: 0;
  color: var(--jc-error);
  font-size: 12px;
}
.empty {
  grid-column: 1 / -1;
  padding: 14px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  text-align: center;
}
footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
footer button {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 11px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink2);
  font-weight: 900;
  cursor: pointer;
}
footer button.primary {
  border-color: color-mix(in srgb, var(--olive) 48%, var(--border));
  background: var(--olive-pale);
  color: var(--olive-dark);
}
button:disabled {
  opacity: .55;
  cursor: default;
}
.mso { font-size: 15px; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 640px) {
  .agent-grid { grid-template-columns: 1fr; }
}
</style>

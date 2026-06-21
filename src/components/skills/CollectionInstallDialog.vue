<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AgentWithStatus, CollectionBatchInstallResult } from '@/types/skillsManage'
import { getCollectionInstallTargets } from '@/utils/collectionsViewModel'

const props = defineProps<{
  collectionName: string
  skillCount: number
  agents: AgentWithStatus[]
  centralRoot: string
  installing?: boolean
  result?: CollectionBatchInstallResult | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'install', agentIds: string[]): void
}>()

const selectedAgentIds = ref<string[]>([])
const error = ref('')

const targetAgents = computed(() => getCollectionInstallTargets(props.agents))

watch(
  () => props.collectionName,
  () => {
    selectedAgentIds.value = targetAgents.value.map(agent => agent.id)
    error.value = ''
  },
  { immediate: true }
)

function toggle(agentId: string, checked: boolean) {
  const next = new Set(selectedAgentIds.value)
  if (checked) next.add(agentId)
  else next.delete(agentId)
  selectedAgentIds.value = Array.from(next)
}

function install() {
  if (selectedAgentIds.value.length === 0) {
    error.value = '请选择至少一个 Platform。'
    return
  }
  error.value = ''
  emit('install', selectedAgentIds.value)
}
</script>

<template>
  <div class="dialog-backdrop" @click.self="emit('close')">
    <section class="dialog" role="dialog" aria-modal="true" aria-label="批量安装 Collection">
      <header>
        <div>
          <h3>批量安装 {{ collectionName }}</h3>
          <p>将 {{ skillCount }} 个 Skill 安装到选中的 Platform。</p>
        </div>
        <button type="button" title="关闭" @click="emit('close')"><JcIcon name="close" /></button>
      </header>

      <main>
        <label v-for="agent in targetAgents" :key="agent.id" class="agent-row">
          <input
            type="checkbox"
            :checked="selectedAgentIds.includes(agent.id)"
            :disabled="installing"
            @change="toggle(agent.id, ($event.target as HTMLInputElement).checked)"
          />
          <span>
            <strong>{{ agent.display_name }}</strong>
            <small>{{ agent.global_skills_dir }}</small>
          </span>
        </label>
        <p v-if="targetAgents.length === 0" class="empty">暂无可安装 Platform。</p>

        <section v-if="result" class="result">
          <strong>安装结果</strong>
          <p>{{ result.succeeded.length }} 个成功 · {{ result.failed.length }} 个失败</p>
          <ul v-if="result.failed.length">
            <li v-for="failure in result.failed" :key="failure.agent_id">
              <span>{{ failure.agent_id }}</span>
              <em>{{ failure.error }}</em>
            </li>
          </ul>
        </section>

        <p v-if="error" class="error">{{ error }}</p>
      </main>

      <footer>
        <button type="button" :disabled="installing" @click="emit('close')">关闭</button>
        <button v-if="!result || result.failed.length > 0" type="button" class="primary" :disabled="installing || selectedAgentIds.length === 0" @click="install">
          <JcIcon :name="installing ? 'progress_activity' : 'install_desktop'" :class="{ spin: installing }" />
          安装
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.dialog-backdrop { position: absolute; inset: 0; z-index: 8; display: grid; place-items: center; padding: 16px; background: color-mix(in srgb, var(--ink1) 18%, transparent); }
.dialog { width: min(620px, 100%); max-height: min(720px, calc(100vh - 32px)); display: flex; flex-direction: column; min-height: 0; gap: 12px; padding: 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: var(--jc-shadow-lg); }
header, footer { flex: 0 0 auto; display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
h3 { margin: 0; color: var(--ink1); font-size: 15px; font-weight: 950; }
p { margin: 4px 0 0; color: var(--ink3); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
header button, footer button { min-height: 32px; display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink2); padding: 0 10px; font-weight: 850; cursor: pointer; }
header button { width: 32px; padding: 0; justify-content: center; }
main { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
.agent-row { min-width: 0; display: flex; align-items: center; gap: 8px; padding: 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); }
.agent-row span { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
strong { color: var(--ink1); font-size: 13px; }
small { color: var(--ink3); font-size: 11px; overflow-wrap: anywhere; }
.result { padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); }
ul { margin: 8px 0 0; padding: 0; list-style: none; display: grid; gap: 6px; }
li { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 8px; font-size: 12px; }
li span { color: var(--ink2); font-weight: 850; }
li em { color: var(--jc-error); font-style: normal; overflow-wrap: anywhere; }
.error { color: var(--jc-error); }
.empty { padding: 16px; border: 1px dashed var(--border); border-radius: 8px; text-align: center; }
footer { justify-content: flex-end; }
footer button.primary { border-color: color-mix(in srgb, var(--olive) 45%, var(--border)); background: var(--olive-pale); color: var(--olive-dark); }
button:disabled { opacity: .55; cursor: default; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>

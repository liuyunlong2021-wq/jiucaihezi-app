<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSkillsManageStore } from '@/stores/skillsManageStore'

const store = useSkillsManageStore()
const {
  isLoadingSkillExplanation,
  selectedSkillContent,
  selectedSkillDetail,
  skillExplanations,
} = storeToRefs(store)

const localError = ref('')
const lastAction = ref('')
const lang = 'zh'

const explanationKey = computed(() =>
  selectedSkillDetail.value ? `${selectedSkillDetail.value.id}:${lang}` : ''
)

const summary = computed(() =>
  explanationKey.value ? skillExplanations.value[explanationKey.value] || '' : ''
)

async function loadCachedSummary() {
  if (!selectedSkillDetail.value) return
  localError.value = ''
  try {
    await store.getSkillExplanation(selectedSkillDetail.value.id, lang)
  } catch (error) {
    localError.value = error instanceof Error ? error.message : String(error)
  }
}

async function generateSummary() {
  if (!selectedSkillDetail.value) return
  localError.value = ''
  lastAction.value = ''
  try {
    await store.explainSkill(selectedSkillDetail.value.id, selectedSkillContent.value, lang)
    lastAction.value = '已请求生成 AI Summary，生成完成后可刷新查看缓存结果。'
  } catch (error) {
    localError.value = error instanceof Error ? error.message : String(error)
  }
}

async function refreshSummary() {
  if (!selectedSkillDetail.value) return
  localError.value = ''
  lastAction.value = ''
  try {
    await store.refreshSkillExplanation(selectedSkillDetail.value.id, selectedSkillContent.value, lang)
    await loadCachedSummary()
    lastAction.value = '已刷新 AI Summary。'
  } catch (error) {
    localError.value = error instanceof Error ? error.message : String(error)
  }
}

onMounted(loadCachedSummary)

watch(() => selectedSkillDetail.value?.id, () => {
  lastAction.value = ''
  loadCachedSummary()
})
</script>

<template>
  <section class="ai-panel">
    <header class="ai-head">
      <div>
        <h4>AI Summary</h4>
        <p>用 AI 帮你概括这个 Skill 的用途、触发场景和注意事项。</p>
      </div>
      <div class="ai-actions">
        <button type="button" :disabled="isLoadingSkillExplanation || !selectedSkillDetail" @click="generateSummary">
          <span class="mso">auto_awesome</span>
          生成
        </button>
        <button type="button" :disabled="isLoadingSkillExplanation || !selectedSkillDetail" @click="refreshSummary">
          <span class="mso" :class="{ spin: isLoadingSkillExplanation }">refresh</span>
          刷新
        </button>
      </div>
    </header>

    <div v-if="localError" class="inline-error">{{ localError }}</div>
    <div v-else-if="lastAction" class="inline-status">{{ lastAction }}</div>

    <div class="summary-box">
      <div v-if="isLoadingSkillExplanation" class="state">
        <span class="mso spin">progress_activity</span>
        正在读取 AI Summary...
      </div>
      <pre v-else-if="summary">{{ summary }}</pre>
      <div v-else class="empty">
        还没有 AI Summary。可以先生成，或刷新已有缓存。
      </div>
    </div>
  </section>
</template>

<style scoped>
.ai-panel { height: 100%; min-height: 0; display: flex; flex-direction: column; gap: 10px; }
.ai-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
h4 { margin: 0; font-size: 13px; color: var(--ink1); }
p { margin: 4px 0 0; color: var(--ink3); font-size: 12px; line-height: 1.5; }
.ai-actions { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
.ai-actions button {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink2);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}
.ai-actions button:disabled { opacity: .55; cursor: not-allowed; }
.inline-error,
.inline-status {
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
}
.inline-error {
  border: 1px solid color-mix(in srgb, var(--danger) 30%, var(--border));
  background: color-mix(in srgb, var(--danger) 8%, var(--paper));
  color: var(--danger);
}
.inline-status {
  border: 1px solid color-mix(in srgb, var(--olive) 25%, var(--border));
  background: var(--olive-pale);
  color: var(--olive-dark);
}
.summary-box {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
}
pre {
  margin: 0;
  padding: 12px;
  color: var(--ink1);
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.empty,
.state {
  min-height: 160px;
  display: grid;
  place-items: center;
  padding: 14px;
  color: var(--ink3);
  font-size: 12px;
  text-align: center;
}
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>

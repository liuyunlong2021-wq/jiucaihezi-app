<script setup lang="ts">
/**
 * EvolutionDiff.vue — 多源进化 diff 面板（darwin-skill keep/revert UI）
 *
 * 知识来源：对话历史（始终可用）+ 知识库 + 编辑器 + 用户口述
 */
import { ref, computed, onMounted } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import { useVaultStore } from '@/stores/vaultStore'
import { useSkillEvolution, keepEvolution } from '@/composables/useSkillEvolution'
import type { SkillConfig } from '@/types/skill'

const props = defineProps<{ skill: SkillConfig }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const store = useAgentStore()
const vaultStore = useVaultStore()
const {
  isEvolving, evolveStep, evolveStepLabels,
  proposedSkillContent, evolutionSummary, sourceStatus,
  evolveSkill, collectConversationHistory, collectVaultKnowledge, collectEditorContent,
} = useSkillEvolution()

const viewMode = ref<'idle' | 'evolving' | 'diff'>('idle')
const userNotes = ref('')

// ─── 自动收集可用源 ───
const conversationText = ref('')
const vaultText = ref('')
const editorText = ref('')

onMounted(async () => {
  // 收集对话历史
  conversationText.value = await collectConversationHistory(props.skill.id)
  // 收集知识库（如已绑定）
  const vaultId = vaultStore.activeVaultId
  if (vaultId) {
    vaultText.value = await collectVaultKnowledge(vaultId)
  }
  // 收集编辑器
  editorText.value = await collectEditorContent()
})

const hasAnySource = computed(() =>
  !!conversationText.value || !!vaultText.value || !!editorText.value || !!userNotes.value.trim()
)

// ─── 开始进化 ───
async function startEvolution() {
  viewMode.value = 'evolving'
  const result = await evolveSkill(props.skill, {
    conversationHistory: conversationText.value,
    vaultKnowledge: vaultText.value,
    editorContent: editorText.value,
    userNotes: userNotes.value,
  })
  if (result.success) {
    viewMode.value = 'diff'
  } else {
    viewMode.value = 'idle'
  }
}

// ─── keep ───
function applyEvolution() {
  const updated = keepEvolution(props.skill, proposedSkillContent.value, evolutionSummary.value)
  store.updateSkill(props.skill.id, {
    skillContent: updated.skillContent,
    version: updated.version,
    updatedAt: updated.updatedAt,
    evolutionLog: updated.evolutionLog,
  })
  emit('close')
}

// ─── revert ───
function cancelEvolution() {
  viewMode.value = 'idle'
  proposedSkillContent.value = ''
}
</script>

<template>
  <div class="evo-panel">
    <div class="evo-head">
      <span class="mso">auto_fix</span>
      <span>进化搭子 — {{ skill.name }}</span>
      <span class="evo-version">v{{ skill.version }}</span>
      <button class="evo-close" @click="emit('close')">&times;</button>
    </div>

    <!-- Idle: 展示源状态 -->
    <div v-if="viewMode === 'idle'" class="evo-body">
      <div class="evo-desc">
        <p>AI 会分析所有可用的反馈来源，自动优化搭子的 SKILL.md。</p>
      </div>

      <div class="evo-sources">
        <div class="evo-src" :class="{ ok: !!conversationText, empty: !conversationText }">
          <span class="mso">chat</span>
          <span>{{ conversationText ? `📊 对话记录: ${sourceStatus.conversationCount} 个会话可用` : '📊 暂无对话记录' }}</span>
        </div>
        <div class="evo-src" :class="{ ok: !!vaultText, empty: !vaultText }">
          <span class="mso">psychology</span>
          <span>{{ vaultText ? `📚 知识库: ${sourceStatus.vaultPageCount} 页 wiki` : '📚 未绑定知识库' }}</span>
        </div>
        <div class="evo-src" :class="{ ok: !!editorText, empty: !editorText }">
          <span class="mso">edit_note</span>
          <span>{{ editorText ? '📝 编辑器有打开文档' : '📝 编辑器无打开文档' }}</span>
        </div>
      </div>

      <div class="evo-field">
        <label>💬 补充改进要求（可选）</label>
        <textarea v-model="userNotes" placeholder="例如：让输出更简洁、增加错误处理步骤、语气更正式..." rows="3"></textarea>
      </div>

      <button class="evo-start-btn" :disabled="!hasAnySource" @click="startEvolution">
        <span class="mso">rocket_launch</span> 开始进化
      </button>
      <p v-if="!hasAnySource" class="evo-hint-warn">需要至少一种反馈来源。请先用搭子聊几次，或绑定知识库。</p>

      <!-- 历史版本 -->
      <div v-if="skill.evolutionLog.length > 0" class="evo-history">
        <h4>进化历史</h4>
        <div v-for="(entry, i) in skill.evolutionLog" :key="i" class="evo-log-entry">
          <span class="evo-log-ver">v{{ entry.version }}</span>
          <span class="evo-log-date">{{ new Date(entry.timestamp).toLocaleDateString('zh-CN') }}</span>
          <span class="evo-log-sum">{{ entry.changesSummary }}</span>
        </div>
      </div>
    </div>

    <!-- Evolving -->
    <div v-if="viewMode === 'evolving'" class="evo-body">
      <div class="evo-evolving">
        <div v-for="i in 4" :key="i" class="evo-step" :class="{ active: evolveStep === i, done: evolveStep > i }">
          <span class="evo-step-dot">{{ evolveStep > i ? '✓' : i }}</span>
          <span>{{ evolveStepLabels[i] }}</span>
        </div>
      </div>
    </div>

    <!-- Diff view -->
    <div v-if="viewMode === 'diff'" class="evo-body">
      <div class="evo-summary">
        <h4>变更摘要</h4>
        <p>{{ evolutionSummary }}</p>
      </div>

      <div class="evo-diff">
        <div class="evo-diff-col">
          <div class="evo-diff-title">当前版本 (v{{ skill.version }})</div>
          <pre class="evo-diff-content">{{ skill.skillContent }}</pre>
        </div>
        <div class="evo-diff-col">
          <div class="evo-diff-title new">升级版 (v{{ skill.version + 1 }})</div>
          <pre class="evo-diff-content new">{{ proposedSkillContent }}</pre>
        </div>
      </div>

      <div class="evo-diff-actions">
        <button class="evo-btn-keep" @click="applyEvolution">✅ 采用升级</button>
        <button class="evo-btn-revert" @click="cancelEvolution">↩ 放弃</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.evo-panel { height: 100%; display: flex; flex-direction: column; }
.evo-head {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 20px; border-bottom: 1px solid var(--line);
  font-size: 15px; font-weight: 700; color: var(--ink1);
}
.evo-version { font-size: 11px; color: var(--ink3); font-weight: 400; }
.evo-close { margin-left: auto; border: none; background: none; font-size: 20px; cursor: pointer; color: var(--ink3); }
.evo-body { flex: 1; overflow-y: auto; padding: 16px 20px; }
.evo-desc p { font-size: 13px; color: var(--ink2); margin: 0 0 4px; }
.evo-sources { display: flex; flex-direction: column; gap: 6px; margin: 14px 0; }
.evo-src {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  border-radius: 8px; font-size: 12px;
}
.evo-src.ok { background: rgba(107,142,35,.06); color: var(--olive-dark); }
.evo-src.empty { background: var(--surface); color: var(--ink3); }
.evo-field { margin: 12px 0; }
.evo-field label { display: block; font-size: 12px; font-weight: 600; color: var(--ink2); margin-bottom: 6px; }
.evo-field textarea {
  width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px;
  font-size: 12px; font-family: inherit; resize: vertical; box-sizing: border-box;
}
.evo-start-btn {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  width: 100%; padding: 10px; border: none; border-radius: 10px;
  background: var(--olive); color: #fff; font-size: 14px; font-weight: 700; cursor: pointer;
  margin-top: 8px;
}
.evo-start-btn:disabled { opacity: .4; cursor: not-allowed; }
.evo-hint-warn { color: #e67e22; font-size: 11px; text-align: center; margin-top: 6px; }
.evo-history { margin-top: 20px; border-top: 1px solid var(--line); padding-top: 12px; }
.evo-history h4 { font-size: 13px; color: var(--ink2); margin: 0 0 8px; }
.evo-log-entry { display: flex; gap: 8px; padding: 4px 0; font-size: 11px; }
.evo-log-ver { color: var(--olive); font-weight: 700; }
.evo-log-date { color: var(--ink3); }
.evo-log-sum { color: var(--ink2); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evo-evolving { display: flex; flex-direction: column; gap: 12px; padding: 20px 0; }
.evo-step { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--ink3); }
.evo-step.active { color: var(--olive); font-weight: 700; }
.evo-step.done { color: var(--olive-dark); }
.evo-step-dot {
  width: 22px; height: 22px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700;
  background: var(--surface); border: 2px solid var(--line); color: var(--ink3);
}
.evo-step.active .evo-step-dot { border-color: var(--olive); color: var(--olive); background: rgba(107,142,35,.1); }
.evo-step.done .evo-step-dot { border-color: var(--olive-dark); color: #fff; background: var(--olive-dark); }
.evo-summary {
  padding: 12px 14px; border-radius: 10px;
  background: rgba(213,199,135,.1); border: 1px solid rgba(213,199,135,.25);
  margin-bottom: 14px;
}
.evo-summary h4 { font-size: 13px; color: var(--ink1); margin: 0 0 6px; }
.evo-summary p { font-size: 12px; color: var(--ink2); line-height: 1.7; white-space: pre-line; margin: 0; }
.evo-diff { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 8px; }
.evo-diff-col { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
.evo-diff-title { padding: 8px 12px; font-size: 11px; font-weight: 700; background: var(--surface); color: var(--ink2); }
.evo-diff-title.new { background: rgba(107,142,35,.08); color: var(--olive-dark); }
.evo-diff-content { padding: 10px 12px; font-size: 11px; line-height: 1.6; white-space: pre-wrap; max-height: 400px; overflow-y: auto; margin: 0; color: var(--ink1); }
.evo-diff-content.new { color: var(--olive-dark); }
.evo-diff-actions { display: flex; gap: 8px; margin-top: 12px; }
.evo-btn-keep { flex: 1; padding: 10px; border: none; border-radius: 10px; background: var(--olive); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; }
.evo-btn-revert { padding: 10px 20px; border: 1px solid var(--line); border-radius: 10px; background: none; color: var(--ink2); font-size: 13px; cursor: pointer; }
.evo-head .mso { font-size: 20px; color: var(--olive); }
.evo-version {
  font-size: 11px; padding: 2px 8px; border-radius: 8px;
  background: var(--line); color: var(--ink3); font-weight: 600;
}
.evo-close {
  margin-left: auto; background: none; border: none;
  font-size: 22px; cursor: pointer; color: var(--ink3);
}
.evo-body { flex: 1; overflow-y: auto; padding: 16px 20px; }
.evo-desc p { font-size: 14px; color: var(--ink1); margin: 0 0 8px; }
.evo-hint { font-size: 12px; color: var(--ink3) !important; }
.evo-no-data {
  display: flex; align-items: center; gap: 8px;
  padding: 16px; border-radius: 8px; background: var(--bg);
  color: var(--ink3); font-size: 13px; margin-top: 16px;
}
.evo-ready { margin-top: 16px; }
.evo-stat { font-size: 14px; color: var(--ink1); margin-bottom: 12px; }
.evo-start-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 12px 24px; border: none; border-radius: 10px;
  background: var(--olive); color: #fff;
  font-size: 14px; font-weight: 700; cursor: pointer; font-family: inherit;
}
.evo-model-hint {
  margin-top: 12px; font-size: 12px; color: var(--ink3);
}
.evo-history { margin-top: 24px; }
.evo-history h4 { font-size: 14px; font-weight: 700; color: var(--ink1); margin: 0 0 8px; }
.evo-log-entry {
  display: flex; gap: 8px; align-items: center;
  padding: 6px 0; font-size: 12px; color: var(--ink2);
  border-bottom: 1px solid var(--line);
}
.evo-log-ver { font-weight: 700; color: var(--olive); }
.evo-log-date { color: var(--ink3); }
.evo-log-sum { flex: 1; }

/* Evolving steps */
.evo-evolving { display: flex; flex-direction: column; gap: 12px; padding: 20px 0; }
.evo-step {
  display: flex; align-items: center; gap: 10px;
  padding: 12px; border-radius: 8px; border: 1px solid var(--line);
  font-size: 14px; color: var(--ink2); opacity: .5;
  transition: all .2s;
}
.evo-step.active { opacity: 1; border-color: var(--olive); background: var(--bg); }
.evo-step.done { opacity: .8; }
.evo-step-dot {
  width: 24px; height: 24px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700;
  background: var(--line); color: var(--ink3);
}
.evo-step.active .evo-step-dot { background: var(--olive); color: #fff; }
.evo-step.done .evo-step-dot { background: #4a7; color: #fff; }

/* Diff view */
.evo-summary { margin-bottom: 16px; }
.evo-summary h4 { font-size: 14px; font-weight: 700; color: var(--ink1); margin: 0 0 4px; }
.evo-summary p { font-size: 13px; color: var(--ink2); }
.evo-diff { display: flex; gap: 8px; margin-bottom: 16px; }
.evo-diff-col { flex: 1; min-width: 0; }
.evo-diff-title {
  font-size: 12px; font-weight: 700; padding: 6px 10px;
  background: var(--line); border-radius: 6px 6px 0 0; color: var(--ink2);
}
.evo-diff-title.new { background: var(--olive); color: #fff; }
.evo-diff-content {
  padding: 10px; border: 1px solid var(--line);
  border-radius: 0 0 6px 6px; font-size: 11px;
  max-height: 300px; overflow-y: auto; white-space: pre-wrap;
  word-break: break-word; color: var(--ink1);
  font-family: 'SF Mono', 'Fira Code', monospace;
  margin: 0;
}
.evo-diff-content.new { border-color: var(--olive); background: rgba(107,142,35,.05); }
.evo-diff-actions { display: flex; gap: 12px; }
.evo-btn-keep {
  padding: 10px 24px; border: none; border-radius: 8px;
  background: var(--olive); color: #fff;
  font-size: 14px; font-weight: 700; cursor: pointer; font-family: inherit;
}
.evo-btn-revert {
  padding: 10px 24px; border-radius: 8px;
  border: 1.5px solid var(--line); background: var(--paper);
  color: var(--ink2); font-size: 13px; cursor: pointer; font-family: inherit;
}
</style>

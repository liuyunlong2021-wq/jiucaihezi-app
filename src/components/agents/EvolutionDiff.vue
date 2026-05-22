<script setup lang="ts">
/**
 * EvolutionDiff.vue — 反哺 diff 对比面板（darwin-skill keep/revert UI）
 *
 * 展示旧版/新版 SKILL.md 对比，用户确认 keep 或 revert
 *
 * @see https://github.com/alchaincyf/darwin-skill
 */
import { ref, computed } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import { useSkillEvolution, keepEvolution } from '@/composables/useSkillEvolution'
import { useBrain } from '@/composables/useBrain'
import type { SkillConfig } from '@/types/skill'

const props = defineProps<{ skill: SkillConfig }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const store = useAgentStore()
const { isEvolving, evolveStep, evolveStepLabels, proposedSkillContent, evolutionSummary, evolveSkill } = useSkillEvolution()
const { wikiPages, rawEntries } = useBrain()

const viewMode = ref<'idle' | 'evolving' | 'diff'>('idle')

// 统计该搭子的知识库内容
const skillWikiContent = computed(() => {
  const raws = rawEntries.value.filter(r => r.skillId === props.skill.id)
  const wikis = wikiPages.value.filter(w => w.skillId === props.skill.id || w.skillId === '_compilation')
  const parts: string[] = []
  if (wikis.length > 0) {
    parts.push('## 知识库整理\n' + wikis.map(w => w.content).join('\n\n'))
  }
  if (raws.length > 0) {
    parts.push('## 原始对话记录\n' + raws.slice(-5).map(r => r.content).join('\n---\n'))
  }
  return parts.join('\n\n')
})

const hasData = computed(() => skillWikiContent.value.trim().length > 0)

// ─── 开始反哺 ───
async function startEvolution() {
  viewMode.value = 'evolving'
  const result = await evolveSkill(props.skill, { wikiContent: skillWikiContent.value })
  if (result.success) {
    viewMode.value = 'diff'
  } else {
    viewMode.value = 'idle'
  }
}

// ─── darwin-skill: keep ───
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

// ─── darwin-skill: revert ───
function cancelEvolution() {
  viewMode.value = 'idle'
  proposedSkillContent.value = ''
}
</script>

<template>
  <div class="evo-panel">
    <div class="evo-head">
      <span class="mso">auto_fix</span>
      <span>反哺搭子 — {{ skill.name }}</span>
      <span class="evo-version">v{{ skill.version }}</span>
      <button class="evo-close" @click="emit('close')">&times;</button>
    </div>

    <!-- Idle -->
    <div v-if="viewMode === 'idle'" class="evo-body">
      <div class="evo-desc">
        <p>反哺会分析「长脑子」整理好的知识，自动优化搭子的 SKILL.md。</p>
        <p class="evo-hint">流程：评估当前能力 → 分析历史对话 → 生成升级方案 → 你来确认</p>
      </div>

      <div v-if="!hasData" class="evo-no-data">
        <span class="mso">info</span>
        这个搭子还没有对话记录。先用搭子聊几次，再来反哺。
      </div>

      <div v-else class="evo-ready">
        <div class="evo-stat">
          📊 当前有 {{ rawEntries.filter(r => r.skillId === skill.id).length }} 条对话记录可供分析
        </div>
        <button class="evo-start-btn" @click="startEvolution">
          <span class="mso">rocket_launch</span> 开始反哺
        </button>
        <p class="evo-model-hint">
          💡 推荐使用 <strong>GPT-5.5</strong> 或 <strong>Opus 4.7</strong>，效果更好
        </p>
      </div>

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
        <button class="evo-btn-keep" @click="applyEvolution">
          ✅ 采用升级
        </button>
        <button class="evo-btn-revert" @click="cancelEvolution">
          ↩ 放弃
        </button>
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

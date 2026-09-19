<template>
  <div class="eval-report">
    <h1>Skill测试: {{ data.skill_name }}</h1>
    <p class="eval-report-meta">共 {{ data.runs.length }} 个结果</p>
    <div v-if="hasBenchmark" class="eval-report-tabs">
      <button type="button" :class="{ active: tab === 'outputs' }" @click="tab = 'outputs'">Outputs</button>
      <button type="button" :class="{ active: tab === 'benchmark' }" @click="tab = 'benchmark'">Benchmark</button>
    </div>
    <!-- 正文由 renderEvalViewerBody 产出，动态值都经过转义。 -->
    <div class="eval-report-body" v-html="bodyHtml"></div>
    <div v-if="tab === 'outputs'" class="eval-report-nav">
      <button type="button" :disabled="currentIdx === 0" @click="currentIdx -= 1">&larr; 上一个</button>
      <span>{{ currentIdx + 1 }}/{{ data.runs.length }}</span>
      <button type="button" :disabled="currentIdx >= data.runs.length - 1" @click="currentIdx += 1">下一个 &rarr;</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { renderEvalViewerBody, type EvalViewerData } from '@/utils/skillTestRunner'

const props = defineProps<{ data: EvalViewerData }>()
const currentIdx = ref(0)
const tab = ref<'outputs' | 'benchmark'>('outputs')
const hasBenchmark = computed(() => Boolean(props.data.benchmark))
// chrome=false：标题、切页栏、翻页都由本组件出，正文才走渲染器。
const bodyHtml = computed(() => renderEvalViewerBody(props.data, { currentIdx: currentIdx.value, tab: tab.value }, false))
</script>

<style scoped>
.eval-report { display: flex; flex-direction: column; gap: var(--jc-space-sm, 0.7rem); }
.eval-report h1 { font-family: var(--jc-font-display); font-size: 1.25rem; color: var(--ink1); }
.eval-report-meta { color: var(--ink2); font-size: 0.8rem; }
.eval-report-tabs { display: flex; border-bottom: 2px solid var(--line); }
.eval-report-tabs button { padding: 0.5rem 1.25rem; margin-bottom: -2px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--ink2); font: inherit; font-size: 0.85rem; font-weight: 500; cursor: pointer; }
.eval-report-tabs button.active { color: var(--olive); border-bottom-color: var(--olive); }
.eval-report-body { display: flex; flex-direction: column; gap: var(--jc-space-sm, 0.7rem); }
.eval-report-body :deep(.card) { padding: var(--jc-space-md, 1.2rem); border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
.eval-report-body :deep(.card h3) { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; font-size: 0.9rem; color: var(--ink1); }
.eval-report-body :deep(.prompt) { margin-bottom: 0.5rem; color: var(--ink2); font-size: 0.8rem; }
.eval-report-body :deep(.badge) { padding: 0.15rem 0.5rem; border-radius: 999px; font-size: 0.65rem; font-weight: 600; text-transform: uppercase; }
.eval-report-body :deep(.badge-with) { background: color-mix(in srgb, var(--olive) 14%, transparent); color: var(--olive-dark); }
.eval-report-body :deep(.badge-without) { background: color-mix(in srgb, var(--jc-warning) 18%, transparent); color: var(--jc-warning); }
.eval-report-body :deep(pre) { padding: 0.75rem; border-radius: var(--radius-sm); background: var(--surface-alt); color: var(--ink1); font-size: 0.75rem; line-height: 1.5; white-space: pre-wrap; max-height: 320px; overflow-y: auto; }
.eval-report-body :deep(summary) { cursor: pointer; color: var(--ink2); font-size: 0.8rem; }
.eval-report-body :deep(.assertion) { margin: 0.25rem 0; font-size: 0.8rem; color: var(--ink1); }
.eval-report-body :deep(.assertion .pass) { color: var(--jc-success); font-weight: 600; }
.eval-report-body :deep(.assertion .fail) { color: var(--jc-error); font-weight: 600; }
.eval-report-body :deep(.assertion .evidence) { margin-left: 1.5rem; color: var(--ink3); font-size: 0.7rem; }
.eval-report-body :deep(.benchmark-table) { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
.eval-report-body :deep(.benchmark-table th) { padding: 0.5rem; background: var(--olive); color: var(--jc-on-primary); text-align: left; }
.eval-report-body :deep(.benchmark-table td) { padding: 0.5rem; border: 1px solid var(--line); color: var(--ink1); }
.eval-report-body :deep(.delta-positive) { color: var(--jc-success); font-weight: 600; }
.eval-report-body :deep(.delta-negative) { color: var(--jc-error); font-weight: 600; }
.eval-report-body :deep(.notes) { padding: 0.75rem; border-radius: var(--radius-sm); background: color-mix(in srgb, var(--jc-warning) 16%, var(--surface)); color: var(--ink1); font-size: 0.8rem; }
.eval-report-nav { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.eval-report-nav button { padding: 0.5rem 1rem; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink1); font: inherit; font-size: 0.85rem; cursor: pointer; }
.eval-report-nav button:hover:not(:disabled) { background: var(--surface-alt); }
.eval-report-nav button:disabled { opacity: 0.4; cursor: not-allowed; }
.eval-report-nav span { color: var(--ink2); font-size: 0.85rem; }
</style>

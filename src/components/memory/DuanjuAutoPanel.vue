<template>
  <div v-if="draft" class="duanju-auto-card" role="dialog" aria-label="全自动·改编">
    <strong>全自动·改编</strong>
    <template v-if="draft.chapters.length">
      <div class="duanju-auto-row">
        <span>章节范围</span>
        <div class="duanju-auto-range">
          <select v-model="from" aria-label="起始章">
            <option v-for="(chapter, index) in draft.chapters" :key="chapter" :value="index">{{ chapter }}</option>
          </select>
          <span>至</span>
          <select v-model="to" aria-label="结束章">
            <option v-for="(chapter, index) in draft.chapters" :key="chapter" :value="index" :disabled="index < from">{{ chapter }}</option>
          </select>
        </div>
      </div>
      <label class="duanju-auto-row"><span>每批章数</span><input v-model.number="batchSize" type="number" min="1"></label>
      <label class="duanju-auto-row"><span>每次读章数</span><input v-model.number="readSize" type="number" min="1"></label>
      <label class="duanju-auto-check"><input v-model="review" type="checkbox">每批规划书完成后暂停，给我审阅</label>
      <p>共 {{ selected.length }} 章，分 {{ batches }} 批。每批依次：整理资料 → 规划（每次读 {{ readSize }} 章）→ {{ review ? '暂停审阅 → ' : '' }}切分 → 逐集写剧本 → 收尾。只产出文字，不产生媒体费用。</p>
    </template>
    <p v-if="draft.saved" class="duanju-auto-note">上次运行停在第 {{ draft.saved.batch + 1 }} 批的「{{ phaseLabel(draft.saved) }}」{{ draft.saved.reason ? `：${draft.saved.reason}` : '' }}。</p>
    <div class="duanju-auto-actions">
      <button type="button" @click="emit('cancel')">取消</button>
      <button v-if="draft.saved" type="button" class="primary" @click="emit('start', draft.saved.config, true)">从第 {{ draft.saved.batch + 1 }} 批续做</button>
      <button v-if="draft.chapters.length" type="button" :class="{ primary: !draft.saved }" :disabled="!valid" @click="emit('start', config, false)">开始全自动</button>
    </div>
  </div>

  <div v-if="run && reviewing" class="duanju-auto-card" role="dialog" aria-label="审阅规划书">
    <strong>第 {{ run.batch + 1 }} 批规划书已完成，请审阅</strong>
    <p>在文件树查看 <code>改编方案/项目总纲.md</code> 和 <code>改编方案/分集规划.md</code>：主题、两台发动机、篇章结构、分集表和删减清单。需要修改就直接在对话里说，改完后再点确认。</p>
    <div class="duanju-auto-actions">
      <button type="button" @click="emit('stop')">停止</button>
      <button type="button" class="primary" @click="emit('approve')">确认，继续切分和写剧本</button>
    </div>
  </div>

  <div v-if="run" class="duanju-auto-progress" :class="run.status">
    <JcIcon name="edit-note" />
    <span class="duanju-auto-status">{{ statusLabel }}</span>
    <span v-for="episode in run.episodes" :key="episode" class="duanju-auto-chip" :class="chipState(episode)">第{{ episode }}集</span>
    <button v-if="run.status === 'running'" type="button" :disabled="stopping" @click="emit('stop')">{{ stopping ? '停止中…' : '停止' }}</button>
    <p v-if="run.status === 'blocked' || run.status === 'stopped'" class="duanju-auto-reason">{{ run.reason ? `暂停原因：${run.reason}。` : '' }}处理后从「短剧改编」菜单重新选「全自动·改编」，点「续做」；已完成的步骤不会重做。</p>
  </div>
  <p v-if="error" class="duanju-auto-error">{{ error }}</p>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DuanjuAutoConfig, DuanjuRunState } from '@/runtime/duanjuAuto/autoRunner'
import type { DuanjuAutoDraft } from '@/composables/useDuanjuAuto'

const props = defineProps<{
  draft: DuanjuAutoDraft | null
  run: DuanjuRunState | null
  stopping: boolean
  reviewing: boolean
  error: string
}>()
const emit = defineEmits<{
  start: [config: DuanjuAutoConfig, resume: boolean]
  cancel: []
  stop: []
  approve: []
}>()

const from = ref(0)
const to = ref(0)
const batchSize = ref(100)
const readSize = ref(20)
const review = ref(true)
watch(() => props.draft, draft => {
  from.value = 0
  to.value = Math.max(0, (draft?.chapters.length ?? 1) - 1)
}, { immediate: true })

const selected = computed(() => props.draft?.chapters.slice(from.value, to.value + 1) ?? [])
const batches = computed(() => Math.ceil(selected.value.length / Math.max(1, batchSize.value || 1)))
const valid = computed(() => selected.value.length > 0 && batchSize.value >= 1 && readSize.value >= 1)
const config = computed<DuanjuAutoConfig>(() => ({
  sourcePath: props.draft?.sourcePath ?? '',
  chapters: selected.value,
  batchSize: Math.floor(batchSize.value),
  readSize: Math.floor(readSize.value),
  review: review.value,
}))

const phaseLabels = { materials: '整理资料', plan: '规划', review: '待审阅', cuts: '切分', write: '写剧本', finish: '收尾' } as const
function phaseLabel(state: DuanjuRunState) {
  if (state.phase === 'write') return `写第${state.episodes[state.index]}集`
  return phaseLabels[state.phase]
}
const statusLabel = computed(() => {
  const run = props.run
  if (!run) return ''
  if (run.status === 'done') return '全自动改编已完成'
  const where = `第 ${run.batch + 1} 批 · ${phaseLabel(run)}`
  return run.status === 'running' ? where : run.status === 'review' ? `${where}：等你审阅规划书` : `已暂停 · ${where}`
})
function chipState(episode: number) {
  const run = props.run
  if (!run) return ''
  const position = run.episodes.indexOf(episode)
  if (run.phase === 'finish' || run.phase === 'write' && position < run.index) return 'done'
  return run.phase === 'write' && position === run.index ? 'active' : ''
}
</script>

<style scoped>
.duanju-auto-card { display: grid; gap: 10px; margin: 0 14px 8px; padding: 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); box-shadow: 0 10px 28px rgb(0 0 0 / 12%); color: var(--ink1); font-size: 12px; }
.duanju-auto-card p { margin: 0; color: var(--ink2); line-height: 1.6; }
.duanju-auto-row { display: grid; grid-template-columns: 84px minmax(0, 1fr); align-items: center; gap: 8px; }
.duanju-auto-row > span:first-child { color: var(--ink3); }
.duanju-auto-range { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.duanju-auto-range select { min-width: 0; max-width: 100%; flex: 1 1 140px; }
.duanju-auto-row select, .duanju-auto-row input[type="number"] { padding: 4px 6px; border: 1px solid var(--line); border-radius: 5px; background: var(--paper); color: var(--ink1); font: inherit; }
.duanju-auto-row input[type="number"] { width: 96px; }
.duanju-auto-check { display: flex; align-items: center; gap: 6px; color: var(--ink2); }
.duanju-auto-note { color: var(--ink3) !important; }
.duanju-auto-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.duanju-auto-actions button, .duanju-auto-progress button { padding: 6px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink1); cursor: pointer; font: inherit; font-size: 12px; }
.duanju-auto-actions button.primary { border-color: transparent; background: var(--olive); color: #fff; }
.duanju-auto-actions button:disabled, .duanju-auto-progress button:disabled { opacity: .45; cursor: default; }
.duanju-auto-progress { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 14px 8px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); color: var(--ink2); font-size: 12px; }
.duanju-auto-status { color: var(--ink1); font-weight: 600; }
.duanju-auto-chip { padding: 1px 7px; border-radius: 999px; background: color-mix(in srgb, var(--ink3) 12%, transparent); font-size: 11px; }
.duanju-auto-chip.done { background: color-mix(in srgb, var(--olive) 16%, transparent); color: var(--olive); }
.duanju-auto-chip.active { background: color-mix(in srgb, #d08a00 18%, transparent); color: #a86d00; }
.duanju-auto-reason { flex-basis: 100%; margin: 0; color: var(--jc-error); }
.duanju-auto-error { margin: 0 14px 8px; color: var(--jc-error); font-size: 12px; }
</style>

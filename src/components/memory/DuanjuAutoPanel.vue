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
      <div class="duanju-auto-row">
        <span>短剧风格</span>
        <div class="duanju-auto-presets" role="radiogroup" aria-label="短剧风格">
          <label v-for="(item, index) in DUANJU_PRESETS" :key="item.name" :class="{ chosen: preset === index }">
            <input v-model="preset" type="radio" :value="index">
            <strong>{{ item.name }}</strong><small>{{ item.min }}–{{ item.max }}秒 · 目标 {{ item.target }}秒 · {{ item.suits }}</small>
          </label>
        </div>
      </div>
      <label class="duanju-auto-row"><span>目标秒数</span><input v-model.number="targetSeconds" type="number" :min="DUANJU_PRESETS[preset].min" :max="DUANJU_PRESETS[preset].max" aria-label="每集目标秒数（可微调）"></label>
      <div class="duanju-auto-row">
        <span>改编方式</span>
        <div class="duanju-auto-presets" role="radiogroup" aria-label="改编方式">
          <label :class="{ chosen: adapt }"><input v-model="adapt" type="radio" :value="true"><strong>切分并改编</strong><small>按切分卡的时间预算删减、压缩对白、影视化</small></label>
          <label :class="{ chosen: !adapt }"><input v-model="adapt" type="radio" :value="false"><strong>只切分</strong><small>分集剧本保持原文直出，之后再改编</small></label>
        </div>
      </div>
      <template v-if="adapt">
        <label class="duanju-auto-row"><span>样集先行</span><input v-model="sample" type="checkbox" aria-label="样集先行"><small class="duanju-auto-hint">先改第1集和一个重大回合所在集，你确认节奏后再批量</small></label>
        <label class="duanju-auto-row"><span>每轮改编集数</span><input v-model.number="adaptSize" type="number" min="1" aria-label="每轮改编集数"></label>
      </template>
      <p>共 {{ selected.length }} 章，分 {{ batches }} 批，章节已按章号排序。每轮只读 {{ readSize }} 章，同时整理角色、场景、道具和事件，并给事件划分回合；程序按“{{ DUANJU_PRESETS[preset].name }}”的时间账切集，写切分卡和原文直出的分集剧本，{{ adapt ? '再由模型按时间逐集改编，' : '' }}直接交给漫剧制作。之后哪个事件要多切或少切，在对话里说一句即可。不产生媒体费用。</p>
    </template>
    <p v-if="draft.saved" class="duanju-auto-note">上次运行停在「{{ duanjuRunLabel(draft.saved) }}」{{ draft.saved.reason ? `：${draft.saved.reason}` : '' }}。</p>
    <div class="duanju-auto-actions">
      <button type="button" @click="emit('cancel')">取消</button>
      <button v-if="draft.saved" type="button" class="primary" @click="emit('start', draft.saved.config, true)">从第 {{ draft.saved.batch + 1 }} 批续做</button>
      <button v-if="draft.chapters.length" type="button" :class="{ primary: !draft.saved }" :disabled="!valid" @click="emit('start', config, false)">开始全自动</button>
    </div>
  </div>

  <div v-if="run && run.status === 'review'" class="duanju-auto-card" role="dialog" aria-label="样集确认">
    <strong>样集已出：第{{ (run.sampleEpisodes ?? []).join('、') }}集</strong>
    <p>请在“项目资料/分集剧本”里看这几集：节奏、对白压缩、细写和开场策略是否合适（当前节奏系数 {{ run.pace ?? 1 }}）。确认后才会批量改编其余各集。</p>
    <div class="duanju-auto-actions">
      <button type="button" @click="emit('review', 'stop')">停止</button>
      <button type="button" @click="emit('review', 'faster')">整体偏快</button>
      <button type="button" @click="emit('review', 'slower')">整体偏慢</button>
      <button type="button" class="primary" @click="emit('review', 'continue')">继续批量改编</button>
    </div>
  </div>

  <div v-if="run && expanded && run.status !== 'review'" class="duanju-auto-card" role="status" aria-label="全自动改编详情">
    <strong>{{ duanjuRunLabel(run) }}</strong>
    <p v-if="run.status === 'blocked' || run.status === 'stopped'" class="duanju-auto-reason">{{ run.reason ? `暂停原因：${run.reason}。` : '' }}处理后从「短剧改编」菜单重新选「全自动·改编」，点「续做」；已完成的步骤不会重做。</p>
    <div v-if="run.status === 'blocked' || run.status === 'stopped' || run.status === 'done'" class="duanju-auto-actions">
      <button type="button" @click="emit('dismiss')">关闭</button>
    </div>
  </div>
  <p v-if="error" class="duanju-auto-error">{{ error }}</p>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { DUANJU_PRESETS, duanjuRunLabel, type DuanjuAutoConfig, type DuanjuRunState, type SampleDecision } from '@/runtime/duanjuAuto/autoRunner'
import type { DuanjuAutoDraft } from '@/composables/useDuanjuAuto'

const props = defineProps<{
  draft: DuanjuAutoDraft | null
  run: DuanjuRunState | null
  /** 点进度芯片展开详情。 */
  expanded: boolean
  error: string
}>()
const emit = defineEmits<{
  start: [config: DuanjuAutoConfig, resume: boolean]
  cancel: []
  dismiss: []
  review: [decision: SampleDecision]
}>()

const from = ref(0)
const to = ref(0)
const batchSize = ref(100)
const readSize = ref(20)
// 三种预设（调研依据见 DUANJU_PRESETS 注释）；目标秒数可在区间内微调，不新增风格。
const preset = ref(2)
const targetSeconds = ref<number>(DUANJU_PRESETS[2].target)
watch(preset, index => { targetSeconds.value = DUANJU_PRESETS[index].target })
const adapt = ref(true)
const sample = ref(true)
const adaptSize = ref(3)
watch(() => props.draft, draft => {
  from.value = 0
  to.value = Math.max(0, (draft?.chapters.length ?? 1) - 1)
}, { immediate: true })

const selected = computed(() => props.draft?.chapters.slice(from.value, to.value + 1) ?? [])
const batches = computed(() => Math.ceil(selected.value.length / Math.max(1, batchSize.value || 1)))
const valid = computed(() => selected.value.length > 0 && batchSize.value >= 1 && readSize.value >= 1 && adaptSize.value >= 1 && targetSeconds.value >= DUANJU_PRESETS[preset.value].min && targetSeconds.value <= DUANJU_PRESETS[preset.value].max)
const config = computed<DuanjuAutoConfig>(() => ({
  sourcePaths: props.draft?.sourcePaths ?? [],
  chapters: selected.value,
  batchSize: Math.floor(batchSize.value),
  readSize: Math.floor(readSize.value),
  rhythm: { name: DUANJU_PRESETS[preset.value].name, min: DUANJU_PRESETS[preset.value].min, target: targetSeconds.value, max: DUANJU_PRESETS[preset.value].max },
  adapt: adapt.value,
  sample: adapt.value && sample.value,
  adaptSize: Math.max(1, Math.floor(adaptSize.value)),
}))

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
.duanju-auto-presets { display: grid; gap: 6px; min-width: 0; }
.duanju-auto-presets label { display: grid; grid-template-columns: auto 1fr; column-gap: 6px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; cursor: pointer; }
.duanju-auto-presets label.chosen { border-color: var(--olive); background: color-mix(in srgb, var(--olive) 8%, transparent); }
.duanju-auto-presets small { grid-column: 2; color: var(--ink3); line-height: 1.5; }
.duanju-auto-hint { grid-column: 2; color: var(--ink3); }
.duanju-auto-note { color: var(--ink3) !important; }
.duanju-auto-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.duanju-auto-actions button { padding: 6px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink1); cursor: pointer; font: inherit; font-size: 12px; }
.duanju-auto-actions button.primary { border-color: transparent; background: var(--olive); color: #fff; }
.duanju-auto-actions button:disabled { opacity: .45; cursor: default; }
.duanju-auto-reason { flex-basis: 100%; margin: 0; color: var(--jc-error); }
.duanju-auto-error { margin: 0 14px 8px; color: var(--jc-error); font-size: 12px; }
</style>

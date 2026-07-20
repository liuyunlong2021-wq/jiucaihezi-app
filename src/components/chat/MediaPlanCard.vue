<script setup lang="ts">
import type { MediaPlan } from '@/runtime/workbench/mediaPlan'

const props = defineProps<{
  plan: MediaPlan
  status?: 'ready' | 'submitting' | 'submitted' | 'failed'
  error?: string
}>()

const emit = defineEmits<{
  (event: 'approve'): void
}>()

const kindLabel = {
  image: '图片',
  video: '视频',
} as const

function approve() {
  if (props.status && props.status !== 'ready' && props.status !== 'failed') return
  emit('approve')
}
</script>

<template>
  <section class="media-plan-card" aria-label="媒体生成计划">
    <div class="media-plan-head">
      <div>
        <strong>{{ plan.title }}</strong>
        <span>{{ kindLabel[plan.kind] }} · {{ plan.modelId }}</span>
      </div>
      <JcIcon name="palette" aria-hidden="true" />
    </div>
    <p class="media-plan-prompt">{{ plan.prompt }}</p>
    <p
      v-if="
        plan.referenceImages?.length || plan.referenceVideos?.length
      "
      class="media-plan-meta"
    >
      已附参考素材
      {{
        (plan.referenceImages?.length || 0) +
        (plan.referenceVideos?.length || 0)
      }}
      个
    </p>
    <p v-if="error" class="media-plan-error">{{ error }}</p>
    <button
      v-if="!status || status === 'ready' || status === 'failed'"
      type="button"
      class="media-plan-submit"
      @click="approve"
    >
      <JcIcon name="play_arrow" />
      开始生成
    </button>
    <span v-else-if="status === 'submitting'" class="media-plan-status">正在提交到创作面板…</span>
    <span v-else-if="status === 'submitted'" class="media-plan-status"
      >已提交，结果将在创作面板和画布中显示。</span
    >
  </section>
</template>

<style scoped>
.media-plan-card {
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--accent, #6c5ce7) 28%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent, #6c5ce7) 6%, transparent);
}
.media-plan-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.media-plan-head strong {
  display: block;
  color: var(--ink1);
  font-size: 13px;
}
.media-plan-head span,
.media-plan-meta,
.media-plan-status {
  color: var(--ink3);
  font-size: 11px;
}
.media-plan-prompt {
  margin: 8px 0 4px;
  color: var(--ink2);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
}
.media-plan-meta {
  margin: 0 0 8px;
}
.media-plan-error {
  margin: 8px 0;
  color: var(--danger, #c0392b);
  font-size: 12px;
}
.media-plan-submit {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border: 0;
  border-radius: 6px;
  background: var(--accent, #6c5ce7);
  color: #fff;
  cursor: pointer;
  font-size: 12px;
}
.media-plan-submit:hover {
  filter: brightness(1.08);
}
.media-plan-status {
  display: block;
  line-height: 1.5;
}
</style>

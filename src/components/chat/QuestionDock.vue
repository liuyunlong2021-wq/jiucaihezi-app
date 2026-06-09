<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { OpenCodeQuestionRequest } from '@/opencodeClient/interactive'

const props = defineProps<{
  requests: OpenCodeQuestionRequest[]
  onReply?: (requestId: string, answers: string[][]) => void | Promise<void>
  onReject?: (requestId: string) => void | Promise<void>
}>()

const activeIndex = ref(0)
const selected = ref<Record<string, string[][]>>({})
const custom = ref<Record<string, string[]>>({})
const responding = ref('')

const activeRequest = computed(() => props.requests[0])
const activeQuestion = computed(() => activeRequest.value?.questions[activeIndex.value])
const isLast = computed(() => activeRequest.value ? activeIndex.value >= activeRequest.value.questions.length - 1 : true)

watch(activeRequest, (request) => {
  activeIndex.value = 0
  if (request && !selected.value[request.id]) selected.value[request.id] = request.questions.map(() => [])
  if (request && !custom.value[request.id]) custom.value[request.id] = request.questions.map(() => '')
}, { immediate: true })

function answersFor(request: OpenCodeQuestionRequest): string[][] {
  return selected.value[request.id] || request.questions.map(() => [])
}

function picked(label: string): boolean {
  const request = activeRequest.value
  if (!request) return false
  return Boolean(answersFor(request)[activeIndex.value]?.includes(label))
}

function pick(label: string) {
  const request = activeRequest.value
  const question = activeQuestion.value
  if (!request || !question) return
  const answers = answersFor(request).map(item => [...item])
  const current = answers[activeIndex.value] || []
  if (question.multiple) {
    answers[activeIndex.value] = current.includes(label)
      ? current.filter(item => item !== label)
      : [...current, label]
  } else {
    answers[activeIndex.value] = [label]
  }
  selected.value = { ...selected.value, [request.id]: answers }
}

function setCustom(value: string) {
  const request = activeRequest.value
  const question = activeQuestion.value
  if (!request || !question) return
  const customAnswers = [...(custom.value[request.id] || request.questions.map(() => ''))]
  customAnswers[activeIndex.value] = value
  custom.value = { ...custom.value, [request.id]: customAnswers }
  if (!question.multiple) {
    const answers = answersFor(request).map(item => [...item])
    answers[activeIndex.value] = value.trim() ? [value.trim()] : []
    selected.value = { ...selected.value, [request.id]: answers }
  }
}

async function submit() {
  const request = activeRequest.value
  if (!request || responding.value) return
  if (!isLast.value) {
    activeIndex.value += 1
    return
  }
  responding.value = request.id
  try {
    await props.onReply?.(request.id, answersFor(request))
  } finally {
    responding.value = ''
  }
}

async function reject() {
  const request = activeRequest.value
  if (!request || responding.value) return
  responding.value = request.id
  try {
    await props.onReject?.(request.id)
  } finally {
    responding.value = ''
  }
}
</script>

<template>
  <div v-if="activeRequest && activeQuestion" class="question-dock">
    <div class="question-card">
      <div class="question-head">
        <span class="mso question-icon">help</span>
        <div class="question-main">
          <div class="question-title">{{ activeQuestion.header || 'OpenCode 提问' }}</div>
          <div class="question-progress">{{ activeIndex + 1 }} / {{ activeRequest.questions.length }}</div>
        </div>
      </div>
      <div class="question-text">{{ activeQuestion.question }}</div>
      <div class="question-options" :role="activeQuestion.multiple ? 'group' : 'radiogroup'">
        <button
          v-for="option in activeQuestion.options"
          :key="option.label"
          class="question-option"
          type="button"
          :aria-checked="picked(option.label)"
          :class="{ picked: picked(option.label) }"
          @click="pick(option.label)"
        >
          <span class="mso">{{ activeQuestion.multiple ? (picked(option.label) ? 'check_box' : 'check_box_outline_blank') : (picked(option.label) ? 'radio_button_checked' : 'radio_button_unchecked') }}</span>
          <span class="question-option-copy">
            <b>{{ option.label }}</b>
            <small v-if="option.description">{{ option.description }}</small>
          </span>
        </button>
      </div>
      <textarea
        v-if="activeQuestion.custom"
        class="question-custom"
        :value="custom[activeRequest.id]?.[activeIndex] || ''"
        placeholder="输入自定义回答"
        rows="2"
        @input="setCustom(($event.target as HTMLTextAreaElement).value)"
      ></textarea>
      <div class="question-actions">
        <button class="dock-btn ghost" :disabled="!!responding" @click="reject">拒绝</button>
        <button v-if="activeIndex > 0" class="dock-btn secondary" :disabled="!!responding" @click="activeIndex -= 1">上一步</button>
        <button class="dock-btn primary" :disabled="!!responding" @click="submit">{{ isLast ? '提交' : '下一步' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.question-dock {
  padding: 8px 12px 0;
}
.question-card {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 88%, var(--paper));
  overflow: hidden;
}
.question-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px 7px;
}
.question-icon {
  color: var(--olive-dark);
  font-size: 17px;
}
.question-main {
  min-width: 0;
  flex: 1;
}
.question-title {
  color: var(--ink1);
  font-size: 12px;
  font-weight: 700;
}
.question-progress {
  color: var(--ink3);
  font-size: 11px;
}
.question-text {
  padding: 0 10px 8px 35px;
  color: var(--ink2);
  font-size: 13px;
  line-height: 1.5;
}
.question-options {
  display: grid;
  gap: 5px;
  padding: 0 10px 9px 35px;
}
.question-option {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--surface);
  color: var(--ink2);
  cursor: pointer;
  font: inherit;
  padding: 7px 8px;
  text-align: left;
}
.question-option.picked {
  border-color: color-mix(in srgb, var(--olive) 55%, var(--line));
  background: color-mix(in srgb, var(--olive) 8%, var(--surface));
}
.question-option .mso {
  color: var(--olive-dark);
  font-size: 17px;
  line-height: 1.2;
}
.question-option-copy {
  display: grid;
  gap: 1px;
  min-width: 0;
}
.question-option-copy b {
  font-size: 12px;
}
.question-option-copy small {
  color: var(--ink3);
  font-size: 11px;
}
.question-custom {
  display: block;
  width: calc(100% - 45px);
  margin: 0 10px 9px 35px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-size: 12px;
  padding: 7px 8px;
  resize: vertical;
}
.question-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  border-top: 1px solid var(--line);
  padding: 8px 10px;
}
.dock-btn {
  border: 1px solid var(--line);
  border-radius: 6px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 5px 9px;
}
.dock-btn:disabled {
  cursor: wait;
  opacity: .6;
}
.dock-btn.ghost {
  background: transparent;
  color: var(--ink2);
}
.dock-btn.secondary {
  background: var(--surface);
  color: var(--olive-dark);
}
.dock-btn.primary {
  border-color: var(--olive);
  background: var(--olive);
  color: white;
}
</style>

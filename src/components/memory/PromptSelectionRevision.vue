<template>
  <div ref="root" class="prompt-selection-editor">
    <div v-if="open" ref="mirror" class="selection-mirror" :style="mirrorStyle" aria-hidden="true"><span>{{ modelValue.slice(0, start) }}</span><mark>{{ modelValue.slice(start, end) }}</mark><span>{{ modelValue.slice(end) }}</span></div>
    <textarea
      ref="input"
      :value="modelValue"
      :aria-label="label"
      :placeholder="placeholder"
      :disabled="disabled || loading"
      spellcheck="false"
      @input="updateValue"
    />
    <div v-if="open" class="selection-revision-popover" role="dialog" :style="popoverStyle" @mousedown.stop>
      <textarea v-model="instruction" aria-label="修改意见" placeholder="输入这段内容的修改要求" rows="3" :disabled="loading" />
      <div class="selection-revision-actions">
        <button type="button" :disabled="loading" @click="close">取消</button>
        <button type="button" class="primary" :disabled="loading || !instruction.trim()" @click="submit">修改</button>
      </div>
      <div v-if="errorMessage" class="selection-revision-error">{{ errorMessage }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string
  revise: (input: { selectedText: string; instruction: string }) => Promise<string>
  disabled?: boolean
  label?: string
  placeholder?: string
  maxSelectionLength?: number
}>(), { label: 'Markdown 原文编辑器', placeholder: '可直接编辑', maxSelectionLength: 10000 })
const emit = defineEmits<{
  'update:modelValue': [value: string]
  'revision-start': []
  'revision-success': [value: string]
  'revision-error': [error: unknown]
}>()
const root = ref<HTMLElement>()
const input = ref<HTMLTextAreaElement>()
const mirror = ref<HTMLElement>()
const open = ref(false)
const loading = ref(false)
const errorMessage = ref('')
const instruction = ref('')
const start = ref(0)
const end = ref(0)
const anchor = ref({ left: 0, top: 0 })
const mirrorOffset = ref({ left: 0, top: 0, width: 0, height: 0 })
const scrollTop = ref(0)
const scrollLeft = ref(0)
const mirrorTypography = ref<Record<string, string>>({})
const popoverStyle = computed(() => ({ left: `${anchor.value.left}px`, top: `${anchor.value.top}px` }))
const mirrorStyle = computed(() => ({ left: `${mirrorOffset.value.left - scrollLeft.value}px`, top: `${mirrorOffset.value.top - scrollTop.value}px`, width: `${mirrorOffset.value.width}px`, minHeight: `${mirrorOffset.value.height}px`, ...mirrorTypography.value }))
function updateValue(event: Event) { emit('update:modelValue', (event.target as HTMLTextAreaElement).value) }

function syncMirror() {
  const textarea = input.value
  if (!textarea || !root.value) return
  const rect = textarea.getBoundingClientRect()
  const host = root.value.getBoundingClientRect()
  mirrorOffset.value = { left: rect.left - host.left, top: rect.top - host.top, width: rect.width, height: rect.height }
  scrollTop.value = textarea.scrollTop
  scrollLeft.value = textarea.scrollLeft
  const style = getComputedStyle(textarea)
  mirrorTypography.value = { fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, padding: style.padding }
}
function captureSelection() {
  const textarea = input.value
  if (!textarea || textarea.selectionStart === textarea.selectionEnd) return close()
  start.value = textarea.selectionStart
  end.value = textarea.selectionEnd
  if (end.value - start.value > (props.maxSelectionLength || 10000)) return close()
  const host = root.value?.getBoundingClientRect()
  if (!host) return
  instruction.value = ''
  errorMessage.value = ''
  open.value = true
  void nextTick(() => {
    syncMirror()
    const mark = mirror.value?.querySelector('mark')
    if (!mark) return
    const markRect = mark.getBoundingClientRect()
    anchor.value = { left: Math.max(8, Math.min(host.width - 308, markRect.left - host.left + markRect.width / 2 - 150)), top: Math.max(8, Math.min(host.height - 170, markRect.bottom - host.top + 6)) }
    document.addEventListener('mousedown', onOutside, { once: true })
  })
}
function onOutside(event: MouseEvent) { if (root.value && !root.value.contains(event.target as Node)) close() }
function close() { open.value = false; instruction.value = ''; errorMessage.value = '' }
async function submit() {
  const selectedText = props.modelValue.slice(start.value, end.value)
  if (!selectedText.trim() || !instruction.value.trim()) return
  loading.value = true
  emit('revision-start')
  try {
    const revised = await props.revise({ selectedText, instruction: instruction.value.trim() })
    if (props.modelValue.slice(start.value, end.value) !== selectedText) throw new Error('内容已变化，请重新选择')
    const next = props.modelValue.slice(0, start.value) + revised + props.modelValue.slice(end.value)
    emit('update:modelValue', next)
    emit('revision-success', next)
    close()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
    emit('revision-error', error)
  } finally { loading.value = false }
}
onMounted(() => {
  input.value?.addEventListener('select', captureSelection)
  input.value?.addEventListener('mouseup', captureSelection)
  input.value?.addEventListener('keyup', captureSelection)
  input.value?.addEventListener('scroll', syncMirror)
  syncMirror()
})
onBeforeUnmount(() => {
  input.value?.removeEventListener('select', captureSelection)
  input.value?.removeEventListener('mouseup', captureSelection)
  input.value?.removeEventListener('keyup', captureSelection)
  input.value?.removeEventListener('scroll', syncMirror)
})
</script>

<style scoped>
.prompt-selection-editor { position: relative; height: 100%; min-height: 320px; overflow: hidden; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.prompt-selection-editor > textarea, .selection-mirror { box-sizing: border-box; width: 100%; min-height: 320px; margin: 0; padding: 14px; font: .92em/1.6 'SF Mono', 'Cascadia Code', monospace; white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 2; }
.prompt-selection-editor > textarea { position: absolute; inset: 0; z-index: 2; border: 0; resize: none; overflow: auto; background: transparent; color: var(--ink1); outline: none; }
.prompt-selection-editor > textarea::selection { background: color-mix(in srgb, var(--olive) 30%, transparent); color: var(--ink1); }
.selection-mirror { position: absolute; z-index: 3; overflow: hidden; color: transparent !important; -webkit-text-fill-color: transparent; text-shadow: none; pointer-events: none; }
.selection-mirror mark { color: transparent !important; -webkit-text-fill-color: transparent; background: color-mix(in srgb, var(--olive) 30%, transparent); }
.selection-revision-popover { position: absolute; z-index: 20; width: min(300px, calc(100% - 16px)); padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); box-shadow: 0 10px 30px rgb(0 0 0 / 16%); }
.selection-revision-popover textarea { box-sizing: border-box; width: 100%; padding: 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--ink1); font: inherit; resize: vertical; outline: none; }
.selection-revision-popover textarea:focus { border-color: var(--olive); }
.selection-revision-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
.selection-revision-actions button { min-width: 56px; height: 30px; padding: 0 10px; border: 1px solid var(--line); border-radius: 5px; background: var(--paper); color: var(--ink2); cursor: pointer; font: inherit; }
.selection-revision-actions button.primary { border-color: var(--olive); background: var(--olive); color: white; }
.selection-revision-actions button:disabled { cursor: wait; opacity: .55; }
.selection-revision-error { margin-top: 6px; color: var(--danger); font-size: 12px; line-height: 1.4; }
@media (max-width: 760px) { .prompt-selection-editor > textarea, .selection-mirror { font-size: 16px; } }
</style>

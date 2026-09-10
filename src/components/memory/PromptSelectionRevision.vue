<template>
  <div ref="root" class="prompt-selection-editor">
    <div class="selection-editor-toolbar"><button type="button" title="插入双链（Command/Ctrl + Shift + K）" :disabled="disabled || loading" @click="openWikiLinkPicker">[[ 双链 ]]</button></div>
    <div v-if="open" ref="mirror" class="selection-mirror" :style="mirrorStyle" aria-hidden="true"><span>{{ modelValue.slice(0, start) }}</span><mark>{{ modelValue.slice(start, end) }}</mark><span>{{ modelValue.slice(end) }}</span></div>
    <textarea
      ref="input"
      :value="modelValue"
      :aria-label="label"
      :placeholder="placeholder"
      :disabled="disabled || loading"
      spellcheck="false"
      @input="updateValue"
      @keydown="handleKeydown"
    />
    <WikiLinkPicker v-if="wikiLinkOpen" :candidates="wikiLinkCandidates" :query="wikiLinkQuery" :active-index="wikiLinkActive" :style="wikiLinkPickerStyle" @choose="chooseWikiLink" />
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import WikiLinkPicker from './WikiLinkPicker.vue'
import { applyWikiLinkSelection, completeWikiLink, findOpenWikiLink, searchWikiLinkCandidates, type WikiLinkCandidate, type WikiLinkCandidateResource } from '@/runtime/memory/markdownWikiLinkInput'

const props = withDefaults(defineProps<{
  modelValue: string
  revise: (input: { selectedText: string; instruction: string }) => Promise<string>
  disabled?: boolean
  label?: string
  placeholder?: string
  maxSelectionLength?: number
  wikiLinkResources?: WikiLinkCandidateResource[]
}>(), { label: 'Markdown 原文编辑器', placeholder: '可直接编辑', maxSelectionLength: 10000 })
const emit = defineEmits<{
  'update:modelValue': [value: string]
  'revision-start': []
  'revision-success': [value: string]
  'revision-error': [error: unknown]
  'cancel-edit': []
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
const wikiLinkOpen = ref(false)
const wikiLinkQuery = ref('')
const wikiLinkAlias = ref('')
const wikiLinkActive = ref(0)
const wikiLinkCandidates = computed(() => searchWikiLinkCandidates(props.wikiLinkResources || [], wikiLinkQuery.value))
const wikiLinkAnchor = ref({ left: 8, top: 44 })
const wikiLinkPickerStyle = computed(() => ({ left: `${wikiLinkAnchor.value.left}px`, top: `${wikiLinkAnchor.value.top}px` }))
const mirrorTypography = ref<Record<string, string>>({})
const popoverStyle = computed(() => ({ left: `${anchor.value.left}px`, top: `${anchor.value.top}px` }))
const mirrorStyle = computed(() => ({ left: `${mirrorOffset.value.left - scrollLeft.value}px`, top: `${mirrorOffset.value.top - scrollTop.value}px`, width: `${mirrorOffset.value.width}px`, minHeight: `${mirrorOffset.value.height}px`, ...mirrorTypography.value }))
function updateValue(event: Event) {
  const textarea = event.target as HTMLTextAreaElement
  emit('update:modelValue', textarea.value)
  const openLink = findOpenWikiLink(textarea.value, textarea.selectionStart)
  if (openLink) { wikiLinkQuery.value = openLink.query; wikiLinkAlias.value = ''; wikiLinkActive.value = 0; wikiLinkOpen.value = true; updateWikiLinkAnchor(textarea) }
  else wikiLinkOpen.value = false
}
function setSelection(start: number, end = start) { void nextTick(() => { input.value?.focus(); input.value?.setSelectionRange(start, end) }) }
function openWikiLinkPicker() {
  const textarea = input.value
  if (!textarea) return
  const result = applyWikiLinkSelection(props.modelValue, textarea.selectionStart, textarea.selectionEnd)
  wikiLinkAlias.value = props.modelValue.slice(textarea.selectionStart, textarea.selectionEnd)
  emit('update:modelValue', result.value); wikiLinkQuery.value = result.query; wikiLinkActive.value = 0; wikiLinkOpen.value = Boolean(result.query)
  setSelection(result.selectionStart, result.selectionEnd)
  if (result.query) void nextTick(() => updateWikiLinkAnchor(textarea))
}
function chooseWikiLink(candidate: WikiLinkCandidate) {
  const textarea = input.value
  if (!textarea) return
  const result = completeWikiLink(props.modelValue, textarea.selectionStart, candidate, wikiLinkAlias.value)
  emit('update:modelValue', result.value); wikiLinkOpen.value = false; wikiLinkAlias.value = ''; setSelection(result.cursor)
}
function handleKeydown(event: KeyboardEvent) {
  if (event.isComposing) return
  if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'k') { event.preventDefault(); openWikiLinkPicker(); return }
  if (event.key === 'Escape') {
    const textarea = input.value
    if (wikiLinkOpen.value) { event.preventDefault(); event.stopPropagation(); wikiLinkOpen.value = false; return }
    if (textarea) {
      const unfinished = findOpenWikiLink(props.modelValue, textarea.selectionStart)
      if (unfinished) {
        event.preventDefault(); event.stopPropagation()
        const closing = props.modelValue.indexOf(']]', unfinished.end)
        const removeEnd = closing >= 0 ? closing + 2 : unfinished.end
        emit('update:modelValue', props.modelValue.slice(0, unfinished.start) + props.modelValue.slice(removeEnd))
        setSelection(unfinished.start)
        return
      }
    }
    event.preventDefault(); event.stopPropagation(); emit('cancel-edit'); return
  }
  if (!wikiLinkOpen.value) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const size = wikiLinkCandidates.value.length; if (size) wikiLinkActive.value = (wikiLinkActive.value + (event.key === 'ArrowDown' ? 1 : -1) + size) % size; return }
  if (event.key === 'Enter' && wikiLinkCandidates.value.length) { event.preventDefault(); chooseWikiLink(wikiLinkCandidates.value[wikiLinkActive.value]!) }
}
function updateWikiLinkAnchor(textarea: HTMLTextAreaElement) {
  const host = root.value
  if (!host) return
  const style = getComputedStyle(textarea)
  const mirror = document.createElement('div')
  Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', pointerEvents: 'none', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', boxSizing: 'border-box', width: `${textarea.clientWidth}px`, padding: style.padding, font: style.font, letterSpacing: style.letterSpacing, tabSize: style.tabSize })
  mirror.textContent = textarea.value.slice(0, textarea.selectionStart)
  const marker = document.createElement('span')
  marker.textContent = '\u200b'
  mirror.appendChild(marker)
  host.appendChild(mirror)
  const textareaRect = textarea.getBoundingClientRect()
  const hostRect = host.getBoundingClientRect()
  const lineHeight = Number.parseFloat(style.lineHeight) || 22
  const desiredLeft = textareaRect.left - hostRect.left + marker.offsetLeft - textarea.scrollLeft
  const below = textareaRect.top - hostRect.top + marker.offsetTop - textarea.scrollTop + lineHeight + 6
  const above = textareaRect.top - hostRect.top + marker.offsetTop - textarea.scrollTop - 226
  wikiLinkAnchor.value = { left: Math.max(8, Math.min(host.clientWidth - 438, desiredLeft)), top: below + 220 <= host.clientHeight ? below : Math.max(8, above) }
  mirror.remove()
}
watch(wikiLinkCandidates, candidates => { if (wikiLinkActive.value >= candidates.length) wikiLinkActive.value = 0 })

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
.prompt-selection-editor > textarea, .selection-mirror { box-sizing: border-box; width: 100%; min-height: 320px; margin: 0; padding: 50px 14px 14px; font: .92em/1.6 'SF Mono', 'Cascadia Code', monospace; white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 2; }
.selection-editor-toolbar { position: absolute; z-index: 8; top: 8px; left: 8px; }
.selection-editor-toolbar button { height: 30px; padding: 0 10px; border: 1px solid var(--line); border-radius: 5px; background: var(--paper); color: var(--ink2); cursor: pointer; }
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

<script setup lang="ts">
/**
 * HighlightedText.vue — 用户消息高亮（对齐 OpenCode 官方 HighlightedText）
 *
 * 功能：在用户消息文本中高亮文件引用（inline file part）和 agent 切换
 * OpenCode 官方: message-part.tsx:1303-1347
 */
import { computed } from 'vue'
import type { OpenCodeRenderablePart } from '@/opencodeClient/timelineRows'

interface HighlightSegment {
  text: string
  type?: 'file' | 'agent'
}

const props = defineProps<{
  text: string
  parts?: OpenCodeRenderablePart[]
}>()

const segments = computed<HighlightSegment[]>(() => {
  const text = props.text
  if (!text) return []

  // 提取 file parts 的文字范围（对齐官方 attached/inline 函数）
  const fileParts = (props.parts || [])
    .filter(p => p.type === 'file' && typeof (p.raw as any)?.source?.text?.start === 'number' && typeof (p.raw as any)?.source?.text?.end === 'number')
    .map(p => ({
      start: (p.raw as any).source.text.start as number,
      end: (p.raw as any).source.text.end as number,
      type: 'file' as const,
    }))

  // 提取 agent parts 的文字范围
  const agentParts = (props.parts || [])
    .filter(p => p.type === 'agent' && typeof (p.raw as any)?.source?.start === 'number' && typeof (p.raw as any)?.source?.end === 'number')
    .map(p => ({
      start: (p.raw as any).source.start as number,
      end: (p.raw as any).source.end as number,
      type: 'agent' as const,
    }))

  const allRefs = [...fileParts, ...agentParts]
    .filter(r => r.start < r.end)
    .sort((a, b) => a.start - b.start)

  const result: HighlightSegment[] = []
  let lastIndex = 0

  for (const ref of allRefs) {
    if (ref.start < lastIndex) continue
    if (ref.start > lastIndex) {
      result.push({ text: text.slice(lastIndex, ref.start) })
    }
    result.push({ text: text.slice(ref.start, ref.end), type: ref.type })
    lastIndex = ref.end
  }

  if (lastIndex < text.length) {
    result.push({ text: text.slice(lastIndex) })
  }

  return result.length > 0 ? result : [{ text }]
})
</script>

<template>
  <template v-for="(seg, i) in segments" :key="i">
    <span v-if="seg.type" :data-highlight="seg.type">{{ seg.text }}</span>
    <span v-else>{{ seg.text }}</span>
  </template>
</template>

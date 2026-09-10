<template>
  <div class="wiki-link-picker" :style="style" role="listbox" @mousedown.stop>
    <div class="wiki-link-query">链接文件：{{ query || '输入名称或拼音搜索' }}</div>
    <button
      v-for="(candidate, index) in candidates"
      :key="candidate.path"
      type="button"
      role="option"
      :aria-selected="index === activeIndex"
      :class="{ active: index === activeIndex }"
      @mousedown.prevent="$emit('choose', candidate)"
    >
      <strong>{{ candidate.name }}</strong><small>{{ candidate.directory }}</small>
    </button>
    <p v-if="!candidates.length">没有匹配的 Markdown 文件</p>
  </div>
</template>

<script setup lang="ts">
import type { WikiLinkCandidate } from '@/runtime/memory/markdownWikiLinkInput'

defineProps<{
  candidates: WikiLinkCandidate[]
  query: string
  activeIndex: number
  style: Record<string, string>
}>()
defineEmits<{ choose: [candidate: WikiLinkCandidate] }>()
</script>

<style scoped>
.wiki-link-picker { position: absolute; z-index: 30; display: block; width: min(430px, calc(100% - 16px)); max-height: 260px; overflow: auto; padding: 6px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); box-shadow: 0 10px 30px rgb(0 0 0 / 16%); }
.wiki-link-query, .wiki-link-picker p { display: block; margin: 4px 6px 6px; color: var(--ink3); font-size: 12px; }
.wiki-link-picker > button { display: flex !important; width: 100% !important; min-height: 36px; box-sizing: border-box; align-items: center; justify-content: space-between; gap: 12px; margin: 2px 0; padding: 7px 9px; border: 0; border-radius: 5px; background: transparent; color: var(--ink1); text-align: left; cursor: pointer; }
.wiki-link-picker > button.active, .wiki-link-picker > button:hover { background: var(--olive-pale); }
.wiki-link-picker strong { display: block; min-width: 0; overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.wiki-link-picker small { display: block; max-width: 58%; overflow: hidden; color: var(--ink3); text-overflow: ellipsis; white-space: nowrap; }
</style>

<script setup lang="ts">
import { computed } from 'vue'
import { openExternal } from '@/utils/httpClient'

const props = defineProps<{
  role: 'user' | 'assistant' | 'system' | 'tool' | 'divider'
  searchResults?: { title: string; url: string; snippet: string }[]
}>()

function isSafeSearchReferenceUrl(url: string): boolean {
  try {
    const parsed = new URL(String(url || '').trim())
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

const safeSearchResults = computed(() => (props.searchResults || []).filter(ref => isSafeSearchReferenceUrl(ref.url)))
const showSearchReferences = computed(() => props.role === 'assistant' && safeSearchResults.value.length > 0)

function openReference(url: string) {
  if (!isSafeSearchReferenceUrl(url)) return
  void openExternal(url)
}
</script>

<template>
  <div v-if="showSearchReferences" class="msg-references">
    <details v-if="showSearchReferences" class="msg-search-refs">
      <summary class="msg-search-refs-title">搜索引用（{{ safeSearchResults.length }} 条）</summary>
      <div v-for="(ref, i) in safeSearchResults" :key="`${ref.url}-${i}`" class="msg-search-ref-item">
        <button type="button" class="msg-search-ref-link" @click="openReference(ref.url)">{{ ref.title }}</button>
        <span class="msg-search-ref-snippet">{{ ref.snippet }}</span>
      </div>
    </details>
  </div>
</template>

<style scoped>
.msg-references {
  margin-top: 8px;
}

.msg-search-refs {
  margin-bottom: 8px;
  border: 1px solid rgba(107,142,35,.2);
  border-radius: 8px;
  background: rgba(107,142,35,.03);
  overflow: hidden;
}

.msg-search-refs-title {
  cursor: pointer;
  list-style: none;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--olive-dark);
}

.msg-search-refs-title::-webkit-details-marker {
  display: none;
}

.msg-search-refs[open] .msg-search-refs-title {
  border-bottom: 1px solid rgba(107,142,35,.1);
}

.msg-search-ref-item {
  padding: 6px 10px;
  border-bottom: 1px solid rgba(107,142,35,.06);
}

.msg-search-ref-item:last-child {
  border-bottom: none;
}

.msg-search-ref-link {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 12px;
  font-weight: 600;
  color: var(--olive);
  text-decoration: none;
  margin-bottom: 2px;
  text-align: left;
  font-family: inherit;
  cursor: pointer;
}

.msg-search-ref-link:hover {
  text-decoration: underline;
}

.msg-search-ref-snippet {
  font-size: 11px;
  color: var(--ink3);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
</style>

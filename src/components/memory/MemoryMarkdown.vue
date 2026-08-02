<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { renderMessageMarkdown } from '@/components/chat/display/markdownDisplayPolicy'
import { renderStreamingText } from '@/components/chat/display/streamingTextRenderer'
import { renderWikiLinks } from '@/runtime/memory/markdownLinks'
import { renderMermaidBlocks } from '@/utils/mermaidRenderer'

const props = withDefaults(defineProps<{ content: string; renderId: string; streaming?: boolean; outline?: boolean }>(), {
  streaming: false,
  outline: false,
})

const html = ref('')
const article = ref<HTMLElement | null>(null)
const headings = ref<Array<{ id: string; text: string; level: number }>>([])
const activeHeading = ref('')
const outlineOpen = ref(typeof window === 'undefined' || window.innerWidth > 760)
let generation = 0
let headingObserver: IntersectionObserver | null = null

function syncOutline() {
  if (!props.outline || !article.value) return
  headings.value = [...article.value.querySelectorAll<HTMLElement>('h1,h2,h3')].map((node, index) => {
    const id = `md-heading-${index + 1}`
    node.id = id
    return { id, text: node.textContent?.trim() || `标题 ${index + 1}`, level: Number(node.tagName.slice(1)) }
  })
  activeHeading.value = headings.value[0]?.id || ''
  headingObserver?.disconnect()
  headingObserver = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
    if (visible) activeHeading.value = visible.target.id
  }, { rootMargin: '-80px 0px -65% 0px' })
  article.value.querySelectorAll('h1,h2,h3').forEach(node => headingObserver?.observe(node))
}

async function render() {
  const current = ++generation
  const base = props.streaming
    ? renderStreamingText(props.content)
    : renderMessageMarkdown(renderWikiLinks(props.content), 'assistant')
  html.value = base
  if (!props.streaming) html.value = await renderMermaidBlocks(base, props.renderId.replace(/[^a-z0-9_-]/gi, '-'))
  if (current !== generation) return
  await nextTick()
  syncOutline()
}

function jumpTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  activeHeading.value = id
}

watch(() => [props.content, props.streaming, props.outline], render, { immediate: true })
onBeforeUnmount(() => { generation += 1; headingObserver?.disconnect() })
</script>

<template>
  <div class="memory-markdown-renderer" :class="{ 'with-outline': outline && headings.length }">
    <aside v-if="outline && headings.length" class="memory-document-outline" :class="{ open: outlineOpen }">
      <button class="memory-outline-toggle" type="button" @click="outlineOpen = !outlineOpen">{{ outlineOpen ? '收起大纲' : '展开大纲' }}</button>
      <nav v-show="outlineOpen" aria-label="文档大纲">
        <button v-for="heading in headings" :key="heading.id" type="button" :class="[{ active: activeHeading === heading.id }, `level-${heading.level}`]" @click="jumpTo(heading.id)">{{ heading.text }}</button>
      </nav>
    </aside>
    <div ref="article" class="memory-markdown-content" v-html="html"></div>
  </div>
</template>

<style scoped>
.memory-markdown-renderer.with-outline{display:grid;grid-template-columns:minmax(150px,220px) minmax(0,1fr);gap:24px;align-items:start}.memory-document-outline{position:sticky;top:0;max-height:calc(100vh - 110px);overflow:auto;border-right:1px solid var(--border-color,#ddd);padding-right:12px}.memory-outline-toggle,.memory-document-outline nav button{width:100%;border:0;background:transparent;color:inherit;text-align:left;padding:7px 8px;cursor:pointer}.memory-outline-toggle{font-weight:600}.memory-document-outline nav button{font-size:12px;opacity:.72}.memory-document-outline nav button.active{opacity:1;color:var(--accent-color,#66752b);font-weight:600}.memory-document-outline .level-2{padding-left:18px}.memory-document-outline .level-3{padding-left:30px}@media(max-width:760px){.memory-markdown-renderer.with-outline{display:block}.memory-document-outline{position:static;max-height:none;border-right:0;border-bottom:1px solid var(--border-color,#ddd);margin-bottom:16px;padding:0 0 8px}.memory-document-outline:not(.open){border-bottom:0}}
</style>

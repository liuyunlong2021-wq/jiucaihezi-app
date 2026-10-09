<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { renderMarkdownChunk, renderMessageMarkdown } from '@/components/chat/display/markdownDisplayPolicy'
import { IncrementalMarkdown } from '@/components/chat/display/incrementalMarkdown'
import { renderMarkdownFileLinks } from '@/runtime/memory/markdownFileLinks'
import { renderMermaidBlocks } from '@/utils/mermaidRenderer'

const props = withDefaults(defineProps<{ content: string; renderId: string; streaming?: boolean; outline?: boolean }>(), {
  streaming: false,
  outline: false,
})

const chunks = ref<Array<{ key: string; html: string }>>([])
const article = ref<HTMLElement | null>(null)
const headings = ref<Array<{ id: string; text: string; level: number }>>([])
const activeHeading = ref('')
const outlineOpen = ref(typeof window === 'undefined' || window.innerWidth > 760)
let generation = 0
let frame: number | null = null
let activeIdentity = ''
let activeRevision = -1
let activeLinksVersion = -1
let headingObserver: IntersectionObserver | null = null
const incrementalMarkdown = new IncrementalMarkdown()
const renderedChunkCache = new Map<string, string>()

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
  frame = null
  const current = ++generation
  // Stream and authoritative completion share a document identity so stable Vue nodes survive handoff.
  const identity = props.renderId
  if (identity !== activeIdentity) {
    activeIdentity = identity
    renderedChunkCache.clear()
  }

  const source = renderMarkdownFileLinks(props.content)
  // Math renders to HTML and intentionally takes the established whole-message path.
  // It is finalized content and remains a local enhancement to the stable Markdown flow.
  if (!props.streaming && /\$\$?[\s\S]+?\$\$?/.test(source)) {
    const base = renderMessageMarkdown(source, 'assistant')
    const html = await renderMermaidBlocks(base, props.renderId.replace(/[^a-z0-9_-]/gi, '-'))
    if (current !== generation) return
    chunks.value = html ? [{ key: `${identity}:math`, html }] : []
  } else {
    const snapshot = incrementalMarkdown.update(source, identity)
    if (snapshot.revision !== activeRevision || snapshot.linksVersion !== activeLinksVersion) {
      renderedChunkCache.clear()
      activeRevision = snapshot.revision
      activeLinksVersion = snapshot.linksVersion
    }
    const rendered = await Promise.all(snapshot.chunks.map(async chunk => {
      const cacheKey = `${snapshot.revision}:${chunk.key}:${snapshot.linksVersion}:${props.streaming ? 'stream' : 'settled'}:${chunk.stable}`
      // Mutable tail tokens keep the same source-offset key while their text grows.
      // Caching them by identity would freeze the first token fragment on screen.
      let html = chunk.stable ? renderedChunkCache.get(cacheKey) : undefined
      if (html === undefined) {
        html = renderMarkdownChunk(chunk.token, snapshot.links, { streaming: props.streaming, stable: chunk.stable })
        if (!props.streaming && html.includes('language-mermaid')) {
          html = await renderMermaidBlocks(html, `${props.renderId}-${chunk.key}`.replace(/[^a-z0-9_-]/gi, '-'))
        }
        if (current !== generation) return { key: chunk.key, html }
        if (chunk.stable) renderedChunkCache.set(cacheKey, html)
      }
      return { key: chunk.key, html }
    }))
    if (current !== generation) return
    chunks.value = rendered
  }
  if (current !== generation) return
  await nextTick()
  syncOutline()
}

function scheduleRender() {
  if (!props.streaming) {
    if (frame !== null) cancelAnimationFrame(frame)
    void render()
    return
  }
  if (frame !== null) return
  if (typeof requestAnimationFrame === 'function') {
    frame = requestAnimationFrame(() => { void render() })
  } else {
    void render()
  }
}

function jumpTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  activeHeading.value = id
}

watch(() => [props.content, props.streaming, props.outline, props.renderId], scheduleRender, { immediate: true })
onBeforeUnmount(() => {
  generation += 1
  if (frame !== null) cancelAnimationFrame(frame)
  headingObserver?.disconnect()
  renderedChunkCache.clear()
})
</script>

<template>
  <div class="memory-markdown-renderer" :class="{ 'with-outline': outline && headings.length, 'outline-collapsed': !outlineOpen }">
    <aside v-if="outline && headings.length" class="memory-document-outline" :class="{ open: outlineOpen }">
      <button class="memory-outline-toggle" type="button" :title="outlineOpen ? '收起大纲' : '展开大纲'" :aria-label="outlineOpen ? '收起大纲' : '展开大纲'" @click="outlineOpen = !outlineOpen"><span v-if="outlineOpen">收起大纲</span><JcIcon v-else name="view-list" /></button>
      <nav v-show="outlineOpen" aria-label="文档大纲">
        <button v-for="heading in headings" :key="heading.id" type="button" :class="[{ active: activeHeading === heading.id }, `level-${heading.level}`]" @click="jumpTo(heading.id)">{{ heading.text }}</button>
      </nav>
    </aside>
    <div ref="article" class="memory-markdown-content">
      <div v-for="chunk in chunks" :key="chunk.key" class="memory-markdown-chunk" v-html="chunk.html"></div>
    </div>
  </div>
</template>

<style scoped>
.memory-markdown-renderer.with-outline{position:relative;display:grid;grid-template-columns:minmax(150px,220px) minmax(0,1fr);gap:24px;align-items:start}.memory-markdown-renderer.with-outline.outline-collapsed{grid-template-columns:minmax(0,1fr);gap:0}.memory-document-outline{position:sticky;top:0;max-height:calc(100vh - 110px);overflow:auto;border-right:1px solid var(--border-color,#ddd);padding-right:12px}.outline-collapsed .memory-document-outline{position:absolute;z-index:1;top:0;left:0;max-height:none;overflow:visible;border-right:0;padding:0}.memory-outline-toggle,.memory-document-outline nav button{width:100%;border:0;background:transparent;color:inherit;text-align:left;padding:7px 8px;cursor:pointer}.memory-outline-toggle{font-weight:600}.outline-collapsed .memory-outline-toggle{display:grid;width:32px;height:32px;padding:0;place-items:center;border:1px solid var(--border-color,#ddd);border-radius:6px;background:var(--paper,#fff)}.memory-document-outline nav button{font-size:12px;opacity:.72}.memory-document-outline nav button.active{opacity:1;color:var(--accent-color,#66752b);font-weight:600}.memory-document-outline .level-2{padding-left:18px}.memory-document-outline .level-3{padding-left:30px}@container (max-width: 700px){.memory-markdown-renderer.with-outline:not(.outline-collapsed){grid-template-columns:120px minmax(0,1fr);gap:16px}.memory-document-outline{padding-right:8px}}@media(max-width:760px){.memory-markdown-renderer.with-outline{display:block}.memory-document-outline,.outline-collapsed .memory-document-outline{position:static;max-height:none;border-right:0;border-bottom:1px solid var(--border-color,#ddd);margin-bottom:16px;padding:0 0 8px}.memory-document-outline:not(.open){border-bottom:0}.outline-collapsed .memory-outline-toggle{width:32px}}
.memory-markdown-chunk{display:contents}
</style>

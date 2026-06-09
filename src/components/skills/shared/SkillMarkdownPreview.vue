<script setup lang="ts">
import { computed } from 'vue'
import DOMPurify from 'dompurify'
import { marked } from 'marked'

const props = defineProps<{
  content: string
}>()

const html = computed(() => {
  const rendered = marked.parse(props.content || '暂无 SKILL.md 内容', {
    async: false,
    breaks: true,
    gfm: true,
  }) as string
  return DOMPurify.sanitize(rendered)
})
</script>

<template>
  <div class="smp" v-html="html"></div>
</template>

<style scoped>
.smp {
  color: var(--ink1);
  font-size: 13px;
  line-height: 1.62;
}
.smp :deep(h1),
.smp :deep(h2),
.smp :deep(h3) {
  margin: 18px 0 8px;
  line-height: 1.25;
  letter-spacing: 0;
}
.smp :deep(h1) { font-size: 22px; }
.smp :deep(h2) { font-size: 18px; }
.smp :deep(h3) { font-size: 15px; }
.smp :deep(p) { margin: 8px 0; }
.smp :deep(ul),
.smp :deep(ol) {
  padding-left: 20px;
}
.smp :deep(pre) {
  overflow: auto;
  padding: 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--ink1) 8%, var(--paper));
}
.smp :deep(code) {
  padding: 1px 4px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--ink1) 7%, transparent);
}
.smp :deep(pre code) {
  padding: 0;
  background: transparent;
}
.smp :deep(blockquote) {
  margin: 10px 0;
  padding-left: 10px;
  border-left: 3px solid var(--olive);
  color: var(--ink2);
}
</style>

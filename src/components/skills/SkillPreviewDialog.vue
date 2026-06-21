<script setup lang="ts">
import SkillMarkdownPreview from '@/components/skills/shared/SkillMarkdownPreview.vue'

defineProps<{
  title: string
  sourceLabel?: string
  content: string
  loading?: boolean
  aiSummary?: string
  aiSummaryLoading?: boolean
  aiSummaryStatus?: string
  aiSummaryError?: string
  canGenerateAiSummary?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'generateAiSummary'): void
}>()
</script>

<template>
  <div class="dialog-backdrop" @click.self="emit('close')">
    <section class="dialog">
      <header>
        <div>
          <h4>{{ title }}</h4>
          <p>{{ sourceLabel || 'SKILL.md' }}</p>
        </div>
        <div class="head-actions">
          <button
            v-if="canGenerateAiSummary"
            type="button"
            title="AI Summary"
            :disabled="loading || aiSummaryLoading || !content"
            @click="emit('generateAiSummary')"
          >
            <JcIcon :name="aiSummaryLoading ? 'progress_activity' : 'auto_awesome'" :class="{ spin: aiSummaryLoading }" />
            <span>AI Summary</span>
          </button>
          <button type="button" title="关闭" @click="emit('close')"><JcIcon name="close" /></button>
        </div>
      </header>
      <main>
        <section class="markdown-pane">
          <div v-if="loading" class="state"><JcIcon name="progress_activity" class="spin" />正在读取 Markdown...</div>
          <SkillMarkdownPreview v-else :content="content" />
        </section>
        <aside v-if="canGenerateAiSummary" class="summary-pane">
          <h5>AI Summary</h5>
          <p>用 AI 概括用途、触发场景和注意事项。</p>
          <div v-if="aiSummaryError" class="inline-error">{{ aiSummaryError }}</div>
          <div v-else-if="aiSummaryStatus" class="inline-status">{{ aiSummaryStatus }}</div>
          <div class="summary-box">
            <div v-if="aiSummaryLoading" class="state small"><JcIcon name="progress_activity" class="spin" />正在生成...</div>
            <pre v-else-if="aiSummary">{{ aiSummary }}</pre>
            <div v-else class="empty">还没有 AI Summary。</div>
          </div>
        </aside>
      </main>
    </section>
  </div>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 48;
  display: grid;
  place-items: center;
  padding: 18px;
  background: color-mix(in srgb, var(--ink1) 26%, transparent);
}
.dialog {
  width: min(820px, 96vw);
  height: min(720px, 90vh);
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: 0 20px 60px color-mix(in srgb, var(--ink1) 20%, transparent);
}
header {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border-bottom: 1px solid var(--border);
  background: var(--paper);
}
h4 { margin: 0; color: var(--ink1); font-size: 14px; }
p { margin: 4px 0 0; color: var(--ink3); font-size: 12px; overflow-wrap: anywhere; }
.head-actions {
  display: flex;
  gap: 7px;
  align-items: center;
}
.head-actions button {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink2);
  padding: 0 9px;
  cursor: pointer;
}
.head-actions button:disabled { opacity: .55; cursor: default; }
main {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(240px, 32%);
  gap: 0;
  background: var(--paper);
}
.markdown-pane { min-height: 0; overflow: auto; padding: 12px; }
.summary-pane {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 12px;
  border-left: 1px solid var(--border);
  background: var(--surface);
}
h5 { margin: 0; font-size: 13px; color: var(--ink1); }
.summary-pane p { line-height: 1.45; }
.summary-box {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
  padding: 10px;
}
pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--ink2);
  font-family: inherit;
  font-size: 12px;
  line-height: 1.55;
}
.empty { color: var(--ink3); font-size: 12px; }
.inline-error,
.inline-status {
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.45;
}
.inline-error {
  background: color-mix(in srgb, var(--jc-error) 12%, transparent);
  color: var(--jc-error);
}
.inline-status {
  background: var(--olive-pale);
  color: var(--olive-dark);
}
.state { min-height: 180px; display: grid; place-items: center; gap: 8px; color: var(--ink3); font-size: 12px; }
.state.small { min-height: 90px; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 760px) {
  main { grid-template-columns: 1fr; }
  .summary-pane { border-left: 0; border-top: 1px solid var(--border); }
}
</style>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { buildDiffReviewModel, type OpenCodeDiffFileLike } from '@/opencodeClient/diffReview'

export type DiffFile = OpenCodeDiffFileLike

const props = defineProps<{
  diffs?: DiffFile[]
}>()

const expanded = ref(false)
const openFileIds = ref(new Set<string>())

const review = computed(() => buildDiffReviewModel(props.diffs))
const files = computed(() => review.value.files)
const totals = computed(() => review.value.summary)
const statusSummary = computed(() => Object.entries(totals.value.statusCounts)
  .map(([status, count]) => `${status} ${count}`)
  .join(' · '))

function isFileOpen(id: string): boolean {
  return openFileIds.value.has(id)
}

function toggleFile(id: string) {
  const next = new Set(openFileIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  openFileIds.value = next
}

function lineNumber(line: { oldLine?: number; newLine?: number }): string {
  const oldText = line.oldLine === undefined ? ' ' : String(line.oldLine)
  const newText = line.newLine === undefined ? ' ' : String(line.newLine)
  return `${oldText} ${newText}`
}
</script>

<template>
  <div v-if="files.length" class="diff-dock" data-component="session-diff-summary">
    <button class="diff-summary" type="button" @click="expanded = !expanded">
      <span class="mso">difference</span>
      <span class="diff-summary-title">Review / Diff · {{ totals.fileCount }} 个文件变更</span>
      <span class="diff-stat add">+{{ totals.additions }}</span>
      <span class="diff-stat del">-{{ totals.deletions }}</span>
      <span v-if="statusSummary" class="diff-status-summary">{{ statusSummary }}</span>
      <span class="mso">{{ expanded ? 'expand_less' : 'expand_more' }}</span>
    </button>
    <div v-if="expanded" class="diff-review-panel" data-component="session-diff-review-panel">
      <div class="diff-review-meta">
        <span>可审查文件 {{ totals.hasPatchCount }}/{{ totals.fileCount }}</span>
        <span>只读</span>
      </div>
      <div class="diff-list">
        <section v-for="file in files" :key="file.id" class="diff-file">
          <button class="diff-file-head" type="button" :aria-expanded="isFileOpen(file.id)" @click="toggleFile(file.id)">
            <span class="mso">{{ isFileOpen(file.id) ? 'folder_open' : 'draft' }}</span>
            <span class="diff-file-name">{{ file.file }}</span>
            <span class="diff-file-status">{{ file.status }}</span>
            <span class="diff-stat add">+{{ file.additions }}</span>
            <span class="diff-stat del">-{{ file.deletions }}</span>
            <span class="mso">{{ isFileOpen(file.id) ? 'expand_less' : 'expand_more' }}</span>
          </button>
          <div v-if="isFileOpen(file.id)" class="diff-file-body">
            <div v-if="!file.hasPatch" class="diff-empty">
              当前 OpenCode diff 只返回文件摘要，没有返回 patch 详情。
            </div>
            <div v-else class="diff-hunks">
              <div v-for="hunk in file.hunks" :key="hunk.id" class="diff-hunk">
                <div class="diff-hunk-head">{{ hunk.header }}</div>
                <div class="diff-lines" role="table" aria-label="文件 diff 行">
                  <div
                    v-for="line in hunk.lines"
                    :key="line.id"
                    class="diff-line"
                    :class="`line-${line.kind}`"
                    role="row"
                  >
                    <span class="diff-line-number" role="cell">{{ lineNumber(line) }}</span>
                    <code role="cell">{{ line.text || ' ' }}</code>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.diff-dock {
  border-top: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 92%, var(--olive-pale));
  padding: 7px 12px;
}
.diff-summary {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink2);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
}
.diff-summary-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.diff-status-summary {
  color: var(--ink3);
  font-size: 11px;
  font-weight: 650;
  white-space: nowrap;
}
.diff-review-panel {
  display: grid;
  gap: 7px;
  margin-top: 7px;
}
.diff-review-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ink3);
  font-size: 11px;
  line-height: 1.4;
}
.diff-review-meta span + span::before {
  content: " · ";
}
.diff-list {
  display: grid;
  gap: 7px;
}
.diff-file {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  overflow: hidden;
}
.diff-file-head {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--ink2);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  text-align: left;
}
.diff-file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.diff-file-status {
  color: var(--ink3);
  font-size: 11px;
}
.diff-stat {
  font-weight: 800;
}
.diff-stat.add {
  color: #1b7f36;
}
.diff-stat.del {
  color: #b42318;
}
.diff-file-body {
  border-top: 1px solid var(--border);
}
.diff-empty {
  padding: 9px;
  color: var(--ink3);
  font-size: 12px;
}
.diff-hunks {
  display: grid;
}
.diff-hunk + .diff-hunk {
  border-top: 1px solid var(--border);
}
.diff-hunk-head {
  padding: 6px 9px;
  background: color-mix(in srgb, var(--surface) 84%, var(--olive-pale));
  color: var(--ink3);
  font-family: 'SF Mono', monospace;
  font-size: 11px;
  line-height: 1.35;
}
.diff-lines {
  max-height: 260px;
  overflow: auto;
}
.diff-line {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 8px;
  padding: 0 9px;
  border-top: 1px solid color-mix(in srgb, var(--border) 42%, transparent);
  font-family: 'SF Mono', monospace;
  font-size: 11px;
  line-height: 1.45;
  white-space: pre;
}
.diff-line-number {
  color: var(--ink3);
  user-select: none;
}
.diff-line code {
  min-width: 0;
  overflow: auto hidden;
  color: var(--ink2);
  font: inherit;
}
.diff-line.line-add {
  background: color-mix(in srgb, var(--surface) 88%, #dcfce7);
}
.diff-line.line-del {
  background: color-mix(in srgb, var(--surface) 88%, #fee2e2);
}
.diff-line.line-meta {
  background: color-mix(in srgb, var(--surface) 90%, var(--olive-pale));
}
</style>

<script setup lang="ts">
/**
 * DiffSplitView — 双栏 diff 视图 (Side-by-Side)
 * 对标 OpenCode 官方 split diff 布局
 */
import { computed } from 'vue'
import type { DiffReviewFile, DiffReviewHunk, DiffReviewLine } from '@/opencodeClient/diffReview'

const props = defineProps<{
  file: DiffReviewFile
  showActions?: boolean
}>()

const emit = defineEmits<{
  (e: 'acceptHunk', hunkId: string): void
  (e: 'rejectHunk', hunkId: string): void
  (e: 'clickLine', line: DiffReviewLine): void
}>()

/** 将 hunk 行拆分为左栏 (old) 和右栏 (new) 配对 */
interface SplitRow {
  id: string
  left?: DiffReviewLine
  right?: DiffReviewLine
  kind: 'add' | 'del' | 'modify' | 'context' | 'meta'
}

const splitRows = computed<SplitRow[]>(() => {
  const rows: SplitRow[] = []

  for (const hunk of props.file.hunks) {
    rows.push({
      id: `${hunk.id}:header`,
      kind: 'meta',
    })

    const lines = hunk.lines
    let i = 0
    while (i < lines.length) {
      const line = lines[i]

      if (line.kind === 'del' && i + 1 < lines.length && lines[i + 1].kind === 'add') {
        // paired modify
        rows.push({
          id: `${line.id}:pair`,
          left: line,
          right: lines[i + 1],
          kind: 'modify',
        })
        i += 2
      } else if (line.kind === 'del') {
        rows.push({ id: line.id, left: line, kind: 'del' })
        i += 1
      } else if (line.kind === 'add') {
        rows.push({ id: line.id, right: line, kind: 'add' })
        i += 1
      } else {
        rows.push({ id: line.id, left: line, right: line, kind: 'context' })
        i += 1
      }
    }
  }

  return rows
})

function lineNum(line?: DiffReviewLine): string {
  if (!line) return ''
  return String(line.oldLine ?? line.newLine ?? '')
}

function clickLine(line?: DiffReviewLine) {
  if (line) emit('clickLine', line)
}
</script>

<template>
  <div class="dsv-split">
    <!-- Hunk header row -->
    <template v-for="row in splitRows" :key="row.id">
      <div v-if="row.kind === 'meta'" class="dsv-hunk-head">
        <span class="dsv-hunk-label">@@</span>
      </div>
      <div
        v-else
        class="dsv-row"
        :class="`dsv-${row.kind}`"
      >
        <!-- Left pane (old) -->
        <div
          class="dsv-pane dsv-old"
          :class="{ 'dsv-empty': !row.left }"
          @click="clickLine(row.left)"
        >
          <span class="dsv-ln">{{ lineNum(row.left) }}</span>
          <code class="dsv-text">{{ (row.left as any)?.text?.slice(1) || '' }}</code>
        </div>
        <!-- Right pane (new) -->
        <div
          class="dsv-pane dsv-new"
          :class="{ 'dsv-empty': !row.right }"
          @click="clickLine(row.right)"
        >
          <span class="dsv-ln">{{ lineNum(row.right) }}</span>
          <code class="dsv-text">{{ (row.right as any)?.text?.slice(1) || '' }}</code>
        </div>
        <!-- Action buttons -->
        <div v-if="showActions && row.kind !== 'context'" class="dsv-actions">
          <button
            v-if="row.kind === 'add' || row.kind === 'modify'"
            class="dsv-accept"
            title="接受此变更"
            @click.stop="emit('acceptHunk', row.id)"
          >✓</button>
          <button
            v-if="row.kind === 'del' || row.kind === 'modify'"
            class="dsv-reject"
            title="拒绝此变更"
            @click.stop="emit('rejectHunk', row.id)"
          >✗</button>
        </div>
      </div>
    </template>

    <div v-if="splitRows.length === 0" class="dsv-empty-msg">
      无可显示的 diff 内容
    </div>
  </div>
</template>

<style scoped>
.dsv-split {
  font-family: 'SF Mono', monospace;
  font-size: 11px;
  line-height: 1.45;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.dsv-hunk-head {
  padding: 4px 8px;
  background: color-mix(in srgb, var(--surface) 84%, var(--olive-pale));
  color: var(--ink3);
  font-weight: 700;
  border-bottom: 1px solid var(--line);
}
.dsv-hunk-label {
  color: #1565c0;
}

.dsv-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  min-height: 20px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
}
.dsv-row:has(.dsv-actions) {
  grid-template-columns: 1fr 1fr auto;
}

.dsv-pane {
  display: flex;
  align-items: baseline;
  padding: 1px 6px;
  gap: 6px;
  cursor: pointer;
  overflow: hidden;
}
.dsv-pane:hover {
  filter: brightness(0.97);
}

.dsv-old {
  background: color-mix(in srgb, var(--surface) 92%, #fee2e2);
  border-right: 1px solid var(--line);
}
.dsv-new {
  background: color-mix(in srgb, var(--surface) 92%, #dcfce7);
}
.dsv-context .dsv-old,
.dsv-context .dsv-new {
  background: var(--surface);
}

.dsv-del .dsv-new { background: var(--surface); }
.dsv-add .dsv-old { background: var(--surface); }

.dsv-empty {
  opacity: 0.4;
}

.dsv-ln {
  flex-shrink: 0;
  width: 28px;
  text-align: right;
  color: var(--ink3);
  user-select: none;
  font-size: 10px;
}

.dsv-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: pre;
  color: var(--ink1);
}

.dsv-actions {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 1px 2px;
  background: var(--surface);
  border-left: 1px solid var(--line);
}

.dsv-accept,
.dsv-reject {
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all .12s;
}
.dsv-accept {
  color: #1b7a1b;
  background: rgba(27,122,27,.06);
}
.dsv-accept:hover {
  background: rgba(27,122,27,.18);
}
.dsv-reject {
  color: #c62828;
  background: rgba(198,40,40,.06);
}
.dsv-reject:hover {
  background: rgba(198,40,40,.18);
}

.dsv-empty-msg {
  padding: 16px;
  text-align: center;
  color: var(--ink3);
  font-size: 12px;
}
</style>

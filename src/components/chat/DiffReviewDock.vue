<script setup lang="ts">
/**
 * DiffReviewDock.vue — 变更审查面板（完全对齐 OpenCode 官方）
 *
 * 官方布局：
 *   [审查 N]                               ← 顶栏
 *   [Git changes ▾]  [统一][拆分] [全部展开] ← 筛选+控制
 *   文件列表：图标 + 路径 + 状态标签 + 行数统计
 */
import { computed, ref } from 'vue'
import { buildDiffReviewModel } from '@/opencodeClient/diffReview'
import type { OpenCodeDiffFile } from '@/composables/useChat'

const props = defineProps<{
  diffs?: OpenCodeDiffFile[]
  vcsDiffs?: OpenCodeDiffFile[]
  vcsBranchDiffs?: OpenCodeDiffFile[]
  turnDiffs?: OpenCodeDiffFile[]
  vcsBranch?: string
  directory?: string
}>()

type DiffSource = 'turn' | 'git' | 'branch'

const source = ref<DiffSource>('turn')
const openFileIds = ref(new Set<string>())
const splitView = ref(false)

const hasTurn = computed(() => (props.turnDiffs?.length || props.diffs?.length || 0) > 0)
const hasGit = computed(() => (props.vcsDiffs?.length || 0) > 0)
const hasBranch = computed(() => (props.vcsBranchDiffs?.length || 0) > 0)

const currentDiffs = computed(() => {
  if (source.value === 'git') return props.vcsDiffs || []
  if (source.value === 'branch') return props.vcsBranchDiffs || []
  return props.turnDiffs?.length ? props.turnDiffs : (props.diffs || [])
})

const review = computed(() => buildDiffReviewModel(currentDiffs.value))
const files = computed(() => review.value.files)
const totalCount = computed(() => files.value.length)

function expandAll() { openFileIds.value = new Set(files.value.map(f => f.id)) }
function toggleFile(id: string) {
  const next = new Set(openFileIds.value)
  if (next.has(id)) { next.delete(id) } else { next.add(id) }
  openFileIds.value = next
}

function fileIcon(file: { file: string; status: string }): string {
  const ext = file.file.split('.').pop()?.toLowerCase() || ''
  if (['png','jpg','jpeg','gif','svg','webp','ico','icns'].includes(ext)) return 'image'
  if (file.status === 'added') return 'note_add'
  if (file.status === 'deleted') return 'delete'
  return 'draft'
}

function lineNumber(line: { oldLine?: number; newLine?: number }, side: 'old' | 'new'): string {
  if (side === 'old') return line.oldLine === undefined ? '' : String(line.oldLine)
  return line.newLine === undefined ? '' : String(line.newLine)
}

const sourceOptions = computed(() => [
  { value: 'turn' as const, label: '上一轮变更', count: props.turnDiffs?.length || props.diffs?.length || 0, show: hasTurn.value },
  { value: 'git' as const, label: 'Git changes', count: props.vcsDiffs?.length || 0, show: hasGit.value },
  { value: 'branch' as const, label: 'Branch changes', count: props.vcsBranchDiffs?.length || 0, show: hasBranch.value },
].filter(o => o.show))
</script>

<template>
  <div v-if="hasTurn || hasGit || hasBranch" class="dr-root">
    <!-- 顶栏 -->
    <div class="dr-topbar">
      <span class="dr-review-badge">审查 {{ totalCount }}</span>
      <select v-model="source" class="dr-source-select">
        <option v-for="opt in sourceOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }} ({{ opt.count }})
        </option>
      </select>
      <span class="dr-spacer"></span>
      <span class="dr-toggle-group">
        <button :class="{ active: !splitView }" @click="splitView = false">统一</button>
        <button :class="{ active: splitView }" @click="splitView = true">拆分</button>
      </span>
      <button class="dr-expand-btn" @click="expandAll">
        <JcIcon name="expand_more" />
        全部展开
      </button>
    </div>

    <!-- 文件列表 -->
    <div class="dr-list">
      <div v-for="file in files" :key="file.id" class="dr-file">
        <div class="dr-file-head" @click="toggleFile(file.id)">
          <JcIcon :name="openFileIds.has(file.id) ? 'expand_more' : 'chevron_right'" class="dr-chevron" />
          <JcIcon :name="fileIcon(file)" class="dr-file-icon" />
          <span class="dr-file-name">{{ file.file }}</span>
          <span class="dr-file-status" :class="`st-${file.status}`">{{ file.status }}</span>
          <span class="dr-stat add" v-if="file.additions > 0">+{{ file.additions }}</span>
          <span class="dr-stat del" v-if="file.deletions > 0">-{{ file.deletions }}</span>
        </div>

        <div v-if="openFileIds.has(file.id)" class="dr-file-body">
          <div v-if="!file.hasPatch" class="dr-empty">二进制文件，无可显示的文本差异。</div>
          <template v-else>
            <div v-for="hunk in file.hunks" :key="hunk.id" class="dr-hunk">
              <div class="dr-hunk-head">{{ hunk.header }}</div>
              <div class="dr-lines" :class="{ split: splitView }">
                <div v-for="line in hunk.lines" :key="line.id" class="dr-line" :class="`dr-line-${line.kind}`">
                  <span v-if="splitView" class="dr-ln-old">{{ lineNumber(line, 'old') }}</span>
                  <span v-if="splitView" class="dr-ln-new">{{ lineNumber(line, 'new') }}</span>
                  <span v-else class="dr-ln">{{ lineNumber(line, 'old') }} {{ lineNumber(line, 'new') }}</span>
                  <code>{{ line.text || ' ' }}</code>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dr-root {
  border-top: 1px solid var(--border);
  background: var(--paper);
  font-size: 12px;
}

/* top bar */
.dr-topbar {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px; border-bottom: 1px solid var(--border);
}
.dr-review-badge {
  background: var(--surface); color: var(--ink1); font-weight: 700;
  padding: 3px 10px; border-radius: 12px; font-size: 12px;
  border: 1px solid var(--border);
}
.dr-source-select {
  padding: 3px 8px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--surface); color: var(--ink1); font-size: 12px;
  cursor: pointer; outline: none;
}
.dr-spacer { flex: 1; }
.dr-toggle-group {
  display: inline-flex; border: 1px solid var(--border); border-radius: 5px;
  overflow: hidden;
}
.dr-toggle-group button {
  padding: 3px 10px; border: 0; background: transparent;
  color: var(--ink2); font-size: 11px; cursor: pointer;
}
.dr-toggle-group button.active {
  background: var(--paper); color: var(--ink1); font-weight: 600;
  box-shadow: 0 1px 2px rgba(0,0,0,.06);
}
.dr-expand-btn {
  display: flex; align-items: center; gap: 4px;
  padding: 3px 10px; border: 1px solid var(--border); border-radius: 5px;
  background: var(--surface); color: var(--ink2); font-size: 11px; cursor: pointer;
}

/* file list */
.dr-list { }
.dr-file { border-bottom: 1px solid var(--line); }
.dr-file-head {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 12px; cursor: pointer; font-size: 12px;
}
.dr-file-head:hover { background: var(--surface); }
.dr-chevron { font-size: 16px; color: var(--ink3); flex-shrink: 0; }
.dr-file-icon { font-size: 15px; color: #0d9488; flex-shrink: 0; }
.dr-file-name {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--ink1); font-weight: 500;
}
.dr-file-status {
  font-size: 10px; padding: 1px 5px; border-radius: 3px; font-weight: 600; text-transform: uppercase;
}
.st-added { background: #dcfce7; color: #166534; }
.st-modified { background: #fef3c7; color: #92400e; }
.st-deleted { background: #fee2e2; color: #991b1b; }
.st-renamed { background: #dbeafe; color: #1e40af; }
.dr-stat { font-weight: 800; font-size: 11px; min-width: 36px; text-align: right; }
.dr-stat.add { color: #166534; }
.dr-stat.del { color: #991b1b; }

/* file body */
.dr-file-body { border-top: 1px solid var(--line); }
.dr-empty { padding: 12px; color: var(--ink3); font-size: 12px; text-align: center; }
.dr-hunk + .dr-hunk { border-top: 1px solid var(--line); }
.dr-hunk-head {
  padding: 3px 12px; background: color-mix(in srgb, var(--surface) 85%, var(--olive-pale));
  color: var(--ink2); font-family: 'SF Mono', monospace; font-size: 11px;
}
.dr-lines { max-height: 300px; overflow: auto; }
.dr-line {
  display: grid; gap: 8px; padding: 0 12px;
  border-top: 1px solid color-mix(in srgb, var(--border) 25%, transparent);
  font-family: 'SF Mono', monospace; font-size: 11px; line-height: 1.5; white-space: pre;
}
.dr-lines:not(.split) .dr-line { grid-template-columns: 72px 1fr; }
.dr-lines.split .dr-line { grid-template-columns: 40px 40px 1fr; }
.dr-ln, .dr-ln-old, .dr-ln-new { color: var(--ink3); user-select: none; text-align: right; }
.dr-line code { color: var(--ink2); font: inherit; overflow: auto hidden; }
.dr-line-add { background: color-mix(in srgb, var(--surface) 88%, #dcfce7); }
.dr-line-del { background: color-mix(in srgb, var(--surface) 88%, #fee2e2); }
.dr-line-meta { background: color-mix(in srgb, var(--surface) 90%, var(--olive-pale)); }
</style>

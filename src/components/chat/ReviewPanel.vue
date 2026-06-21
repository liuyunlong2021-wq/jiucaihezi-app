<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useChat, type OpenCodeDiffFile } from '@/composables/useChat'

const { sessionDiffs, turnDiffs, vcsDiffs, vcsInfo, fetchSessionDiffs, fetchVcsInfo, activeOpenCodeSessionId } = useChat()

const changesTab = ref<'turn' | 'git'>('turn')
const activeFile = ref('')
const diffStyle = ref<'unified'>('unified')

// 本轮变更使用 turnDiffs（per-turn from message summary），fallback 到 sessionDiffs
const turnFileDiffs = computed<OpenCodeDiffFile[]>(() => {
  return turnDiffs.value.length > 0 ? turnDiffs.value : sessionDiffs.value || []
})

const fileDiffs = computed<OpenCodeDiffFile[]>(() => {
  if (changesTab.value === 'turn') return turnFileDiffs.value
  return vcsDiffs.value || []
})

const fileGroups = computed(() => {
  const map = new Map<string, OpenCodeDiffFile[]>()
  for (const d of fileDiffs.value) {
    const dir = (d.file || '').includes('/') ? (d.file || '').split('/').slice(0, -1).join('/') : '.'
    if (!map.has(dir)) map.set(dir, [])
    map.get(dir)!.push(d)
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
})

// 文件状态 → 左侧色条 (official: kinds color coding)
function fileStatusClass(status?: string): string {
  if (status === 'added') return 'r-file-added'
  if (status === 'deleted') return 'r-file-deleted'
  return 'r-file-modified'
}

function fileStatusIcon(status?: string): string {
  if (status === 'added') return 'add_circle'
  if (status === 'deleted') return 'remove_circle'
  return 'edit_square'
}

function coloredPatch(patch?: string): string {
  if (!patch) return ''
  const lines = patch.split('\n')
  return lines.map(line => {
    const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    if (line.startsWith('+') && !line.startsWith('+++')) return `<span class="r-diff-add">${escaped}</span>`
    if (line.startsWith('-') && !line.startsWith('---')) return `<span class="r-diff-del">${escaped}</span>`
    if (line.startsWith('@@')) return `<span class="r-diff-hunk">${escaped}</span>`
    return escaped
  }).join('\n')
}

function toggleFile(file: string) {
  activeFile.value = activeFile.value === file ? '' : file
}

// Auto-fetch diffs when panel mounts (official: createEffect when wantsReview)
onMounted(async () => {
  if (activeOpenCodeSessionId.value) {
    await fetchSessionDiffs()
  }
  // Also try fetching VCS info
  fetchVcsInfo()
})
</script>

<template>
  <div class="review-panel">
    <!-- Header -->
    <div class="review-header">
      <JcIcon name="rate_review" />
      <span class="review-title">变更审查</span>
      <span v-if="turnFileDiffs.length" class="review-badge">{{ turnFileDiffs.length }}</span>
    </div>

    <!-- Tab bar -->
    <div class="review-tabs">
      <button
        class="review-tab" :class="{ active: changesTab === 'turn' }"
        @click="changesTab = 'turn'"
      >本轮变更<span v-if="turnFileDiffs.length" class="tab-count">{{ turnFileDiffs.length }}</span></button>
      <button
        class="review-tab" :class="{ active: changesTab === 'git' }"
        @click="changesTab = 'git'"
      >Git 变更<span v-if="vcsInfo?.branch" class="tab-count">{{ vcsInfo.branch }}</span></button>
      <button class="review-tab review-diff-toggle" title="Diff 风格" disabled>{{ diffStyle === 'unified' ? '统一' : '分栏' }}</button>
    </div>

    <!-- Git tab: empty state -->
    <div v-if="changesTab === 'git' && !vcsDiffs.length" class="review-empty">
      <template v-if="vcsInfo?.branch">
        当前分支：<strong>{{ vcsInfo.branch }}</strong><br />
        工作树无变更。
      </template>
      <template v-else>暂无 Git 仓库信息。在 Git 项目中打开 OpenCode 会话后可显示变更。</template>
    </div>

    <!-- Turn tab: empty state -->
    <div v-if="changesTab === 'turn' && !turnFileDiffs.length" class="review-empty">
      本轮暂无文件变更。让 AI 修改项目文件后这里会显示 diff。
    </div>

    <!-- File list + diff preview (shared by both tabs) -->
    <div v-for="[dir, files] in fileGroups" :key="dir" class="review-group">
      <div v-if="dir !== '.'" class="review-dir">{{ dir }}/</div>
      <div
        v-for="diff in files"
        :key="diff.file || ''"
        class="review-file"
        :class="[fileStatusClass(diff.status), { open: activeFile === diff.file }]"
        @click="toggleFile(diff.file || '')"
      >
        <div class="review-file-row">
          <JcIcon :name="fileStatusIcon(diff.status)" class="review-file-icon" />
          <span class="review-file-name">{{ dir === '.' ? (diff.file || '') : (diff.file || '').split('/').pop() }}</span>
          <span class="review-stats">
            <span v-if="diff.additions" class="review-add">+{{ diff.additions }}</span>
            <span v-if="diff.deletions" class="review-del">-{{ diff.deletions }}</span>
          </span>
          <JcIcon :name="activeFile === diff.file ? 'expand_less' : 'expand_more'" class="review-chevron" />
        </div>
        <!-- Diff preview -->
        <div v-if="activeFile === diff.file && diff.patch" class="review-diff-preview">
          <pre class="review-diff-content" v-html="coloredPatch(diff.patch)" />
        </div>
        <div v-else-if="activeFile === diff.file && !diff.patch" class="review-diff-preview review-diff-empty">
          暂无 diff 内容
        </div>
      </div>
    </div>

    <!-- Summary bar -->
    <div v-if="fileDiffs.length" class="review-footer">
      共 {{ fileDiffs.length }} 个文件变更
    </div>
  </div>
</template>

<style scoped>
.review-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  padding: 14px 16px 10px;
}
.review-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.review-header .mso { font-size: 18px; color: var(--olive-dark); }
.review-title { font-size: 13px; font-weight: 750; color: var(--ink); }
.review-badge {
  background: var(--olive-pale);
  color: var(--olive-dark);
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 10px;
  margin-left: auto;
}

/* Tab Switcher */
.review-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line);
}
.review-tab {
  border: none;
  background: transparent;
  color: var(--ink3);
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 5px;
  cursor: pointer;
  transition: all .12s;
}
.review-tab:hover { background: var(--olive-pale); color: var(--ink1); }
.review-tab.active { background: var(--olive-pale); color: var(--olive-dark); font-weight: 750; }
.review-diff-toggle { margin-left: auto; opacity: .5; cursor: default; }
.tab-count {
  margin-left: 4px;
  font-size: 10px;
  font-weight: 700;
  padding: 0 4px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--olive-dark) 15%, transparent);
}

.review-empty {
  font-size: 12px;
  color: var(--ink3);
  text-align: center;
  padding: 32px 8px;
  line-height: 1.6;
}

/* File list */
.review-group { margin-bottom: 8px; }
.review-dir {
  font-size: 10px;
  font-weight: 750;
  color: var(--ink3);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 2px 4px;
  margin-bottom: 2px;
}
.review-file {
  border-radius: 6px;
  cursor: pointer;
  transition: background .1s;
  margin-bottom: 1px;
  border-left: 3px solid transparent;
}
.review-file:hover { background: var(--olive-pale); }
.review-file.open { background: color-mix(in srgb, var(--olive-pale) 60%, transparent); }
/* 按状态着色左侧边框 (official: kinds color coding) */
.r-file-added    { border-left-color: #2da44e; }
.r-file-deleted  { border-left-color: #cf222e; }
.r-file-modified { border-left-color: #d4a72c; }
.review-file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
}
.review-file-icon { font-size: 14px; color: var(--ink3); flex: 0 0 auto; }
.review-file-name {
  flex: 1;
  font-size: 12px;
  color: var(--ink1);
  font-family: 'SF Mono', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.review-stats { display: flex; gap: 4px; flex: 0 0 auto; }
.review-add { color: #1b7a1b; font-weight: 700; font-size: 11px; }
.review-del { color: #c62828; font-weight: 700; font-size: 11px; }
.review-chevron { font-size: 14px; color: var(--ink3); }

/* Diff preview */
.review-diff-preview {
  padding: 0 8px 8px 30px;
}
.review-diff-content {
  max-height: 300px;
  margin: 0;
  padding: 8px 10px;
  overflow: auto;
  border-radius: 6px;
  background: var(--paper);
  font-family: 'SF Mono', monospace;
  font-size: 11px;
  line-height: 1.55;
  color: var(--ink2);
  white-space: pre-wrap;
  word-break: break-word;
  border: 1px solid var(--line);
}
.review-diff-content :deep(.r-diff-add) { color: #1b7a1b; background: rgba(27,122,27,.06); display: block; }
.review-diff-content :deep(.r-diff-del) { color: #c62828; background: rgba(198,40,40,.06); display: block; }
.review-diff-content :deep(.r-diff-hunk) { color: #1565c0; font-weight: 700; display: block; }
.review-diff-empty { color: var(--ink3); font-size: 11px; font-style: italic; }

.review-footer {
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  font-size: 11px;
  color: var(--ink3);
  text-align: center;
}
</style>

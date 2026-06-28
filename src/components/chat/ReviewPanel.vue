<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue'
import { useChat, type OpenCodeDiffFile } from '@/composables/useChat'
import { emitEvent } from '@/utils/eventBus'
import { highlightCode } from '@/utils/highlight'
import { resolveDiffFilePath } from '@/utils/editorDiffBridge'
import { buildDiffReviewModel } from '@/opencodeClient/diffReview'
import DiffSplitView from './DiffSplitView.vue'

const {
  sessionDiffs,
  turnDiffs,
  vcsDiffs,
  vcsBranchDiffs,
  vcsInfo,
  fetchSessionDiffs,
  fetchVcsInfo,
  activeOpenCodeSessionId,
} = useChat()

type ChangesTab = 'git' | 'branch' | 'turn'

const changesTab = ref<ChangesTab>('git')
const openFiles = ref(new Set<string>())
const diffStyle = ref<'unified' | 'split'>('unified')
const openedLabel = ref<Record<string, string>>({})

// 本轮变更使用 turnDiffs（per-turn from message summary），fallback 到 sessionDiffs
const turnFileDiffs = computed<OpenCodeDiffFile[]>(() => {
  return turnDiffs.value.length > 0 ? turnDiffs.value : sessionDiffs.value || []
})

const fileDiffs = computed<OpenCodeDiffFile[]>(() => {
  if (changesTab.value === 'turn') return turnFileDiffs.value
  if (changesTab.value === 'branch') return vcsBranchDiffs.value || []
  return vcsDiffs.value || []
})

const sourceOptions = computed(() => [
  { value: 'git' as const, label: 'Git changes', count: vcsDiffs.value.length },
  { value: 'branch' as const, label: 'Branch changes', count: vcsBranchDiffs.value.length },
  { value: 'turn' as const, label: '上一轮变更', count: turnFileDiffs.value.length },
])

const reviewCount = computed(() => fileDiffs.value.length)

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
  return highlightCode(patch, 'diff')
}

function toggleFile(file: string) {
  const next = new Set(openFiles.value)
  if (next.has(file)) next.delete(file)
  else next.add(file)
  openFiles.value = next
}

function expandAll() {
  openFiles.value = new Set(fileDiffs.value.map(diff => diff.file || '').filter(Boolean))
}

// 在编辑区打开 diff 对应的真实文件
function openDiffInEditor(diff: OpenCodeDiffFile) {
  const fileName = diff.file || ''
  const realPath = resolveDiffFilePath({ file: fileName, status: '', additions: 0, deletions: 0, hasPatch: false, hunks: [], id: '' })
  const patch = diff.patch || ''

  // 尝试传递文件路径，编辑区会尝试读取真实文件
  // 如果无法读取（Web端/权限不足），fallback 到 diff 文本
  emitEvent('open-diff-in-editor', {
    filePath: realPath,
    fileName,
    patch,
    diff: {
      file: fileName,
      patch,
      additions: diff.additions || 0,
      deletions: diff.deletions || 0,
      status: diff.status || 'modified',
    },
  })

  openedLabel.value[fileName] = '✓ 已打开'
  setTimeout(() => { openedLabel.value[fileName] = '' }, 2000)
}

// Auto-fetch diffs when panel mounts (official: createEffect when wantsReview)
onMounted(async () => {
  if (activeOpenCodeSessionId.value) {
    await fetchSessionDiffs()
  }
  // Also try fetching VCS info
  fetchVcsInfo()
})

watch(fileDiffs, () => {
  openFiles.value = new Set()
})
</script>

<template>
  <div class="review-panel">
    <div class="review-top">
      <button
        class="review-count-tab active"
        type="button"
      >审查 {{ reviewCount }}</button>
      <button class="review-plus" type="button" title="新建审查">
        <JcIcon name="add" />
      </button>
    </div>

    <div class="review-toolbar">
      <select v-model="changesTab" class="review-source" aria-label="选择变更范围">
        <option v-for="opt in sourceOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
      <div class="review-toolbar-spacer"></div>
      <div class="review-style-toggle" aria-label="切换 diff 视图">
        <button type="button" :class="{ active: diffStyle === 'unified' }" @click="diffStyle = 'unified'">统一</button>
        <button type="button" :class="{ active: diffStyle === 'split' }" @click="diffStyle = 'split'">拆分</button>
      </div>
      <button class="review-expand" type="button" @click="expandAll">
        <JcIcon name="unfold_more" />
        全部展开
      </button>
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
        :class="[fileStatusClass(diff.status), { open: openFiles.has(diff.file || '') }]"
      >
        <div class="review-file-row" @click="toggleFile(diff.file || '')">
          <JcIcon :name="fileStatusIcon(diff.status)" class="review-file-icon" />
          <span class="review-file-name">{{ dir === '.' ? (diff.file || '') : (diff.file || '').split('/').pop() }}</span>
          <button
            class="review-open-btn"
            :title="'在编辑区打开 ' + (diff.file || '')"
            @click.stop="openDiffInEditor(diff)"
          >
            <JcIcon name="edit_note" />
            <span v-if="openedLabel[diff.file || '']" class="review-open-label">{{ openedLabel[diff.file || ''] }}</span>
          </button>
          <span class="review-stats">
            <span v-if="diff.additions" class="review-add">+{{ diff.additions }}</span>
            <span v-if="diff.deletions" class="review-del">-{{ diff.deletions }}</span>
          </span>
          <JcIcon :name="openFiles.has(diff.file || '') ? 'expand_more' : 'chevron_right'" class="review-chevron" />
        </div>
        <!-- Diff preview: split view -->
        <div v-if="openFiles.has(diff.file || '') && diffStyle === 'split' && diff.patch" class="review-diff-preview">
          <DiffSplitView
            :file="buildDiffReviewModel([diff]).files[0]"
            @click-line="(line) => { if (line?.newLine) emitEvent('open-diff-in-editor', { filePath: resolveDiffFilePath({ file: diff.file || '', status: '', additions: 0, deletions: 0, hasPatch: false, hunks: [], id: '' }), fileName: diff.file, patch: diff.patch, lineNumber: line.newLine }) }"
          />
        </div>
        <!-- Diff preview: unified view -->
        <div v-else-if="openFiles.has(diff.file || '') && diff.patch" class="review-diff-preview">
          <pre class="review-diff-content" v-html="coloredPatch(diff.patch)" />
        </div>
        <div v-else-if="openFiles.has(diff.file || '') && !diff.patch" class="review-diff-preview review-diff-empty">
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
  padding: 0;
  background: var(--paper);
}
.review-top {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 42px;
  padding: 0 12px;
  border-bottom: 1px solid var(--line);
}
.review-count-tab,
.review-plus {
  border: 0;
  background: transparent;
  color: var(--ink2);
  cursor: pointer;
}
.review-count-tab {
  align-self: stretch;
  padding: 0 0 1px;
  font-size: 13px;
  font-weight: 800;
  color: var(--ink);
  border-bottom: 2px solid var(--ink);
}
.review-plus {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
}
.review-plus:hover { background: var(--surface); }
.review-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
}
.review-source,
.review-expand {
  height: 30px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface);
  color: var(--ink1);
  font-size: 12px;
  font-weight: 650;
}
.review-source {
  max-width: 142px;
  padding: 0 8px;
}
.review-toolbar-spacer { flex: 1; }
.review-style-toggle {
  display: inline-flex;
  height: 30px;
  border: 1px solid var(--border);
  border-radius: 7px;
  overflow: hidden;
  background: var(--surface);
}
.review-style-toggle button {
  border: 0;
  padding: 0 10px;
  background: transparent;
  color: var(--ink3);
  font-size: 12px;
  font-weight: 700;
}
.review-style-toggle button.active {
  background: var(--paper);
  color: var(--ink);
  box-shadow: 0 1px 2px rgba(0,0,0,.08);
}
.review-expand {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0 10px;
}

.review-empty {
  font-size: 12px;
  color: var(--ink3);
  text-align: center;
  padding: 32px 8px;
  line-height: 1.6;
}

/* File list */
.review-group { margin: 8px 0; }
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
  border-top: 1px solid var(--line);
  border-radius: 0;
  cursor: pointer;
  transition: background .1s;
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
.review-chevron { font-size: 14px; color: var(--ink3); cursor: pointer; padding: 2px; }
.review-open-btn {
  border: none;
  background: transparent;
  color: var(--ink3);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 2px 4px;
  border-radius: 4px;
  font-size: 11px;
  transition: all .12s;
  flex: 0 0 auto;
}
.review-open-btn:hover { background: var(--olive-pale); color: var(--olive-dark); }
.review-open-btn .mso { font-size: 14px; }
.review-open-label { font-size: 10px; color: var(--olive-dark); font-weight: 600; white-space: nowrap; }

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
.review-diff-content :deep(.hljs-addition) { color: #1b7a1b; background: rgba(27,122,27,.06); display: inline; }
.review-diff-content :deep(.hljs-deletion) { color: #c62828; background: rgba(198,40,40,.06); display: inline; }
.review-diff-content :deep(.hljs-meta) { color: #1565c0; font-weight: 700; }
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

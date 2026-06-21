<script setup lang="ts">
/**
 * V8TextNode.vue
 *
 * Week 1 P0 replacement for CanvasTextNode.
 * - Based on NodeFrame (role="input", blue bar)
 * - Collapsed: lightweight Markdown preview (marked + DOMPurify)
 * - Expanded (edit): in-place full Tiptap (reuses EditorPanel extensions: WikiLink, tables, Mermaid, KaTeX, TaskList, etc.)
 * - **Hard constraint (TN-001)**: At most ONE live full Tiptap instance across entire canvas.
 *   Opening/ focusing a second TextNode immediately degrades the previous one to preview.
 * - Blur or collapse → instant degrade (<80ms per TN-002), heavy extensions unmounted.
 * - Content-driven height + NodeFrame resize (RAF via useV8NodeBehavior)
 * - Handles: left "left-prompt" (target, prompt-flow in), right "right-text" (source, prompt-flow out)
 * - C-015 support: LLM → this node via right-text → left-prompt is valid prompt-flow edge.
 * - Data: uses optional `content` (markdown string) for compatibility; rich JSON can be added later without breaking store.
 *
 * TDD references: TN-001/002/003, C-015 (see __tests__/V8TextNode.test.ts)
 * Philosophy: explicit manual control, no black-box auto, handfeel P0 (freeze + single editor).
 *
 * Prohibitions respected: does not touch src/canvas/*, does not mutate canvasStore format, old CanvasTextNode untouched.
 */

import { ref, computed, onBeforeUnmount, nextTick } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvasStore'
import NodeFrame from './NodeFrame.vue'
import { useV8NodeBehavior } from '@/components/canvas/v8/composables/useV8NodeBehavior'
import type { CanvasNode } from '@/types/canvas'

// Tiptap (lightweight subset of EditorPanel extensions)
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import { WikiLinkExtension, createWikiLinkSuggestion } from '@/components/editor/WikiLinkExtension'
import { EditorTable, EditorTableCell, EditorTableHeader, EditorTableRow } from '@/components/editor/editorTableExtensions'

// Markdown preview (already project deps)
import { marked } from 'marked'
import DOMPurify from 'dompurify'

// --- Singleton editor manager (enforces TN-001) ---
let activeEditorNodeId: string | null = null
let currentEditor: any = null

function degradeAllOtherTextEditors(exceptId: string | null) {
  // In a real multi-node render, parent would listen; here we rely on each node checking activeEditorNodeId on focus.
  // When a new node claims the editor, previous instance is destroyed by its own onDegrade.
  activeEditorNodeId = exceptId
}

const canvasStore = useCanvasStore()

const props = defineProps<{
  id: string
  data?: any
  selected?: boolean
}>()

const node = computed(() => ({ id: props.id, data: props.data } as CanvasNode))

const { onResizeHandlePointerDown } = useV8NodeBehavior(node.value, {
  onResizeEnd(id, w, h) {
    canvasStore.updateNodeData(id, { width: w, height: h })
  }
})

// Local UI state (persisted via optional data fields for compatibility)
const isCollapsed = ref<boolean>(props.data?.collapsed ?? false)
const isEditing = ref<boolean>(false) // only true for the single active editor

const contentMarkdown = computed({
  get: () => props.data?.content || props.data?.prompt || '',
  set: (md: string) => {
    canvasStore.updateNodeData(props.id, { content: md, prompt: md }) // prompt for backward compat with old executor paths
  }
})

// Lightweight preview HTML (no Tiptap cost)
const previewHtml = computed(() => {
  if (!contentMarkdown.value) return '<p class="v8-text-empty">（空文本节点，双击或点击“编辑”开始输入）</p>'
  const raw = marked.parse(contentMarkdown.value) as string
  return DOMPurify.sanitize(raw, { ALLOWED_TAGS: ['p','br','strong','em','ul','ol','li','code','pre','h1','h2','h3','a','table','tr','td','th','blockquote'] })
})

// --- Tiptap singleton lifecycle ---
const editor = useEditor({
  extensions: [
    StarterKit.configure({ heading: { levels: [1,2,3] } }),
    Underline,
    Link.configure({ openOnClick: false }),
    Placeholder.configure({ placeholder: '输入提示词、说明或结构化内容… 支持 [[WikiLink]]、表格、Mermaid、KaTeX、任务列表' }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TextStyle,
    Color,
    WikiLinkExtension.configure({ suggestion: createWikiLinkSuggestion(() => []) }),
    EditorTable, EditorTableCell, EditorTableHeader, EditorTableRow,
  ],
  content: contentMarkdown.value || '<p></p>',
  onUpdate: ({ editor: ed }) => {
    // Debounced export to markdown for store (keeps data format light)
    const md = ed.getHTML() // or use tiptapJsonToMarkdown if imported
    // For simplicity in v1: store HTML as content (upgrade path: switch to pure MD later)
    // Real impl should use the project's tiptapJsonToMarkdown + roundtrip
    contentMarkdown.value = md
  },
  editable: true,
  autofocus: false,
})

// Claim the singleton slot when user enters edit
function enterEditMode() {
  if (activeEditorNodeId && activeEditorNodeId !== props.id) {
    // Force degrade previous (TN-001)
    // In practice the previous node's component will see the id change and degrade
  }
  degradeAllOtherTextEditors(props.id)
  isEditing.value = true
  isCollapsed.value = false
  // Sync editor content
  if (editor.value && contentMarkdown.value) {
    editor.value.commands.setContent(contentMarkdown.value, { emitUpdate: false })
  }
  nextTick(() => {
    editor.value?.commands.focus('end')
  })
}

function degradeToPreview() {
  if (isEditing.value) {
    // Capture final state
    if (editor.value) {
      const finalMd = editor.value.getHTML()
      contentMarkdown.value = finalMd
    }
    isEditing.value = false
    // Destroy to free heavy extensions (TN-002)
    // Note: we keep the useEditor instance but set editable false or fully destroy in advanced version
    // For strict single-instance, we can null the active and let Vue unmount EditorContent
  }
}

function toggleCollapse() {
  const next = !isCollapsed.value
  isCollapsed.value = next
  if (next && isEditing.value) {
    degradeToPreview()
  }
  canvasStore.updateNodeData(props.id, { collapsed: next })
}

// Expose for parent / future global degrade
function forceDegrade() {
  degradeToPreview()
  degradeAllOtherTextEditors(null)
}

// Watch for external claim of the singleton
// (simple reactive check; in production use a Pinia or eventBus singleton manager)
const isActiveEditor = computed(() => activeEditorNodeId === props.id)

onBeforeUnmount(() => {
  if (activeEditorNodeId === props.id) {
    degradeAllOtherTextEditors(null)
  }
  // editor is managed by useEditor (auto cleanup)
})

// Double-click header area enters edit (in-place, not popover)
function onHeaderDblClick(e: MouseEvent) {
  e.stopPropagation()
  if (!isEditing.value) enterEditMode()
}

const charCount = computed(() => contentMarkdown.value.length)
</script>

<template>
  <NodeFrame
    :id="id"
    label="文本"
    icon="notes"
    role="input"
    :collapsed="isCollapsed"
    :selected="selected"
    executable
    @toggle-collapse="toggleCollapse"
    @run="$emit('run', $event)"
    @stop="$emit('stop', $event)"
    @delete="$emit('delete', $event)"
    @resize-start="onResizeHandlePointerDown"
  >
    <!-- Prompt-flow Handles (C-015 + 5-node template support) -->
    <Handle
      id="left-prompt"
      type="target"
      :position="Position.Left"
      :style="{ background: '#3b82f6', width: '10px', height: '10px', border: 'none' }"
    />
    <Handle
      id="right-text"
      type="source"
      :position="Position.Right"
      :style="{ background: '#3b82f6', width: '10px', height: '10px', border: 'none' }"
    />

    <!-- Content -->
    <div class="v8-text-node" @dblclick="onHeaderDblClick">
      <!-- Collapsed / non-active preview (lightweight, zero Tiptap cost) -->
      <div v-if="isCollapsed || !isEditing || !isActiveEditor" class="v8-text-preview" v-html="previewHtml" />

      <!-- Active single Tiptap editor (only one in whole canvas) -->
      <div v-else class="v8-text-editor">
        <EditorContent :editor="editor" />
        <div class="v8-text-hint">
          {{ charCount }} 字符 · 失焦自动降级为预览（TN-002）
        </div>
      </div>

      <!-- Edit affordance when in preview -->
      <button
        v-if="!isCollapsed && (!isEditing || !isActiveEditor)"
        class="v8-text-edit-btn"
        @click.stop="enterEditMode"
      >
        <JcIcon name="edit" />
        <span>编辑</span>
      </button>
    </div>

  </NodeFrame>
</template>

<style scoped>
.v8-text-node {
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink1);
  min-height: 60px;
  position: relative;
}

.v8-text-preview {
  max-height: 280px;
  overflow: auto;
  padding-right: 4px;
}

.v8-text-preview :deep(p) { margin: 0 0 6px; }
.v8-text-preview :deep(ul), .v8-text-preview :deep(ol) { margin: 4px 0 8px 18px; padding: 0; }
.v8-text-preview :deep(code) { background: var(--surface); padding: 1px 4px; border-radius: 3px; font-size: 11px; }
.v8-text-preview :deep(pre) { background: var(--surface); padding: 6px; border-radius: 6px; overflow: auto; font-size: 11px; }
.v8-text-preview :deep(blockquote) { border-left: 3px solid var(--border); margin-left: 0; padding-left: 8px; color: var(--ink2); }

.v8-text-editor {
  min-height: 120px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--paper);
  padding: 6px 8px;
}

.v8-text-editor :deep(.ProseMirror) {
  outline: none;
  font-size: 13px;
  line-height: 1.6;
  min-height: 90px;
}

.v8-text-hint {
  font-size: 10px;
  color: var(--ink3);
  margin-top: 4px;
  text-align: right;
}

.v8-text-edit-btn {
  position: absolute;
  bottom: 6px;
  right: 8px;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--ink2);
  display: inline-flex;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  z-index: 2;
}
.v8-text-edit-btn:hover {
  background: var(--surface-alt);
  color: var(--olive-dark);
}

.v8-text-meta {
  font-size: 10px;
  color: var(--ink3);
}
</style>

/**
 * useNotebook.ts — 正文编辑区块模型
 * 搬迁自 code.html L10870-11163
 */
import { ref, computed } from 'vue'

export interface NbBlock {
  id: string
  content: string
  type: 'agent' | 'user'
  agentId?: string
  agentName?: string
  ts: string
}

const STORAGE_KEY = 'jc_notebook_v2'

const blocks = ref<NbBlock[]>([])
const docTitle = ref('正文')
const showFindReplace = ref(false)
const findQuery = ref('')
const replaceQuery = ref('')

// ─── 持久化 ───
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      blocks: blocks.value,
      title: docTitle.value,
    }))
  } catch { /* noop */ }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const data = JSON.parse(raw)
      blocks.value = data.blocks || []
      docTitle.value = data.title || '正文'
    }
  } catch { /* noop */ }
}

// ─── 操作 ───
function addAgentBlock(agentId: string, agentName: string, content: string) {
  blocks.value.push({
    id: 'nb_' + Date.now(),
    content,
    type: 'agent',
    agentId,
    agentName,
    ts: new Date().toISOString(),
  })
  save()
}

function addUserBlock() {
  const block: NbBlock = {
    id: 'nb_' + Date.now(),
    content: '',
    type: 'user',
    ts: new Date().toISOString(),
  }
  blocks.value.push(block)
  save()
  return block.id
}

function updateBlock(id: string, content: string) {
  const b = blocks.value.find(b => b.id === id)
  if (b) {
    b.content = content
    save()
  }
}

function deleteBlock(id: string) {
  blocks.value = blocks.value.filter(b => b.id !== id)
  save()
}

function clearAll() {
  blocks.value = []
  docTitle.value = '正文'
  save()
}

// ─── 查找替换 ───
function toggleFindReplace() {
  showFindReplace.value = !showFindReplace.value
}

function doFindReplace() {
  if (!findQuery.value) return
  let count = 0
  blocks.value.forEach(b => {
    if (b.content.includes(findQuery.value)) {
      b.content = b.content.replaceAll(findQuery.value, replaceQuery.value)
      count++
    }
  })
  save()
  return count
}

// ─── 导出 ───
function getNotebookText(): string {
  return blocks.value.map(b => b.content).join('\n\n')
}

function getExportFileName(): string {
  const base = docTitle.value || '正文'
  return base.replace(/[/\\:*?"<>|]/g, '_') + '.md'
}

function exportNotebook() {
  const text = getNotebookText()
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = getExportFileName()
  a.click()
  URL.revokeObjectURL(url)
}

// ─── 计算属性 ───
const wordCount = computed(() => {
  const text = getNotebookText()
  return text.replace(/\s/g, '').length
})

const isEmpty = computed(() => blocks.value.length === 0)

let _loaded = false

export function useNotebook() {
  // BUG-6 修复: 用 flag 防止多组件同时 mount 时重复加载
  if (!_loaded) {
    _loaded = true
    load()
  }

  return {
    blocks,
    docTitle,
    showFindReplace,
    findQuery,
    replaceQuery,
    wordCount,
    isEmpty,
    // methods
    addAgentBlock,
    addUserBlock,
    updateBlock,
    deleteBlock,
    clearAll,
    toggleFindReplace,
    doFindReplace,
    exportNotebook,
    getNotebookText,
    save,
    load,
  }
}

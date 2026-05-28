/**
 * canvasRhToolsStore — RH 工具集 Pinia store
 * 对齐 T8 RHToolsProvider，管理用户自定义的 RH 工具模板
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface RhToolField {
  nodeId: string
  fieldName: string
  label: string
  fieldType: 'image' | 'video' | 'audio' | 'text' | 'number' | 'select'
  defaultValue?: any
  options?: string[]
  required?: boolean
}

export interface RhTool {
  id: string
  name: string
  icon: string
  color: string
  webappId: string
  fields: RhToolField[]
  createdAt: number
  updatedAt: number
}

const STORAGE_KEY = 'jc_canvas_rh_tools'

// 全局 RH API Key（不持久化到 localStorage，仅会话内存）
const globalRhApiKey = ref<string>('')
const globalUseGateway = ref<boolean>(true)

export function getGlobalRhApiKey(): string { return globalRhApiKey.value }
export function setGlobalRhApiKey(k: string) { globalRhApiKey.value = k }
export function getGlobalRhUseGateway(): boolean { return globalUseGateway.value }
export function setGlobalRhUseGateway(v: boolean) { globalUseGateway.value = v }

export const useCanvasRhToolsStore = defineStore('canvasRhTools', () => {
  const tools = ref<RhTool[]>([])
  const selectedId = ref<string | null>(null)

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) tools.value = JSON.parse(raw)
    } catch { /* ignore */ }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tools.value))
  }

  function addTool(tool: Omit<RhTool, 'id' | 'createdAt' | 'updatedAt'>): RhTool {
    const t: RhTool = {
      ...tool,
      id: `rh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    tools.value.push(t)
    save()
    return t
  }

  function removeTool(id: string) {
    tools.value = tools.value.filter(t => t.id !== id)
    if (selectedId.value === id) selectedId.value = null
    save()
  }

  function updateTool(id: string, patch: Partial<RhTool>) {
    const idx = tools.value.findIndex(t => t.id === id)
    if (idx < 0) return
    tools.value[idx] = { ...tools.value[idx], ...patch, updatedAt: Date.now() }
    save()
  }

  function duplicateTool(id: string): RhTool | undefined {
    const orig = tools.value.find(t => t.id === id)
    if (!orig) return
    return addTool({
      name: orig.name + ' 副本',
      icon: orig.icon,
      color: orig.color,
      webappId: orig.webappId,
      fields: orig.fields.map(f => ({ ...f })),
    })
  }

  function exportToolsJson(): string {
    return JSON.stringify(tools.value, null, 2)
  }

  function importToolsJson(json: string) {
    try {
      const parsed = JSON.parse(json)
      if (Array.isArray(parsed)) {
        // 基础校验
        for (const t of parsed) {
          if (!t.id || !t.name || !t.webappId) throw new Error('格式不符')
        }
        tools.value = parsed
        save()
      }
    } catch (e: any) {
      throw new Error('导入失败：' + (e.message || 'JSON 格式错误'))
    }
  }

  const selectedTool = computed(() =>
    tools.value.find(t => t.id === selectedId.value) || null
  )

  load()
  return {
    tools, selectedId, selectedTool,
    addTool, removeTool, updateTool, duplicateTool,
    exportToolsJson, importToolsJson,
  }
})

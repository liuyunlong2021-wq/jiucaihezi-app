/**
 * canvasStore — 画布状态管理
 * 只存纯数据（可序列化），不存 LeaferJS 实例（DOM 绑定对象）
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { CanvasLayer, CanvasAnnotation, CanvasDocument } from '@/types/canvas'
import { isTauriRuntime } from '@/utils/tauriEnv'

export const useCanvasStore = defineStore('canvas', () => {
  const layers = ref<CanvasLayer[]>([])
  const annotations = ref<CanvasAnnotation[]>([])
  const canvasId = ref('default')
  const viewport = ref({ x: 0, y: 0, zoom: 1 })

  const imageLayers = computed(() => layers.value)

  function addLayer(meta: Omit<CanvasLayer, 'id' | 'createdAt'>) {
    const layer: CanvasLayer = {
      ...meta,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    }
    layers.value.push(layer)
  }

  function removeLayer(id: string) {
    layers.value = layers.value.filter(l => l.id !== id)
  }

  function updateLayerPosition(id: string, x: number, y: number) {
    const layer = layers.value.find(l => l.id === id)
    if (layer) { layer.x = x; layer.y = y }
  }

  function updateLayerSize(id: string, width: number, height: number) {
    const layer = layers.value.find(l => l.id === id)
    if (layer) { layer.width = width; layer.height = height }
  }

  function getCanvasDoc(): CanvasDocument {
    return {
      version: 1,
      canvasId: canvasId.value,
      updatedAt: Date.now(),
      viewport: viewport.value,
      layers: layers.value,
      annotations: annotations.value,
    }
  }

  function loadCanvasDoc(doc: CanvasDocument) {
    layers.value = doc.layers || []
    annotations.value = doc.annotations || []
    viewport.value = doc.viewport || { x: 0, y: 0, zoom: 1 }
  }

  return {
    layers, annotations, canvasId, viewport,
    imageLayers,
    addLayer, removeLayer,
    updateLayerPosition, updateLayerSize,
    getCanvasDoc, loadCanvasDoc,
  }
})

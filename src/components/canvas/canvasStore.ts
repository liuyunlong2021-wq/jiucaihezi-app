/**
 * canvasStore — 画布状态管理
 * 只存纯数据（可序列化），不存 LeaferJS 实例（DOM 绑定对象）
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { createCanvasDocument } from '@/components/canvas/canvasDocument'
import type { CanvasAsset, CanvasLayer, CanvasAnnotation, CanvasDocumentV2, CanvasSceneNode } from '@/types/canvas'

export const useCanvasStore = defineStore('canvas', () => {
  const layers = ref<CanvasLayer[]>([])
  const annotations = ref<CanvasAnnotation[]>([])
  const assets = ref<Record<string, CanvasAsset>>({})
  const canvasId = ref('default')
  const canvasPath = ref('')
  const viewport = ref({ x: 0, y: 0, zoom: 1 })
  const canvasName = computed(() => canvasPath.value.split('/').pop()?.replace(/\.jccanvas$/i, '') || '未命名画布')

  const imageLayers = computed(() => layers.value)

  function addLayer(meta: Omit<CanvasLayer, 'id' | 'createdAt'>): CanvasLayer {
    const layer: CanvasLayer = {
      ...meta,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    }
    layers.value.push(layer)
    assets.value[layer.id] = {
      id: layer.id,
      kind: layer.kind || 'image',
      path: layer.path,
      source: layer.source,
      model: layer.model,
      prompt: layer.prompt,
      createdAt: layer.createdAt,
    }
    return layer
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

  function getCanvasDocument(scene: CanvasSceneNode[]): CanvasDocumentV2 {
    return createCanvasDocument({
      canvasId: canvasId.value,
      viewport: viewport.value,
      scene,
      assets: assets.value,
    })
  }

  function loadCanvasDocument(document: CanvasDocumentV2, path = canvasPath.value) {
    canvasId.value = document.canvasId
    canvasPath.value = path
    assets.value = document.assets || {}
    layers.value = Object.values(assets.value).map(asset => ({
      id: asset.id,
      path: asset.path,
      kind: asset.kind,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      label: asset.prompt || '',
      source: asset.source,
      model: asset.model,
      prompt: asset.prompt,
      locked: false,
      createdAt: asset.createdAt,
    }))
    annotations.value = []
    viewport.value = document.viewport || { x: 0, y: 0, zoom: 1 }
  }

  return {
    layers, annotations, assets, canvasId, canvasPath, canvasName, viewport,
    imageLayers,
    addLayer, removeLayer,
    updateLayerPosition, updateLayerSize,
    getCanvasDocument, loadCanvasDocument,
  }
})

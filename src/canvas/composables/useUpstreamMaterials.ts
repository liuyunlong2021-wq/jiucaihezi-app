/**
 * useUpstreamMaterials — Vue 版，对齐 T8 nodes/useUpstreamMaterials.ts
 * 订阅上游节点连接的素材（text / image / video / audio）
 */
import { computed } from 'vue'
import { useNodeConnections, useNodesData } from '@vue-flow/core'

export interface Material {
  id: string
  kind: 'text' | 'image' | 'video' | 'audio'
  url: string
  sourceNodeId: string
  origin?: 'upstream' | 'local'
  label?: string
  size?: number
  name?: string
}

export function useUpstreamMaterials(nodeId: string) {
  const conns = useNodeConnections({ nodeId, handleType: 'target' })
  const upstreamIds = computed(() => [...new Set(conns.value.map(c => c.source))])
  const upstreamNodes = useNodesData(upstreamIds)

  const texts = computed<Material[]>(() => {
    const list = Array.isArray(upstreamNodes.value) ? upstreamNodes.value : []
    const out: Material[] = []
    for (const n of list) {
      const ud: any = (n as any)?.data || {}
      const sid = (n as any)?.id || ''
      if (ud.prompt) out.push({ id: `${sid}:text:0`, kind: 'text', url: ud.prompt, sourceNodeId: sid, origin: 'upstream' })
      if (ud.outputText && ud.outputText !== ud.prompt) out.push({ id: `${sid}:text:1`, kind: 'text', url: ud.outputText, sourceNodeId: sid, origin: 'upstream' })
    }
    return out
  })

  const images = computed<Material[]>(() => {
    const list = Array.isArray(upstreamNodes.value) ? upstreamNodes.value : []
    const out: Material[] = []
    for (const n of list) {
      const ud: any = (n as any)?.data || {}
      const sid = (n as any)?.id || ''
      if (ud.imageUrl) out.push({ id: `${sid}:img:0`, kind: 'image', url: ud.imageUrl, sourceNodeId: sid, origin: 'upstream' })
      if (Array.isArray(ud.imageUrls)) ud.imageUrls.forEach((u: string, i: number) => out.push({ id: `${sid}:img:${i}`, kind: 'image', url: u, sourceNodeId: sid, origin: 'upstream' }))
      if (ud.firstFrameUrl) out.push({ id: `${sid}:ff`, kind: 'image', url: ud.firstFrameUrl, sourceNodeId: sid, origin: 'upstream' })
      if (ud.lastFrameUrl) out.push({ id: `${sid}:lf`, kind: 'image', url: ud.lastFrameUrl, sourceNodeId: sid, origin: 'upstream' })
    }
    return out
  })

  const videos = computed<Material[]>(() => {
    const list = Array.isArray(upstreamNodes.value) ? upstreamNodes.value : []
    const out: Material[] = []
    for (const n of list) {
      const ud: any = (n as any)?.data || {}
      const sid = (n as any)?.id || ''
      if (ud.videoUrl) out.push({ id: `${sid}:vid`, kind: 'video', url: ud.videoUrl, sourceNodeId: sid, origin: 'upstream' })
    }
    return out
  })

  const audios = computed<Material[]>(() => {
    const list = Array.isArray(upstreamNodes.value) ? upstreamNodes.value : []
    const out: Material[] = []
    for (const n of list) {
      const ud: any = (n as any)?.data || {}
      const sid = (n as any)?.id || ''
      if (ud.audioUrl) out.push({ id: `${sid}:aud`, kind: 'audio', url: ud.audioUrl, sourceNodeId: sid, origin: 'upstream' })
    }
    return out
  })

  return { texts, images, videos, audios }
}

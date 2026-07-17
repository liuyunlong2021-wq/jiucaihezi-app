import { ref } from 'vue'
import { defineStore } from 'pinia'

import type { MediaPlan } from '@/runtime/workbench/mediaPlan'

export type EcommerceSurface = 'workbench' | 'collaboration'

export interface EcommerceDraft {
  productImages: string[]
  referenceImages: string[]
  deliveryGoal: string
  market: string
  notes: string
}

function createDraft(): EcommerceDraft {
  return {
    productImages: [],
    referenceImages: [],
    deliveryGoal: '商品主图',
    market: '让 AI 推荐',
    notes: '',
  }
}

export const useEcommerceWorkbenchStore = defineStore('ecommerceWorkbench', () => {
  const surface = ref<EcommerceSurface>('workbench')
  const draftsBySession = ref<Record<string, EcommerceDraft>>({})
  const plansBySession = ref<Record<string, MediaPlan | undefined>>({})
  const taskIdsBySession = ref<Record<string, string | undefined>>({})

  function draftKey(sessionId: string): string {
    return String(sessionId || '').trim() || '__ecommerce_pending__'
  }

  function draftFor(sessionId: string): EcommerceDraft {
    const id = draftKey(sessionId)
    if (!draftsBySession.value[id]) draftsBySession.value[id] = createDraft()
    return draftsBySession.value[id]
  }

  function updateDraft(sessionId: string, patch: Partial<EcommerceDraft>) {
    const draft = draftFor(sessionId)
    if (patch.productImages !== undefined) draft.productImages = [...patch.productImages]
    if (patch.referenceImages !== undefined) draft.referenceImages = [...patch.referenceImages]
    if (patch.deliveryGoal !== undefined) draft.deliveryGoal = patch.deliveryGoal
    if (patch.market !== undefined) draft.market = patch.market
    if (patch.notes !== undefined) draft.notes = patch.notes
  }

  function setSurface(next: EcommerceSurface) {
    surface.value = next
  }

  function planFor(sessionId: string): MediaPlan | undefined {
    return plansBySession.value[String(sessionId || '').trim()]
  }

  function setPlan(sessionId: string, plan: MediaPlan | undefined) {
    const id = String(sessionId || '').trim()
    if (!id) return
    plansBySession.value[id] = plan
  }

  function setTaskId(sessionId: string, taskId: string | undefined) {
    const id = String(sessionId || '').trim()
    if (!id) return
    taskIdsBySession.value[id] = taskId
  }

  function claimPendingDraft(sessionId: string) {
    const id = String(sessionId || '').trim()
    if (!id || draftsBySession.value[id]) return
    const pending = draftsBySession.value.__ecommerce_pending__
    if (pending) {
      draftsBySession.value[id] = { ...pending, productImages: [...pending.productImages], referenceImages: [...pending.referenceImages] }
      delete draftsBySession.value.__ecommerce_pending__
    }
  }

  return {
    surface,
    draftsBySession,
    plansBySession,
    taskIdsBySession,
    draftFor,
    updateDraft,
    setSurface,
    planFor,
    setPlan,
    setTaskId,
    claimPendingDraft,
  }
})

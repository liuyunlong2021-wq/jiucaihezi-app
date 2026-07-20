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

export interface ProductImageHandoff {
  productImage: string
  intent: string
  prompt: string
  ratio: string
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

function createProductImageHandoff(): ProductImageHandoff {
  return { productImage: '', intent: '', prompt: '', ratio: '1:1' }
}

export const useEcommerceWorkbenchStore = defineStore('ecommerceWorkbench', () => {
  const surface = ref<EcommerceSurface>('collaboration')
  const draftsBySession = ref<Record<string, EcommerceDraft>>({})
  const customImagesBySession = ref<Record<string, Record<string, string[]>>>({})
  const customResultsBySession = ref<Record<string, Record<string, string>>>({})
  const productImageHandoffsBySession = ref<Record<string, Record<string, ProductImageHandoff>>>({})
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

  function customImagesFor(sessionId: string, skillId: string): string[] {
    const id = draftKey(sessionId)
    const skillImages = customImagesBySession.value[id] ||= {}
    return skillImages[skillId] ||= []
  }

  function setCustomImages(sessionId: string, skillId: string, images: string[]) {
    const id = draftKey(sessionId)
    const skillImages = customImagesBySession.value[id] ||= {}
    skillImages[skillId] = [...images]
  }

  function customResultFor(sessionId: string, skillId: string): string {
    return customResultsBySession.value[draftKey(sessionId)]?.[skillId] || ''
  }

  function setCustomResult(sessionId: string, skillId: string, content: string) {
    const id = draftKey(sessionId)
    const skillResults = customResultsBySession.value[id] ||= {}
    skillResults[skillId] = String(content || '').trim()
  }

  function productImageHandoffFor(sessionId: string, skillId: string): ProductImageHandoff {
    const id = draftKey(sessionId)
    const handoffs = productImageHandoffsBySession.value[id] ||= {}
    return handoffs[skillId] ||= createProductImageHandoff()
  }

  function updateProductImageHandoff(sessionId: string, skillId: string, patch: Partial<ProductImageHandoff>) {
    const handoff = productImageHandoffFor(sessionId, skillId)
    if (patch.productImage !== undefined) handoff.productImage = patch.productImage
    if (patch.intent !== undefined) handoff.intent = patch.intent
    if (patch.prompt !== undefined) handoff.prompt = patch.prompt
    if (patch.ratio !== undefined) handoff.ratio = patch.ratio
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
    const pendingCustomImages = customImagesBySession.value.__ecommerce_pending__
    if (pendingCustomImages) {
      customImagesBySession.value[id] = Object.fromEntries(Object.entries(pendingCustomImages).map(([skillId, images]) => [skillId, [...images]]))
      delete customImagesBySession.value.__ecommerce_pending__
    }
    const pendingHandoffs = productImageHandoffsBySession.value.__ecommerce_pending__
    if (pendingHandoffs) {
      productImageHandoffsBySession.value[id] = Object.fromEntries(Object.entries(pendingHandoffs).map(([skillId, handoff]) => [skillId, { ...handoff }]))
      delete productImageHandoffsBySession.value.__ecommerce_pending__
    }
  }

  return {
    surface,
    draftsBySession,
    customImagesBySession,
    customResultsBySession,
    productImageHandoffsBySession,
    plansBySession,
    taskIdsBySession,
    draftFor,
    updateDraft,
    customImagesFor,
    setCustomImages,
    customResultFor,
    setCustomResult,
    productImageHandoffFor,
    updateProductImageHandoff,
    setSurface,
    planFor,
    setPlan,
    setTaskId,
    claimPendingDraft,
  }
})

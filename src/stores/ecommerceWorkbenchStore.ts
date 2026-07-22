import { ref } from 'vue'
import { defineStore } from 'pinia'

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
  const surface = ref<EcommerceSurface>('collaboration')
  const draftsBySession = ref<Record<string, EcommerceDraft>>({})
  const customImagesBySession = ref<Record<string, Record<string, string[]>>>({})
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

  function setSurface(next: EcommerceSurface) {
    surface.value = next
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
  }

  return {
    surface,
    draftsBySession,
    customImagesBySession,
    taskIdsBySession,
    draftFor,
    updateDraft,
    customImagesFor,
    setCustomImages,
    setSurface,
    setTaskId,
    claimPendingDraft,
  }
})

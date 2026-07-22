import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'

import { useEcommerceWorkbenchStore } from '../ecommerceWorkbenchStore'

test('ecommerce workbench starts on collaboration and keeps one draft when explicitly opened', () => {
  setActivePinia(createPinia())
  const store = useEcommerceWorkbenchStore()
  const sessionId = 'creative_ecommerce'

  assert.equal(store.surface, 'collaboration')
  store.updateDraft(sessionId, {
    productImages: ['jc-media/images/product.png'],
    referenceImages: ['jc-media/images/reference.png'],
    deliveryGoal: '详情页长图',
    market: '抖音小红书',
    notes: '包装上的中文必须完整保留',
  })
  store.setSurface('workbench')
  assert.equal(store.surface, 'workbench')

  assert.deepEqual(store.draftFor(sessionId), {
    productImages: ['jc-media/images/product.png'],
    referenceImages: ['jc-media/images/reference.png'],
    deliveryGoal: '详情页长图',
    market: '抖音小红书',
    notes: '包装上的中文必须完整保留',
  })
})

test('ecommerce workbench never stores conversation messages with its task state', () => {
  setActivePinia(createPinia())
  const store = useEcommerceWorkbenchStore()
  const sessionId = 'creative_ecommerce'

  store.updateDraft(sessionId, { notes: '只保存工作台事实' })

  assert.equal('messages' in store.draftFor(sessionId), false)
  assert.equal('messagesBySession' in store, false)
})

test('ecommerce workbench moves an unsent form into the creative session created for planning', () => {
  setActivePinia(createPinia())
  const store = useEcommerceWorkbenchStore()

  store.updateDraft('', { notes: '先保留这份商品事实' })
  store.claimPendingDraft('creative_ecommerce')

  assert.equal(store.draftFor('creative_ecommerce').notes, '先保留这份商品事实')
  assert.equal('__ecommerce_pending__' in store.draftsBySession, false)
})

test('ecommerce workbench keeps custom workbench images scoped to its Skill and creative session', () => {
  setActivePinia(createPinia())
  const store = useEcommerceWorkbenchStore()

  store.setCustomImages('', 'JC-反推图片提示词', ['data:image/png;base64,one'])
  store.claimPendingDraft('creative_ecommerce')
  store.setCustomImages('creative_other', 'JC-反推图片提示词', ['data:image/png;base64,two'])

  assert.deepEqual(store.customImagesFor('creative_ecommerce', 'JC-反推图片提示词'), ['data:image/png;base64,one'])
  assert.deepEqual(store.customImagesFor('creative_other', 'JC-反推图片提示词'), ['data:image/png;base64,two'])
})

test('ecommerce workbench does not retain the removed reverse-result handoff state', () => {
  setActivePinia(createPinia())
  const store = useEcommerceWorkbenchStore()

  assert.equal('customResultsBySession' in store, false)
  assert.equal('productImageHandoffsBySession' in store, false)
  assert.equal('plansBySession' in store, false)
  assert.equal('setCustomResult' in store, false)
  assert.equal('productImageHandoffFor' in store, false)
  assert.equal('messagesBySession' in store, false)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildEcommercePlannerPrompt } from '../ecommercePlanner'

test('ecommerce planner sends user facts and requires a reviewable image plan', () => {
  const prompt = buildEcommercePlannerPrompt({
    productImages: ['jc-media/images/product.png'],
    referenceImages: ['jc-media/images/reference.png'],
    deliveryGoal: '商品主图',
    market: '淘宝京东',
    notes: '白色极简风，保留瓶身文字',
  })

  assert.match(prompt, /JC-电商商品图/)
  assert.match(prompt, /jc-media\/images\/product\.png/)
  assert.match(prompt, /jc-media\/images\/reference\.png/)
  assert.match(prompt, /```jc-media-plan/)
  assert.match(prompt, /不得调用媒体 API|不得.*媒体 API/)
})

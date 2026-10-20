import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cpState, currentModel, switchModel } from '../useCreation'

// 计划/历史快照给的是公开 model 名或别名时，面板必须仍用注册表 id。
// 否则模型那一格会把 xy-gpt-image-2.5-1k 这类原始名当标签显示。
test('switchModel 把公开 model 名归一到注册表 id，标签不回退成原始名', () => {
  switchModel('xy-gpt-image-2.5-1k')
  assert.equal(cpState.modelKey, 'gpt-image-2.5-1k')
  assert.equal(currentModel.value?.label, 'xy-gpt-image-2.5-1k')
})

test('currentModel 对历史/别名 key 也能解析出标签，不再直接显示 key', () => {
  cpState.modelKey = 'xy-grok-imagine-image-2.0'
  assert.equal(currentModel.value?.label, 'xy-grok-imagine-image-2.0')
  cpState.modelKey = 'gpt-image-2'
  assert.equal(currentModel.value?.capability.id, 'gpt-image-2-超分')
})

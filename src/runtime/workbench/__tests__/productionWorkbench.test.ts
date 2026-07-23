import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildProductionWorkbenchRequest,
  getProductionProfile,
  parseProductionPromptCards,
} from '../productionWorkbench'

test('each production step accepts one sentence and compiles only its explicit input', () => {
  for (const step of ['style', 'characters', 'scenes', 'props', 'storyboard-images', 'storyboard-video'] as const) {
    const request = buildProductionWorkbenchRequest({
      step,
      modelId: 'gpt-5.5',
      userText: '雨夜里，一个剑客走进空城。',
      sources: [{ id: 'scene-1', name: '第一场', path: 'wiki/剧本/第一场.md', content: '夜雨，空城。' }],
      attachments: [],
    })

    const fields = request.input.fields
    assert.equal(request.skill.id, getProductionProfile(step).id)
    assert.equal(fields.userText, '雨夜里，一个剑客走进空城。')
    assert.deepEqual(fields.sources, ['第一场\nwiki/剧本/第一场.md\n夜雨，空城。'])
    assert.equal('chatHistory' in fields, false)
    assert.equal('sessionId' in fields, false)
    assert.equal('wikiHot' in fields, false)
    assert.deepEqual(request.input.attachments, [])
  }
})

test('asset runs parse each named prompt into an independent card', () => {
  assert.deepEqual(parseProductionPromptCards('```json\n{"cards":[{"name":"沈昭","prompt":"黑衣剑客，雨夜，角色设定图"},{"name":"顾晚","prompt":"红伞少女，雨夜，角色设定图"}]}\n```'), [
    { name: '沈昭', prompt: '黑衣剑客，雨夜，角色设定图' },
    { name: '顾晚', prompt: '红伞少女，雨夜，角色设定图' },
  ])
})

test('Wiki-linked asset runs constrain cards to the explicit entity names', () => {
  const request = buildProductionWorkbenchRequest({
    step: 'characters',
    modelId: 'gpt-5.5',
    userText: '',
    sources: [{ id: '林不凡', name: '林不凡', path: 'wiki/角色/林不凡/01-基础信息/基础档案.md', content: '剑客' }],
    attachments: [],
    entityNames: ['林不凡', '温宁'],
  })

  assert.match(request.skill.content, /只返回林不凡、温宁各一张卡/)
})

test('production workbench rejects a run without user text, selected files, or attachments', () => {
  assert.throws(() => buildProductionWorkbenchRequest({
    step: 'style',
    modelId: 'gpt-5.5',
    userText: '',
    sources: [],
    attachments: [],
  }), /至少提供一句用户信息、资料或附件/)
})

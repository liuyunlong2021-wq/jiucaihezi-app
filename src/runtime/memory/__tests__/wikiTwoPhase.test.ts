import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runWikiTwoPhase } from '../wikiTwoPhase'

function response(value: unknown): Response {
  return new Response(
    [
      `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(value) } }] })}`,
      'data: [DONE]',
      '',
    ].join('\n\n'),
    { headers: { 'content-type': 'text/event-stream' } },
  )
}

test('Wiki two-phase flow reads the plan then submits one change plan', async () => {
  const requests: any[] = []
  const calls: string[] = []
  const result = await runWikiTwoPhase({
    messages: [{ role: 'user', content: '续写下一集并写入 Wiki' }],
    task: '续写下一集并写入 Wiki',
    entryResult: '{"entry":{"path":"wiki/index.md","content":"剧情 -> 剧情/总纲.md"}}',
    sendChatCompletion: async request => {
      requests.push(request)
      return requests.length === 1
        ? response({
            paths: [{ path: '剧情/总纲.md', reason: '确定目标' }],
            missing: [],
            sufficient: true,
          })
        : response({
            answer: '新一集正文',
            changePlan: {
              reason: '续写下一集',
              basis: ['剧情/总纲.md'],
              operations: [
                { kind: 'create', path: '剧情/第1集.md', title: '第1集', content: '新一集正文' },
              ],
              indexChanges: [
                { directory: '剧情', path: '剧情/第1集.md', title: '第1集', action: 'add' },
              ],
            },
          })
    },
    executeWiki: async call => {
      calls.push(call.function.name + ':' + call.function.arguments)
      return {
        content: call.function.name === 'wiki_context' ? '{"sources":[]}' : 'status: succeeded',
        status: 'succeeded',
      }
    },
  })

  assert.equal(requests.length, 2)
  assert.deepEqual(result.readPaths, ['剧情/总纲.md'])
  assert.equal(result.text, '新一集正文')
  assert.equal(calls.length, 2)
  assert.match(calls[1]!, /"action":"apply"/)
  assert.doesNotMatch(calls[1]!, /indexChanges/)
})

test('Wiki two-phase keeps the model answer when a read is cancelled', async () => {
  let requestCount = 0
  const result = await runWikiTwoPhase({
    messages: [{ role: 'user', content: '写入 Wiki' }],
    task: '写入 Wiki',
    entryResult: '{}',
    sendChatCompletion: async () =>
      ++requestCount === 1
        ? response({ paths: [{ path: '事实.md', reason: '事实' }], missing: [], sufficient: true })
        : response({ answer: '结果', changePlan: null }),
    executeWiki: async () => ({ content: '用户取消', status: 'cancelled' }),
  })
  assert.equal(result.text, '结果')
})

test('Wiki two-phase keeps the model answer when a write fails', async () => {
  const result = await runWikiTwoPhase({
    messages: [{ role: 'user', content: '写入 Wiki' }],
    task: '写入 Wiki',
    entryResult: '{}',
    sendChatCompletion: async request =>
      request.messages.some((message: any) =>
        String(message.content || '').includes('WikiSynthesis'),
      )
        ? response({
            answer: '这是给用户的正文',
            changePlan: {
              reason: '新增',
              basis: ['事实.md'],
              operations: [{ kind: 'create', path: '事实.md', title: '事实', content: '正文' }],
            },
          })
        : response({ paths: [], missing: [], sufficient: true }),
    executeWiki: async () => {
      throw new Error('写入失败')
    },
  })
  assert.equal(result.text, '这是给用户的正文')
  assert.match(result.applyResult || '', /status: failed/)
})

test('Wiki two-phase returns an answer without supplementary reads when evidence is insufficient', async () => {
  const requests: any[] = []
  const readCalls: string[] = []
  const result = await runWikiTwoPhase({
    messages: [{ role: 'user', content: '根据 Wiki 总结' }],
    task: '根据 Wiki 总结',
    entryResult: '{"entry":"index"}',
    sendChatCompletion: async request => {
      requests.push(request)
      if (requests.length === 1)
        return response({ paths: [], missing: ['状态/当前进度.md'], sufficient: false })
      return response({ answer: '已总结', changePlan: null })
    },
    executeWiki: async call => {
      readCalls.push(call.function.arguments)
      return { content: '{"sources":["状态/当前进度.md"]}', status: 'succeeded' }
    },
  })

  assert.equal(requests.length, 2)
  assert.deepEqual(readCalls, [])
  assert.equal(result.text, '已总结')
})

test('Wiki two-phase derives index maintenance when the model omits index declarations', async () => {
  const result = await runWikiTwoPhase({
    messages: [{ role: 'user', content: '写入 Wiki' }],
    task: '写入 Wiki',
    entryResult: '{}',
    sendChatCompletion: async request =>
      request.messages.some((message: any) => String(message.content).includes('WikiSynthesis'))
        ? response({
            answer: '正文',
            changePlan: {
              reason: '新增',
              basis: ['a.md'],
              operations: [{ kind: 'create', path: 'a.md', title: 'A', content: '正文' }],
              indexChanges: [],
            },
          })
        : response({ paths: [], missing: [], sufficient: true }),
    executeWiki: async () => ({ content: '{}', status: 'succeeded' }),
  })
  assert.equal(result.plan.changePlan?.indexChanges.length, 0)
  assert.equal(result.applyResult, '{}')
})

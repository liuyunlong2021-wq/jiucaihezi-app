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
  assert.equal(result.metrics.toolRounds, 2)
  assert.match(calls[1]!, /"action":"apply"/)
  assert.doesNotMatch(calls[1]!, /indexChanges/)
})

test('Wiki Agent follows nested indexes until the leaf content is available', async () => {
  const requests: any[] = []
  const readPaths: string[] = []
  const result = await runWikiTwoPhase({
    messages: [{ role: 'user', content: '重写张飞的生图提示词' }],
    task: '重写张飞的生图提示词',
    entryResult: '角色 -> 角色/index.md',
    sendChatCompletion: async request => {
      requests.push(request)
      if (requests.length === 1)
        return response({
          paths: [{ path: '角色/index.md', reason: '定位角色资料' }],
          missing: [],
          sufficient: false,
        })
      if (requests.length === 2)
        return response({
          paths: [{ path: '角色/生图提示词/index.md', reason: '定位提示词分区' }],
          missing: [],
          sufficient: false,
        })
      if (requests.length === 3)
        return response({
          paths: [{ path: '角色/生图提示词/张飞.md', reason: '读取张飞原提示词' }],
          missing: [],
          sufficient: true,
        })
      return response({ answer: '重写后的张飞提示词', changePlan: null })
    },
    executeWiki: async call => {
      const args = JSON.parse(call.function.arguments) as { paths?: string[] }
      if (Array.isArray(args.paths)) readPaths.push(...args.paths)
      return { content: `读取结果: ${args.paths?.join(',') || ''}`, status: 'succeeded' }
    },
  })

  assert.equal(requests.length, 4)
  assert.deepEqual(readPaths, [
    '角色/index.md',
    '角色/生图提示词/index.md',
    '角色/生图提示词/张飞.md',
  ])
  assert.deepEqual(result.readPaths, readPaths)
  assert.equal(result.text, '重写后的张飞提示词')
})

test('Wiki Agent reads the path requested by the model within the Wiki root', async () => {
  const calls: string[] = []
  let requests = 0
  const result = await runWikiTwoPhase({
    messages: [{ role: 'user', content: '查询角色' }],
    task: '查询角色',
    entryResult: JSON.stringify({ entry: { path: 'index.md', content: '[[角色/index]]' } }),
    sendChatCompletion: async () => {
      requests += 1
      if (requests === 1)
        return response({ paths: [{ path: '秘密.md', reason: '猜测路径' }], missing: [], status: 'need_more' })
      if (requests === 2)
        return response({ paths: [{ path: '角色/index.md', reason: '读取已授权入口' }], missing: [], status: 'complete' })
      return response({ answer: '基于已索引资料回答', changePlan: null })
    },
    executeWiki: async call => {
      calls.push(call.function.arguments)
      return { content: '{}', status: 'succeeded' }
    },
  })
  assert.equal(calls.length, 2)
  assert.match(calls[0]!, /秘密\.md/)
  assert.match(calls[1]!, /角色\/index\.md/)
  assert.match(result.text, /基于已索引资料回答/)
})

test('Wiki Agent accepts status complete without the legacy sufficient field', async () => {
  let requests = 0
  const result = await runWikiTwoPhase({
    messages: [{ role: 'user', content: '查询' }],
    task: '查询',
    entryResult: '{}',
    sendChatCompletion: async () => {
      requests += 1
      return requests === 1
        ? response({ paths: [], missing: [], status: 'complete' })
        : response({ answer: '完成', changePlan: null })
    },
    executeWiki: async () => ({ content: '{}', status: 'succeeded' }),
  })
  assert.equal(requests, 2)
  assert.equal(result.text, '完成')
})

test('Wiki Agent still applies a valid write plan after the read guard is reached', async () => {
  let requests = 0
  const calls: string[] = []
  const result = await runWikiTwoPhase({
    messages: [{ role: 'user', content: '写入 Wiki' }],
    task: '写入 Wiki',
    entryResult: '{}',
    sendChatCompletion: async () => {
      requests += 1
      if (requests <= 12)
        return response({ paths: [{ path: `第${requests}层.md`, reason: '继续读取' }], missing: [], status: 'need_more' })
      return response({ answer: '基于部分资料的回答', changePlan: { reason: '写入', basis: [], operations: [{ kind: 'create', path: '结果.md', title: '结果', content: '内容' }] } })
    },
    executeWiki: async call => {
      calls.push(call.function.name)
      return { content: '{}', status: 'succeeded' }
    },
  })
  assert.equal(calls.includes('wiki'), true)
  assert.equal(result.applyResult, '{}')
  assert.match(result.text, /资料尚未读取完整/)
})

test('Wiki Agent can create content when the Wiki entry is empty', async () => {
  let requests = 0
  const calls: string[] = []
  const result = await runWikiTwoPhase({
    messages: [{ role: 'user', content: '创建角色/关羽.md' }],
    task: '创建角色/关羽.md',
    entryResult: '{"entry":{"path":"index.md","content":""}}',
    sendChatCompletion: async () => {
      requests += 1
      return requests === 1
        ? response({ paths: [], missing: [], status: 'complete' })
        : response({
            answer: '已生成关羽角色资料',
            changePlan: {
              reason: '创建关羽角色资料',
              basis: [],
              operations: [
                { kind: 'create', path: '角色/关羽.md', title: '关羽', content: '# 关羽\n' },
              ],
            },
          })
    },
    executeWiki: async call => {
      calls.push(call.function.name)
      return { content: 'status: succeeded', status: 'succeeded' }
    },
  })

  assert.deepEqual(calls, ['wiki'])
  assert.equal(result.text, '已生成关羽角色资料')
  assert.equal(result.applyResult, 'status: succeeded')
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
  assert.match(result.text, /^已总结\n\n> Wiki 资料尚未读取完整/u)
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

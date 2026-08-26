import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DirectTransportFailure, runDirectChatCompletion, sendDirectRequestWithRetry } from '../directEngine'

function sseResponse(rows: string[]): Response {
  return new Response(rows.map(row => `data: ${row}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  })
}

function interruptedSseResponse(rows: string[]): Response {
  const encoder = new TextEncoder()
  let reads = 0
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      reads += 1
      if (reads === 1) controller.enqueue(encoder.encode(rows.map(row => `data: ${row}\n\n`).join('')))
      else controller.error(new Error('stream body interrupted'))
    },
  }), { headers: { 'content-type': 'text/event-stream' } })
}

test('sendDirectRequestWithRetry retries the current transient request twice', async () => {
  let requests = 0
  const waits: number[] = []
  const retries: number[] = []
  const durations: number[] = []

  const response = await sendDirectRequestWithRetry(
    async () => {
      requests += 1
      if (requests === 1) throw new Error('HTTP 请求失败: error sending request for url (https://api.example.test)')
      if (requests === 2) return new Response('', { status: 524 })
      return new Response('ok')
    },
    {
      wait: async delay => { waits.push(delay) },
      onRetry: attempt => { retries.push(attempt) },
      onRequestComplete: duration => { durations.push(duration) },
    },
  )

  assert.equal(await response.text(), 'ok')
  assert.deepEqual(waits, [2000, 4000])
  assert.deepEqual(retries, [1, 2])
  assert.equal(requests, 3)
  assert.equal(durations.length, 3)
  assert.equal(durations.every(duration => duration >= 0), true)
})

test('sendDirectRequestWithRetry exposes an exhausted network failure as transport failure', async () => {
  let requests = 0

  await assert.rejects(
    () => sendDirectRequestWithRetry(async () => {
      requests += 1
      throw new Error('HTTP 请求失败: error sending request for url (https://api.example.test)')
    }, { wait: async () => {} }),
    DirectTransportFailure,
  )

  assert.equal(requests, 3)
})

test('sendDirectRequestWithRetry stops during retry backoff when aborted', async () => {
  const controller = new AbortController()
  let requests = 0

  await assert.rejects(
    () => sendDirectRequestWithRetry(async () => {
      requests += 1
      throw new Error('Failed to fetch')
    }, {
      signal: controller.signal,
      onRetry: () => controller.abort(),
    }),
    error => error instanceof DOMException && error.name === 'AbortError',
  )

  assert.equal(requests, 1)
})

test('sendDirectRequestWithRetry does not retry a client error', async () => {
  let requests = 0
  const response = await sendDirectRequestWithRetry(async () => {
    requests += 1
    return new Response('', { status: 401 })
  })

  assert.equal(response.status, 401)
  assert.equal(requests, 1)
})

test('runDirectChatCompletion performs a second pass when the model requests a tool', async () => {
  const seen: string[] = []
  const sentMessages: any[][] = []

  const result = await runDirectChatCompletion({
    messages: [{ role: 'user', content: '查一下韭菜盒子' }],
    tools: [{ type: 'function', function: { name: 'wiki_search' } }],
    onText: value => seen.push(value),
    executeTool: async call => ({ content: `[result:${JSON.parse(call.function.arguments).query}]` }),
    sendChatCompletion: async request => {
      sentMessages.push(request.messages)
      if (sentMessages.length === 1) {
        return sseResponse([
          JSON.stringify({ choices: [{ delta: { reasoning_content: '先查资料', tool_calls: [{ index: 0, id: 'call_1', function: { name: 'wiki_search', arguments: '{"query":"韭菜盒子"}' } }] } }] }),
          '[DONE]',
        ])
      }
      return sseResponse([
        JSON.stringify({ choices: [{ delta: { content: '搜索后回答' } }] }),
        '[DONE]',
      ])
    },
  })

  assert.equal(result.text, '搜索后回答')
  assert.deepEqual(seen, ['搜索后回答'])
  assert.equal(sentMessages.length, 2)
  assert.deepEqual(sentMessages[0], [{ role: 'user', content: '查一下韭菜盒子' }])
  assert.equal(sentMessages[1][1].role, 'assistant')
  assert.equal(sentMessages[1][1].content, undefined)
  assert.equal(sentMessages[1][1].reasoning_content, '先查资料')
  assert.equal(sentMessages[1][2].role, 'tool')
  assert.equal(sentMessages[1][2].content, '[result:韭菜盒子]')
})

test('runDirectChatCompletion does not continue an interrupted stream when continuation is disabled', async () => {
  let requests = 0

  await assert.rejects(
    () => runDirectChatCompletion({
      messages: [{ role: 'user', content: '你好' }],
      onText: () => {},
      continueOnInterruption: false,
      sendChatCompletion: async () => {
        requests += 1
        return interruptedSseResponse([JSON.stringify({ choices: [{ delta: { content: '部分回复' } }] })])
      },
    }),
    /stream body interrupted/,
  )

  assert.equal(requests, 1)
})

test('runDirectChatCompletion continues a length-limited answer a bounded number of times', async () => {
  const requests: any[] = []
  const responses = [
    sseResponse([JSON.stringify({ choices: [{ delta: { content: '前半段。' }, finish_reason: 'length' }] }), '[DONE]']),
    sseResponse([JSON.stringify({ choices: [{ delta: { content: '后半段。' }, finish_reason: 'stop' }] }), '[DONE]']),
  ]

  const result = await runDirectChatCompletion({
    messages: [{ role: 'user', content: '写长文' }],
    onText: () => {},
    sendChatCompletion: async request => {
      requests.push(request)
      return responses.shift()!
    },
  })

  assert.equal(result.text, '前半段。后半段。')
  assert.equal(requests.length, 2)
  assert.match(requests[1].messages.at(-1).content, /达到输出上限/)
})

test('runDirectChatCompletion preserves earlier length segments when a continuation stream is interrupted', async () => {
  const seen: string[] = []
  const responses = [
    sseResponse([JSON.stringify({ choices: [{ delta: { content: '第一段。' }, finish_reason: 'length' }] }), '[DONE]']),
    interruptedSseResponse([JSON.stringify({ choices: [{ delta: { content: '第二段。' } }] })]),
    sseResponse([JSON.stringify({ choices: [{ delta: { content: '第三段。' }, finish_reason: 'stop' }] }), '[DONE]']),
  ]

  const result = await runDirectChatCompletion({
    messages: [{ role: 'user', content: '写完整长文' }],
    onText: value => seen.push(value),
    sendChatCompletion: async () => responses.shift()!,
  })

  assert.equal(result.text, '第一段。第二段。第三段。')
  assert.equal(seen.at(-1), '第一段。第二段。第三段。')
})

test('runDirectChatCompletion reports the normalized tool id used by the tool result', async () => {
  const reportedCalls: string[] = []
  const executedCalls: string[] = []
  const responses = [
    sseResponse([
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'skill', arguments: '{"name":"writer"}' } }] } }] }),
      '[DONE]',
    ]),
    sseResponse([
      JSON.stringify({ choices: [{ delta: { content: 'Skill 已加载' } }] }),
      '[DONE]',
    ]),
  ]

  await runDirectChatCompletion({
    messages: [{ role: 'user', content: '加载写作 Skill' }],
    tools: [{ type: 'function', function: { name: 'skill' } }],
    onText: () => {},
    onToolEvent: event => {
      if (event.type === 'tool_execution_start') reportedCalls.push(event.call.id)
    },
    executeTool: async call => {
      executedCalls.push(call.id)
      return { content: 'loaded' }
    },
    sendChatCompletion: async () => responses.shift()!,
  })

  assert.deepEqual(reportedCalls, ['call_skill_1'])
  assert.deepEqual(executedCalls, ['call_skill_1'])
})

test('runDirectChatCompletion emits start then successful end for a tool call', async () => {
  const events: Array<{ type: string; call: { id: string }; status?: string }> = []
  const responses = [
    sseResponse([
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_read', function: { name: 'read', arguments: '{"path":"idea.md"}' } }] } }] }),
      '[DONE]',
    ]),
    sseResponse([JSON.stringify({ choices: [{ delta: { content: '读取完成' } }] }), '[DONE]']),
  ]

  await runDirectChatCompletion({
    messages: [{ role: 'user', content: '读取创意' }],
    tools: [{ type: 'function', function: { name: 'read' } }],
    onText: () => {},
    onToolEvent: event => events.push(event),
    executeTool: async () => ({ content: '创意正文' }),
    sendChatCompletion: async () => responses.shift()!,
  })

  assert.deepEqual(events.map(event => [event.type, event.call.id, event.status]), [
    ['tool_execution_start', 'call_read', undefined],
    ['tool_execution_end', 'call_read', 'succeeded'],
  ])
})

test('runDirectChatCompletion returns request, tool-round, and duration metrics without payloads', async () => {
  const responses = [
    sseResponse([
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_read', function: { name: 'read', arguments: '{"path":"secret.md"}' } }] } }] }),
      '[DONE]',
    ]),
    sseResponse([JSON.stringify({ choices: [{ delta: { content: '完成' } }] }), '[DONE]']),
  ]

  const result = await runDirectChatCompletion({
    messages: [{ role: 'user', content: '敏感正文' }],
    tools: [{ type: 'function', function: { name: 'read' } }],
    onText: () => {},
    executeTool: async () => ({ content: '文件正文' }),
    sendChatCompletion: async () => responses.shift()!,
  })

  assert.equal(result.metrics.modelRequests, 2)
  assert.equal(result.metrics.toolRounds, 1)
  assert.equal(result.metrics.modelRequestDurationMs.length, 2)
  assert.equal(result.metrics.modelRequestDurationMs.every(duration => duration >= 0), true)
  assert.equal(result.metrics.totalDurationMs >= 0, true)
  assert.doesNotMatch(JSON.stringify(result.metrics), /敏感正文|secret\.md|文件正文/)
})

test('runDirectChatCompletion counts retry attempts as separate model requests', async () => {
  let attempts = 0
  const result = await runDirectChatCompletion({
    messages: [{ role: 'user', content: '继续' }],
    onText: () => {},
    sendChatCompletion: async (_request, onRequestComplete) => await sendDirectRequestWithRetry(async () => {
      attempts += 1
      if (attempts < 3) return new Response('', { status: 503 })
      return sseResponse([JSON.stringify({ choices: [{ delta: { content: '完成' } }] }), '[DONE]'])
    }, { wait: async () => {}, onRequestComplete }),
  })

  assert.equal(result.metrics.modelRequests, 3)
  assert.equal(result.metrics.modelRequestDurationMs.length, 3)
  assert.equal(result.metrics.toolRounds, 0)
})

test('runDirectChatCompletion rejects a tool that was not advertised in the request', async () => {
  let executions = 0
  const sentMessages: any[][] = []
  const responses = [
    sseResponse([
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_delete', function: { name: 'delete', arguments: '{"path":"note.md"}' } }] } }] }),
      '[DONE]',
    ]),
    sseResponse([JSON.stringify({ choices: [{ delta: { content: '未执行删除。' } }] }), '[DONE]']),
  ]

  await runDirectChatCompletion({
    messages: [{ role: 'user', content: '查看文件' }],
    tools: [{ type: 'function', function: { name: 'read' } }],
    onText: () => {},
    executeTool: async () => { executions += 1; return { content: '不应执行' } },
    sendChatCompletion: async request => { sentMessages.push(request.messages); return responses.shift()! },
  })

  assert.equal(executions, 0)
  assert.match(sentMessages[1].at(-1).content, /工具未在当前请求中开放: delete/)
})

test('runDirectChatCompletion ends a rejected tool without executing it', async () => {
  const events: Array<{ type: string; call: { id: string }; status?: string }> = []
  let executions = 0
  const responses = [
    sseResponse([
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_write', function: { name: 'write', arguments: '{"path":"draft.md","content":"正文"}' } }] } }] }),
      '[DONE]',
    ]),
    sseResponse([JSON.stringify({ choices: [{ delta: { content: '已改用不写文件的方式。' } }] }), '[DONE]']),
  ]

  await runDirectChatCompletion({
    messages: [{ role: 'user', content: '写入草稿' }],
    tools: [{ type: 'function', function: { name: 'write' } }],
    onText: () => {},
    onToolEvent: event => events.push(event),
    beforeToolCall: async () => 'cancelled',
    executeTool: async () => {
      executions += 1
      return { content: '不应执行' }
    },
    sendChatCompletion: async () => responses.shift()!,
  })

  assert.equal(executions, 0)
  assert.deepEqual(events.map(event => [event.type, event.call.id, event.status]), [
    ['tool_execution_start', 'call_write', undefined],
    ['tool_execution_end', 'call_write', 'cancelled'],
  ])
})

test('runDirectChatCompletion starts parallel failures in source order and keeps tool messages ordered', async () => {
  const events: Array<{ type: string; call: { id: string }; status?: string }> = []
  const sentMessages: any[][] = []
  const responses = [
    sseResponse([
      JSON.stringify({ choices: [{ delta: { tool_calls: [
        { index: 0, id: 'call_read', function: { name: 'read', arguments: '{"path":"missing.md"}' } },
        { index: 1, id: 'call_glob', function: { name: 'glob', arguments: '{"pattern":"*.md"}' } },
      ] } }] }),
      '[DONE]',
    ]),
    sseResponse([JSON.stringify({ choices: [{ delta: { content: '两个工具都失败了。' } }] }), '[DONE]']),
  ]

  await runDirectChatCompletion({
    messages: [{ role: 'user', content: '读取并搜索' }],
    tools: [{ type: 'function', function: { name: 'read' } }],
    onText: () => {},
    onToolEvent: event => events.push(event),
    beforeToolCall: async call => {
      if (call.function.name === 'read') throw new Error('审批服务不可用')
    },
    toolNeedsApproval: () => false,
    executeTool: async () => { throw new Error('glob unavailable') },
    sendChatCompletion: async request => {
      sentMessages.push(request.messages)
      return responses.shift()!
    },
  })

  assert.deepEqual(events.filter(event => event.type === 'tool_execution_start').map(event => event.call.id), ['call_read', 'call_glob'])
  assert.deepEqual(events.filter(event => event.type === 'tool_execution_end').map(event => [event.call.id, event.status]).sort(), [
    ['call_glob', 'failed'],
    ['call_read', 'failed'],
  ])
  assert.deepEqual(sentMessages[1].slice(-2).map(message => message.tool_call_id), ['call_read', 'call_glob'])
})

test('runDirectChatCompletion repairs an available_skills-prefixed skill call', async () => {
  const reportedCalls: Array<{ name: string; arguments: string }> = []
  const executedCalls: Array<{ name: string; arguments: string }> = []
  const responses = [
    sseResponse([
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_skill', function: { name: 'available_skills:user-example', arguments: '{}' } }] } }] }),
      '[DONE]',
    ]),
    sseResponse([
      JSON.stringify({ choices: [{ delta: { content: 'Skill 已加载' } }] }),
      '[DONE]',
    ]),
  ]

  await runDirectChatCompletion({
    messages: [{ role: 'user', content: '分析视频' }],
    tools: [{ type: 'function', function: { name: 'skill' } }],
    onText: () => {},
    onToolEvent: event => {
      if (event.type === 'tool_execution_start') reportedCalls.push({ ...event.call.function })
    },
    executeTool: async call => {
      executedCalls.push({ ...call.function })
      return { content: 'loaded' }
    },
    sendChatCompletion: async () => responses.shift()!,
  })

  const expected = [{ name: 'skill', arguments: '{"name":"user-example"}' }]
  assert.deepEqual(reportedCalls, expected)
  assert.deepEqual(executedCalls, expected)
})

test('runDirectChatCompletion leaves a prefixed call with non-empty arguments untouched', async () => {
  const seen: string[] = []
  const responses = [
    sseResponse([
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_bad', function: { name: 'available_skills:writer', arguments: '{"unexpected":true}' } }] } }] }),
      '[DONE]',
    ]),
    sseResponse([JSON.stringify({ choices: [{ delta: { content: 'done' } }] }), '[DONE]']),
  ]

  await runDirectChatCompletion({
    messages: [{ role: 'user', content: '写作' }],
    tools: [{ type: 'function', function: { name: 'skill' } }],
    onText: () => {},
    onToolEvent: event => {
      if (event.type === 'tool_execution_start') seen.push(event.call.function.name)
    },
    executeTool: async () => ({ content: 'failed', status: 'failed' }),
    sendChatCompletion: async () => responses.shift()!,
  })

  assert.deepEqual(seen, ['available_skills:writer'])
})

test('runDirectChatCompletion keeps the first-pass text when there are no tool calls', async () => {
  const result = await runDirectChatCompletion({
    messages: [{ role: 'user', content: '你好' }],
    onText: () => {},
    sendChatCompletion: async () => sseResponse([
      JSON.stringify({ choices: [{ delta: { content: '你好呀' } }] }),
      '[DONE]',
    ]),
  })

  assert.equal(result.text, '你好呀')
  assert.deepEqual(result.toolCalls, [])
})

test('runDirectChatCompletion tells the next model pass to repair a failed terminal call', async () => {
  const sentMessages: any[][] = []
  const responses = [
    sseResponse([
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_terminal', function: { name: 'terminal', arguments: '{"command":"extract-frame"}' } }] } }] }),
      '[DONE]',
    ]),
    sseResponse([
      JSON.stringify({ choices: [{ delta: { content: '我会换一种方式继续。' } }] }),
      '[DONE]',
    ]),
  ]

  await runDirectChatCompletion({
    messages: [{ role: 'user', content: '分析视频' }],
    tools: [{ type: 'function', function: { name: 'terminal' } }],
    onText: () => {},
    executeTool: async () => ({ content: 'Command: extract-frame\nExit code: 8\nstderr:\nfeature unavailable', status: 'failed' }),
    sendChatCompletion: async request => {
      sentMessages.push(request.messages)
      return responses.shift()!
    },
  })

  assert.match(sentMessages[1][2].content, /不要原样重复失败命令/)
})

test('runDirectChatCompletion continues through multiple tool rounds', async () => {
  const requests: any[] = []
  const executed: string[] = []
  const responses = [
    sseResponse([
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_skill', function: { name: 'skill', arguments: '{"name":"writer"}' } }] } }] }),
      '[DONE]',
    ]),
    sseResponse([
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_read', function: { name: 'read', arguments: '{"path":"wiki/hot.md"}' } }] } }] }),
      '[DONE]',
    ]),
    sseResponse([
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_write', function: { name: 'write', arguments: '{"path":"wiki/剧本/第1集.md","content":"正文"}' } }] } }] }),
      '[DONE]',
    ]),
    sseResponse([JSON.stringify({ choices: [{ delta: { content: '第一集已保存' } }] }), '[DONE]']),
  ]

  const result = await runDirectChatCompletion({
    messages: [{ role: 'user', content: '写第一集' }],
    tools: ['skill', 'read', 'write'].map(name => ({ type: 'function', function: { name } })),
    onText: () => {},
    executeTool: async call => {
      executed.push(call.function.name)
      return { content: `ok:${call.function.name}` }
    },
    sendChatCompletion: async request => {
      requests.push(request)
      return responses.shift()!
    },
  })

  assert.equal(result.text, '第一集已保存')
  assert.deepEqual(executed, ['skill', 'read', 'write'])
  assert.equal(requests.length, 4)
  assert.ok(requests.every(request => request.tools?.length === 3))
  assert.equal(result.usedSecondPass, true)
})

test('runDirectChatCompletion allows a normal task to use more than twelve tool rounds', async () => {
  let executions = 0
  let requests = 0

  const result = await runDirectChatCompletion({
    messages: [{ role: 'user', content: '逐镜分析长视频' }],
    tools: [{ type: 'function', function: { name: 'read' } }],
    onText: () => {},
    executeTool: async () => {
      executions += 1
      return { content: 'ok' }
    },
    sendChatCompletion: async () => {
      requests += 1
      if (requests <= 13) {
        return sseResponse([
          JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${requests}`, function: { name: 'read', arguments: `{"path":"frame_${requests}.jpg"}` } }] } }] }),
          '[DONE]',
        ])
      }
      return sseResponse([JSON.stringify({ choices: [{ delta: { content: '分析完成' } }] }), '[DONE]'])
    },
  })

  assert.equal(result.text, '分析完成')
  assert.equal(executions, 13)
})

test('runDirectChatCompletion does not execute an immediately repeated failed tool call', async () => {
  let executions = 0
  const responses = [
    sseResponse([JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'read', arguments: '{"path":"missing.jpg"}' } }] } }] }), '[DONE]']),
    sseResponse([JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_2', function: { name: 'read', arguments: '{"path":"missing.jpg"}' } }] } }] }), '[DONE]']),
    sseResponse([JSON.stringify({ choices: [{ delta: { content: '我会换一种办法。' } }] }), '[DONE]']),
  ]

  await runDirectChatCompletion({
    messages: [{ role: 'user', content: '读取文件' }],
    tools: [{ type: 'function', function: { name: 'read' } }],
    onText: () => {},
    executeTool: async () => {
      executions += 1
      return { content: 'file missing', status: 'failed' }
    },
    sendChatCompletion: async () => responses.shift()!,
  })

  assert.equal(executions, 1)
})

test('runDirectChatCompletion commits repeat protection in source order after parallel completion', async () => {
  let releaseFirst!: () => void
  const firstReleased = new Promise<void>(resolve => { releaseFirst = resolve })
  let firstExecutions = 0
  const responses = [
    sseResponse([JSON.stringify({ choices: [{ delta: { tool_calls: [
      { index: 0, id: 'call_first_1', function: { name: 'read', arguments: '{"path":"missing.md"}' } },
      { index: 1, id: 'call_second', function: { name: 'glob', arguments: '{"pattern":"*.md"}' } },
    ] } }] }), '[DONE]']),
    sseResponse([JSON.stringify({ choices: [{ delta: { tool_calls: [
      { index: 0, id: 'call_first_2', function: { name: 'read', arguments: '{"path":"missing.md"}' } },
    ] } }] }), '[DONE]']),
    sseResponse([JSON.stringify({ choices: [{ delta: { content: '完成' } }] }), '[DONE]']),
  ]

  await runDirectChatCompletion({
    messages: [{ role: 'user', content: '读取文件' }],
    tools: [
      { type: 'function', function: { name: 'read' } },
      { type: 'function', function: { name: 'glob' } },
    ],
    onText: () => {},
    executeTool: async call => {
      if (call.function.name === 'glob') {
        releaseFirst()
        return { content: 'ok' }
      }
      firstExecutions += 1
      if (call.id === 'call_first_1') {
        await firstReleased
        return { content: 'missing', status: 'failed' }
      }
      return { content: 'ok' }
    },
    sendChatCompletion: async () => responses.shift()!,
  })

  assert.equal(firstExecutions, 2)
})

test('runDirectChatCompletion includes streamed response time in model duration', async () => {
  const encoder = new TextEncoder()
  const result = await runDirectChatCompletion({
    messages: [{ role: 'user', content: '回答' }],
    onText: () => {},
    sendChatCompletion: async () => new Response(new ReadableStream({
      async start(controller) {
        await new Promise(resolve => setTimeout(resolve, 25))
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '完成' } }] })}\n\ndata: [DONE]\n\n`))
        controller.close()
      },
    }), { headers: { 'content-type': 'text/event-stream' } }),
  })

  assert.equal(result.metrics.modelRequestDurationMs.length, 1)
  assert.equal(result.metrics.modelRequestDurationMs[0] >= 15, true)
})

test('runDirectChatCompletion continues once after final text streaming is interrupted without rerunning tools', async () => {
  const requests: any[] = []
  const seen: string[] = []
  const responses = [
    interruptedSseResponse([JSON.stringify({ choices: [{ delta: { content: '已经完成前半段。' } }] })]),
    sseResponse([JSON.stringify({ choices: [{ delta: { content: '这是续写部分。' }, finish_reason: 'stop' }] }), '[DONE]']),
  ]

  const result = await runDirectChatCompletion({
    messages: [{ role: 'user', content: '写完整答案' }],
    tools: [{ type: 'function', function: { name: 'write' } }],
    onText: value => seen.push(value),
    sendChatCompletion: async request => {
      requests.push(request)
      return responses.shift()!
    },
  })

  assert.equal(result.text, '已经完成前半段。这是续写部分。')
  assert.equal(requests.length, 2)
  assert.equal(requests[1].tools, undefined)
  assert.equal(seen.at(-1), '已经完成前半段。这是续写部分。')
})

test('runDirectChatCompletion can retain tools during an interrupted memory continuation', async () => {
  const requests: any[] = []
  const responses = [
    interruptedSseResponse([
      JSON.stringify({ choices: [{ delta: { reasoning_content: '先分析资料' } }] }),
      JSON.stringify({ choices: [{ delta: { content: '前半段。' } }] }),
    ]),
    sseResponse([JSON.stringify({ choices: [{ delta: { content: '续写。' }, finish_reason: 'stop' }] }), '[DONE]']),
  ]
  const tools = [{ type: 'function', function: { name: 'read' } }]

  await runDirectChatCompletion({
    messages: [{ role: 'user', content: '读取资料并回答' }],
    tools,
    continueToolsOnInterruption: true,
    onText: () => {},
    sendChatCompletion: async request => {
      requests.push(request)
      return responses.shift()!
    },
  })

  assert.deepEqual(requests[1].tools, tools)
  assert.equal(requests[1].messages[1].reasoning_content, '先分析资料')
  assert.doesNotMatch(requests[1].messages.at(-1).content, /不要调用工具/)
})

test('runDirectChatCompletion executes a tool requested during an interrupted memory continuation', async () => {
  const requests: any[] = []
  const executions: string[] = []
  const responses = [
    interruptedSseResponse([JSON.stringify({ choices: [{ delta: { content: '先读取资料。' } }] })]),
    sseResponse([JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_read', function: { name: 'read', arguments: '{"path":"notes.md"}' } }] } }] }), '[DONE]']),
    sseResponse([JSON.stringify({ choices: [{ delta: { content: '资料已读取。' }, finish_reason: 'stop' }] }), '[DONE]']),
  ]

  const result = await runDirectChatCompletion({
    messages: [{ role: 'user', content: '读取资料并回答' }],
    tools: [{ type: 'function', function: { name: 'read' } }],
    continueToolsOnInterruption: true,
    onText: () => {},
    sendChatCompletion: async request => {
      requests.push(request)
      return responses.shift()!
    },
    executeTool: async call => {
      executions.push(call.function.name)
      return { content: '真实资料' }
    },
  })

  assert.deepEqual(executions, ['read'])
  assert.equal(requests.length, 3)
  assert.equal(result.text, '资料已读取。')
})

test('runDirectChatCompletion does not prepend earlier tool-round text to a resumed final answer', async () => {
  const responses = [
    sseResponse([
      JSON.stringify({ choices: [{ delta: {
        content: '正在读取素材。',
        tool_calls: [{ index: 0, id: 'call_read', function: { name: 'read', arguments: '{"path":"frame.jpg"}' } }],
      } }] }),
      '[DONE]',
    ]),
    interruptedSseResponse([JSON.stringify({ choices: [{ delta: { content: '正式正文前半段。' } }] })]),
    sseResponse([JSON.stringify({ choices: [{ delta: { content: '正式正文续写。' }, finish_reason: 'stop' }] }), '[DONE]']),
  ]

  const result = await runDirectChatCompletion({
    messages: [{ role: 'user', content: '完成分析' }],
    tools: [{ type: 'function', function: { name: 'read' } }],
    onText: () => {},
    executeTool: async () => ({ content: 'image loaded' }),
    sendChatCompletion: async () => responses.shift()!,
  })

  assert.equal(result.text, '正式正文前半段。正式正文续写。')
})

test('runDirectChatCompletion stops a runaway tool loop', async () => {
  await assert.rejects(() => runDirectChatCompletion({
    messages: [{ role: 'user', content: '循环' }],
    tools: [{ type: 'function', function: { name: 'read' } }],
    maxToolRounds: 2,
    onText: () => {},
    executeTool: async () => ({ content: 'ok' }),
    sendChatCompletion: async () => sseResponse([
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_read', function: { name: 'read', arguments: '{"path":"a"}' } }] } }] }),
      '[DONE]',
    ]),
  }), /工具调用超过 2 轮/)
})

test('runDirectChatCompletion enforces a hard model request limit', async () => {
  let requests = 0
  await assert.rejects(() => runDirectChatCompletion({
    messages: [{ role: 'user', content: '有限循环' }],
    tools: [{ type: 'function', function: { name: 'read' } }],
    maxToolRounds: 10,
    maxModelRequests: 3,
    allowedToolNamesAtModelRequestLimit: ['read'],
    onText: () => {},
    executeTool: async () => ({ content: 'ok' }),
    sendChatCompletion: async () => {
      requests += 1
      return sseResponse([
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call_read_${requests}`, function: { name: 'read', arguments: '{"path":"a"}' } }] } }] }),
        '[DONE]',
      ])
    },
  }), /模型请求超过 3 次/)
  assert.equal(requests, 3)
})

test('runDirectChatCompletion stops after a successful terminal tool', async () => {
  let requests = 0
  const result = await runDirectChatCompletion({
    messages: [{ role: 'user', content: '写入' }],
    tools: [{ type: 'function', function: { name: 'write' } }],
    stopAfterSuccessfulToolNames: ['write'],
    onText: () => {},
    executeTool: async () => ({ content: '已写入 wiki/结果.md', status: 'succeeded' }),
    sendChatCompletion: async () => {
      requests += 1
      return sseResponse([
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_write', function: { name: 'write', arguments: '{"path":"wiki/结果.md","content":"ok"}' } }] } }] }),
        '[DONE]',
      ])
    },
  })
  assert.equal(requests, 1)
  assert.equal(result.text, '已写入 wiki/结果.md')
})

test('runDirectChatCompletion rejects non-write tools at the request limit', async () => {
  await assert.rejects(() => runDirectChatCompletion({
    messages: [{ role: 'user', content: '读取' }],
    tools: [{ type: 'function', function: { name: 'read' } }],
    maxModelRequests: 1,
    allowedToolNamesAtModelRequestLimit: ['write', 'edit'],
    onText: () => {},
    executeTool: async () => ({ content: 'unexpected' }),
    sendChatCompletion: async () => sseResponse([
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_read', function: { name: 'read', arguments: '{"path":"a"}' } }] } }] }),
      '[DONE]',
    ]),
}), /只允许最终回答或指定写入工具/)
})

test('runDirectChatCompletion finalizes a read-only MCP task after the tool budget', async () => {
  let requests = 0
  const requestTools: unknown[] = []
  const result = await runDirectChatCompletion({
    messages: [{ role: 'user', content: '查找开源项目' }],
    tools: [{ type: 'function', function: { name: 'mcp__github__search' } }],
    maxModelRequests: 2,
    maxToolRounds: 2,
    finalizeAtModelRequestLimit: true,
    onText: () => {},
    executeTool: async () => ({ content: '项目结果' }),
    sendChatCompletion: async request => {
      requests += 1
      requestTools.push(request.tools)
      if (requests < 3) {
        return sseResponse([
          JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${requests}`, function: { name: 'mcp__github__search', arguments: '{}' } }] } }] }),
          '[DONE]',
        ])
      }
      return sseResponse([JSON.stringify({ choices: [{ delta: { content: '已找到项目' } }] }), '[DONE]'])
    },
  })

  assert.equal(result.text, '已找到项目')
  assert.equal(requests, 3)
  assert.equal(requestTools[2], undefined)
})

test('runDirectChatCompletion compacts prior tool rounds when enabled', async () => {
  const requests: any[][] = []
  let round = 0
  const result = await runDirectChatCompletion({
    messages: [{ role: 'system', content: '合同' }, { role: 'user', content: '任务' }],
    tools: [{ type: 'function', function: { name: 'read' } }],
    maxModelRequests: 3,
    compactToolHistory: true,
    onText: () => {},
    executeTool: async call => ({ content: `结果 ${call.function.arguments}` }),
    sendChatCompletion: async request => {
      requests.push(request.messages)
      round += 1
      if (round < 3) return sseResponse([
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${round}`, function: { name: 'read', arguments: `{\"path\":\"${round}\"}` } }] } }] }),
        '[DONE]',
      ])
      return sseResponse([JSON.stringify({ choices: [{ delta: { content: '完成' } }] }), '[DONE]'])
    },
  })
  assert.equal(result.text, '完成')
  assert.equal(requests.length, 3)
  assert.equal(requests[2].filter(message => message.role === 'tool').length, 1)
  assert.equal(JSON.stringify(requests[2]).includes('"path":"1"'), false)
})

test('runDirectChatCompletion does not spend logical request budget on HTTP retry callbacks', async () => {
  let calls = 0
  const result = await runDirectChatCompletion({
    messages: [{ role: 'user', content: '重试后回答' }],
    maxModelRequests: 1,
    onText: () => {},
    sendChatCompletion: async () => {
      calls += 1
      return sseResponse([JSON.stringify({ choices: [{ delta: { content: '完成' } }] }), '[DONE]'])
    },
  })
  assert.equal(result.text, '完成')
  assert.equal(calls, 1)
})

test('runDirectChatCompletion stops remaining tools when the run is aborted', async () => {
  const controller = new AbortController()
  const executed: string[] = []
  const events: Array<{ type: string; call: { id: string }; status?: string }> = []

  await assert.rejects(() => runDirectChatCompletion({
    messages: [{ role: 'user', content: '先读 Skill 再写文件' }],
    tools: [{ type: 'function', function: { name: 'skill' } }],
    onText: () => {},
    onToolEvent: event => events.push(event),
    signal: controller.signal,
    executeTool: async call => {
      executed.push(call.function.name)
      if (call.function.name === 'skill') controller.abort()
      return { content: 'ok' }
    },
    sendChatCompletion: async () => sseResponse([
      JSON.stringify({ choices: [{ delta: { tool_calls: [
        { index: 0, id: 'call_skill', function: { name: 'skill', arguments: '{}' } },
        { index: 1, id: 'call_write', function: { name: 'write', arguments: '{"path":"wiki/hot.md","content":"x"}' } },
      ] } }] }),
      '[DONE]',
    ]),
  }), error => error instanceof DOMException && error.name === 'AbortError')

  assert.deepEqual(executed, ['skill'])
  assert.deepEqual(events.map(event => [event.type, event.call.id, event.status]), [
    ['tool_execution_start', 'call_skill', undefined],
    ['tool_execution_end', 'call_skill', 'cancelled'],
  ])
})

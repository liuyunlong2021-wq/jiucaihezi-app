import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildToolResultMessages } from '../directTools'
import { parseCreativeToolArguments, WIKI_SEARCH_TOOL_DEFINITION } from '../creativeToolContract'

function call(id: string, name: string, args: Record<string, unknown> = {}) {
  return { id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }
}

test('buildToolResultMessages always returns paired assistant tool_calls and tool messages', async () => {
  const messages = await buildToolResultMessages([
    {
      id: '',
      type: 'function',
      function: { name: 'wiki_search', arguments: 'not json' },
    },
  ], async () => { throw new Error('Tool argument parse failed') })

  assert.equal(messages.length, 2)
  assert.equal(messages[0].role, 'assistant')
  assert.equal(messages[0].tool_calls.length, 1)
  assert.match(messages[0].tool_calls[0].id, /^call_wiki_search_/)
  assert.equal(messages[1].role, 'tool')
  assert.equal(messages[1].tool_call_id, messages[0].tool_calls[0].id)
  assert.match(messages[1].content, /Tool argument parse failed/)
})

test('buildToolResultMessages reports executor errors as tool results', async () => {
  let runs = 0
  const messages = await buildToolResultMessages([
    {
      id: 'call_unknown',
      type: 'function',
      function: { name: 'browser_open', arguments: '{"url":"https://example.com"}' },
    },
  ], async () => {
    runs += 1
    throw new Error('Unsupported tool: browser_open')
  })

  assert.equal(runs, 1)
  assert.equal(messages.length, 2)
  assert.equal(messages[0].role, 'assistant')
  assert.equal(messages[1].role, 'tool')
  assert.equal(messages[1].tool_call_id, 'call_unknown')
  assert.match(messages[1].content, /Unsupported tool: browser_open/)
})

test('buildToolResultMessages appends executor followup messages after tool outputs', async () => {
  const messages = await buildToolResultMessages([
    {
      id: 'call_empty_query',
      type: 'function',
      function: { name: 'wiki_search', arguments: '{"query":"   "}' },
    },
  ], async () => ({
    content: 'Image read successfully',
    followupMessages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/a.png' } }] }],
  }))

  assert.equal(messages.length, 3)
  assert.equal(messages[1].role, 'tool')
  assert.equal(messages[1].tool_call_id, 'call_empty_query')
  assert.equal(messages[1].content, 'Image read successfully')
  assert.equal(messages[2].role, 'user')
})

test('buildToolResultMessages passes the request abort signal into the executor', async () => {
  const controller = new AbortController()
  let receivedSignal: AbortSignal | undefined

  await buildToolResultMessages([
    {
      id: 'call_read',
      type: 'function',
      function: { name: 'read', arguments: '{"path":"wiki/hot.md"}' },
    },
  ], async (_call, signal) => {
    receivedSignal = signal
    return { content: 'ok' }
  }, { signal: controller.signal })

  assert.equal(receivedSignal, controller.signal)
})

test('buildToolResultMessages starts consecutive project reads in parallel and preserves result order', async () => {
  const started: string[] = []
  let releaseReads!: () => void
  const readsReleased = new Promise<void>(resolve => { releaseReads = resolve })
  const pending = buildToolResultMessages([
    call('call_a', 'read', { path: 'wiki/a.md' }),
    call('call_b', 'grep', { pattern: '规则', path: 'wiki' }),
  ], async toolCall => {
    started.push(toolCall.id)
    await readsReleased
    return { content: toolCall.id }
  })

  await new Promise(resolve => setTimeout(resolve, 0))
  try {
    assert.deepEqual(started, ['call_a', 'call_b'])
  } finally {
    releaseReads()
  }
  const messages = await pending
  assert.deepEqual(messages.slice(1).map(message => [message.tool_call_id, message.content]), [
    ['call_a', 'call_a'],
    ['call_b', 'call_b'],
  ])
})

test('buildToolResultMessages keeps writes and mutating Wiki actions as serial barriers', async () => {
  const timeline: string[] = []
  const messages = await buildToolResultMessages([
    call('call_read_a', 'read', { path: 'wiki/a.md' }),
    call('call_write', 'write', { path: 'wiki/b.md', content: 'b' }),
    call('call_read_c', 'read', { path: 'wiki/c.md' }),
    call('call_wiki_search', 'wiki', { action: 'search', query: '规则' }),
    call('call_wiki_replace', 'wiki', { action: 'replace', path: 'a.md' }),
  ], async toolCall => {
    timeline.push(`start:${toolCall.id}`)
    await Promise.resolve()
    timeline.push(`end:${toolCall.id}`)
    return { content: toolCall.id }
  })

  assert.deepEqual(timeline, [
    'start:call_read_a', 'end:call_read_a',
    'start:call_write', 'end:call_write',
    'start:call_read_c', 'start:call_wiki_search',
    'end:call_read_c', 'end:call_wiki_search',
    'start:call_wiki_replace', 'end:call_wiki_replace',
  ])
  assert.deepEqual(messages.slice(1).map(message => message.tool_call_id), [
    'call_read_a', 'call_write', 'call_read_c', 'call_wiki_search', 'call_wiki_replace',
  ])
})

test('buildToolResultMessages reports non-negative duration for success, failure, and cancellation', async () => {
  const events: any[] = []
  await buildToolResultMessages([
    call('call_ok', 'read', { path: 'wiki/a.md' }),
    call('call_failed', 'write', { path: 'wiki/b.md', content: 'b' }),
    call('call_cancelled', 'terminal', { command: 'pwd' }),
  ], async toolCall => {
    if (toolCall.id === 'call_failed') throw new Error('failed')
    return { content: 'ok' }
  }, {
    beforeToolCall: toolCall => toolCall.id === 'call_cancelled' ? 'cancelled' : undefined,
    onToolEvent: event => events.push(event),
  })

  const ended = events.filter(event => event.type === 'tool_execution_end')
  assert.deepEqual(ended.map(event => event.status), ['succeeded', 'failed', 'cancelled'])
  assert.equal(ended.every(event => Number.isFinite(event.durationMs) && event.durationMs >= 0), true)
})

test('buildToolResultMessages pairs cancelled calls and stops before a write after an aborted read segment', async () => {
  const controller = new AbortController()
  const executed: string[] = []

  const messages = await buildToolResultMessages([
    call('call_read_a', 'read', { path: 'wiki/a.md' }),
    call('call_read_b', 'read', { path: 'wiki/b.md' }),
    call('call_write', 'write', { path: 'wiki/c.md', content: 'c' }),
  ], async (toolCall, signal) => {
    executed.push(toolCall.id)
    assert.equal(signal, controller.signal)
    if (toolCall.id === 'call_read_a') controller.abort()
    return { content: 'ok' }
  }, { signal: controller.signal })

  assert.equal(executed.includes('call_write'), false)
  assert.deepEqual(messages.slice(1).map(message => message.tool_call_id), [
    'call_read_a', 'call_read_b', 'call_write',
  ])
  assert.equal(messages[3].content, '工具执行已取消。')
})

test('buildToolResultMessages does not parallelize project-external reads', async () => {
  const timeline: string[] = []
  await buildToolResultMessages([
    call('call_project', 'read', { path: 'wiki/a.md' }),
    call('call_external', 'read', { path: '/tmp/a.md' }),
    call('call_after', 'read', { path: 'wiki/b.md' }),
  ], async toolCall => {
    timeline.push(`start:${toolCall.id}`)
    await Promise.resolve()
    timeline.push(`end:${toolCall.id}`)
    return { content: 'ok' }
  })

  assert.deepEqual(timeline, [
    'start:call_project', 'end:call_project',
    'start:call_external', 'end:call_external',
    'start:call_after', 'end:call_after',
  ])
})

test('buildToolResultMessages keeps approval calls behind a serial barrier', async () => {
  const timeline: string[] = []
  let releaseApproval!: () => void
  const approvalReleased = new Promise<void>(resolve => { releaseApproval = resolve })
  const pending = buildToolResultMessages([
    call('call_read', 'read', { path: 'wiki/a.md' }),
    call('call_approval', 'read', { path: 'wiki/protected.md' }),
    call('call_after', 'grep', { path: 'wiki', pattern: '规则' }),
  ], async toolCall => {
    timeline.push(`execute:${toolCall.id}`)
    return { content: 'ok' }
  }, {
    toolNeedsApproval: toolCall => toolCall.id === 'call_approval',
    beforeToolCall: async toolCall => {
      timeline.push(`before:${toolCall.id}`)
      if (toolCall.id === 'call_approval') await approvalReleased
    },
  })

  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(timeline, [
    'before:call_read', 'execute:call_read',
    'before:call_approval',
  ])
  releaseApproval()
  await pending
  assert.deepEqual(timeline, [
    'before:call_read', 'execute:call_read',
    'before:call_approval', 'execute:call_approval',
    'before:call_after', 'execute:call_after',
  ])
})

test('Wiki tool schemas and argument parsing accept a bounded string array', () => {
  const query = WIKI_SEARCH_TOOL_DEFINITION.function.parameters.properties.query as any
  const arraySchema = query.anyOf.find((item: any) => item.type === 'array')
  assert.deepEqual([arraySchema.minItems, arraySchema.maxItems, arraySchema.items.type], [1, 3, 'string'])
  assert.deepEqual(
    parseCreativeToolArguments(call('call_search', 'wiki_search', { query: ['Codex', '并行读取'] })),
    { query: ['Codex', '并行读取'] },
  )
})

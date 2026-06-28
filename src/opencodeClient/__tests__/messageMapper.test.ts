import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mapOpenCodeMessagesToChatMessages } from '../messageMapper'
import {
  applyOpenCodePartDelta,
  buildOpenCodeTimelineRows,
  groupOpenCodeTimelineParts,
  isRenderableOpenCodePart,
  openCodePartDefaultOpen,
  normalizeOpenCodePart,
} from '../timelineRows'

test('maps OpenCode projected messages into existing ChatMessage shape', () => {
  const messages = mapOpenCodeMessagesToChatMessages([
    {
      id: 'u1',
      type: 'user',
      text: '你好',
      time: { created: 1000 },
    } as any,
    {
      id: 'a1',
      type: 'assistant',
      agent: 'build',
      model: { id: 'claude-sonnet-4-6', providerID: 'jiucaihezi' },
      time: { created: 1001 },
      content: [
        { type: 'reasoning', id: 'r1', text: '思考' },
        { type: 'text', id: 't1', text: '回答' },
      ],
    } as any,
  ])

  assert.equal(messages[0].role, 'user')
  assert.equal(messages[0].content, '你好')
  assert.equal(messages[0].timestamp, 1000 * 1000)
  assert.equal(messages[1].role, 'assistant')
  assert.equal(messages[1].content, '回答')
  assert.equal(messages[1].reasoningContent, '思考')
  assert.equal(messages[1].openCodeParts?.[0].type, 'reasoning')
  assert.equal(messages[1].openCodeParts?.[1].type, 'text')
})

test('normalizes OpenCode ISO timestamps to numeric milliseconds for Vue props', () => {
  const messages = mapOpenCodeMessagesToChatMessages([
    {
      id: 'a_iso',
      type: 'assistant',
      time: { created: '2026-06-15T12:49:00.246Z' },
      content: [{ type: 'text', id: 't1', text: '完成' }],
    } as any,
  ])

  assert.equal(messages[0].timestamp, Date.parse('2026-06-15T12:49:00.246Z'))
  assert.equal(Number.isFinite(messages[0].timestamp), true)
})

test('drops OpenCode status-only messages from chat display', () => {
  const messages = mapOpenCodeMessagesToChatMessages([
    {
      id: 'switch',
      type: 'agent-switched',
      agent: 'build',
      time: { created: 1000 },
    } as any,
  ])

  assert.deepEqual(messages, [])
})

test('maps OpenCode tool parts into assistant tool calls and tool result messages', () => {
  const messages = mapOpenCodeMessagesToChatMessages([
    {
      info: { id: 'a1', type: 'assistant', agent: 'coder', time: { created: 1001 } },
      parts: [
        { type: 'text', id: 't1', text: '我需要读取文件。' },
        {
          type: 'tool',
          id: 'p-tool',
          callID: 'call_1',
          tool: 'read',
          state: {
            status: 'completed',
            input: { filePath: 'README.md' },
            output: '旧格式输出',
            title: '读取 README',
            metadata: {},
            time: { start: 1001, end: 1002 },
          },
        },
      ],
    } as any,
  ])

  assert.equal(messages.length, 2)
  assert.equal(messages[0].role, 'assistant')
  assert.equal(messages[0].toolCalls?.[0].id, 'call_1')
  assert.equal(messages[0].toolCalls?.[0].function.name, 'read')
  assert.match(messages[0].toolCalls?.[0].function.arguments || '', /README\.md/)
  assert.equal(messages[0].openCodeParts?.[1].type, 'tool')
  assert.equal(messages[0].openCodeParts?.[1].toolName, 'read')
  assert.equal(messages[0].openCodeParts?.[1].status, 'completed')
  assert.equal(messages[1].role, 'tool')
  assert.equal(messages[1].toolCallId, 'call_1')
  assert.equal(messages[1].toolName, 'read')
  assert.match(messages[1].content, /旧格式输出/)
})

test('maps v2 session assistant tool content into existing tool card shape', () => {
  const messages = mapOpenCodeMessagesToChatMessages([
    {
      id: 'a2',
      type: 'assistant',
      agent: 'coder',
      time: { created: 1002 },
      content: [
        { type: 'text', id: 'txt', text: '完成。' },
        {
          type: 'tool',
          id: 'call_2',
          name: 'bash',
          state: {
            status: 'completed',
            input: { command: 'pwd' },
            structured: {},
            content: [{ type: 'text', text: '/tmp/project' }],
          },
          time: { created: 1002, completed: 1003 },
        },
      ],
    } as any,
  ])

  assert.equal(messages.length, 2)
  assert.equal(messages[0].content, '完成。')
  assert.equal(messages[0].toolCalls?.[0].function.name, 'bash')
  assert.match(messages[1].content, /tmp\/project/)
})

test('keeps non-text OpenCode parts structured without flattening them into message content', () => {
  const messages = mapOpenCodeMessagesToChatMessages([
    {
      info: { id: 'a3', type: 'assistant', agent: 'coder', time: { created: 1003 } },
      parts: [
        { type: 'file', id: 'file1', filename: 'demo.txt', mime: 'text/plain', url: 'file://demo.txt' },
        { type: 'subtask', id: 'sub1', description: '分析仓库', prompt: 'scan', agent: 'coder' },
        { type: 'step-start', id: 's1' },
        { type: 'patch', id: 'patch1', hash: 'abc', files: ['src/a.ts'] },
        { type: 'snapshot', id: 'snap1', snapshot: 'snap_123' },
        { type: 'agent', id: 'agent1', name: 'plan' },
        { type: 'compaction', id: 'compact1', auto: true },
        { type: 'unknown-new-part', id: 'x1', value: 123 },
      ],
    } as any,
  ])

  assert.equal(messages.length, 1)
  assert.equal(messages[0].content, '')
  assert.equal(messages[0].openCodeParts?.length, 8)
  assert.equal(messages[0].openCodeParts?.[0]?.type, 'file')
  assert.equal(messages[0].openCodeParts?.[7]?.type, 'unknown-new-part')
})

test('maps OpenCode errors into visible assistant messages', () => {
  const messages = mapOpenCodeMessagesToChatMessages([
    {
      id: 'a4',
      type: 'assistant',
      agent: 'coder',
      time: { created: 1004 },
      content: [],
      error: { type: 'unknown', message: 'provider failed' },
    } as any,
  ])

  assert.equal(messages.length, 1)
  assert.equal(messages[0].finishReason, 'error')
  assert.match(messages[0].content, /provider failed/)
})

test('normalizes structured OpenCode content fields before display filtering', () => {
  const messages = mapOpenCodeMessagesToChatMessages([
    {
      id: 'u_structured',
      type: 'user',
      time: { created: 1005 },
      text: [{ type: 'text', text: '结构化用户输入' }],
    } as any,
    {
      id: 'a_structured',
      type: 'assistant',
      time: { created: 1006 },
      summary: { message: '结构化摘要' },
    } as any,
    {
      id: 'a_empty_object',
      type: 'assistant',
      time: { created: 1007 },
      system: { unsupported: true },
    } as any,
  ])

  assert.equal(messages.length, 2)
  assert.equal(typeof messages[0].content, 'string')
  assert.equal(messages[0].content, '结构化用户输入')
  assert.equal(typeof messages[1].content, 'string')
  assert.match(messages[1].content, /结构化摘要/)
})

test('maps official text-like content parts without flattening non-text parts', () => {
  const messages = mapOpenCodeMessagesToChatMessages([
    {
      id: 'a_output_text',
      type: 'assistant',
      time: { created: 1008 },
      content: [
        { type: 'output_text', text: '官方输出文本' },
        { type: 'input_image', image_url: 'file://ignored.png' },
        { type: 'text', content: [{ type: 'text', text: '嵌套文本' }] },
      ],
    } as any,
  ])

  assert.equal(messages.length, 1)
  assert.equal(messages[0].content, '官方输出文本嵌套文本')
})

test('maps shell messages into visible OpenCode shell parts', () => {
  const [message] = mapOpenCodeMessagesToChatMessages([
    {
      id: 'shell1',
      type: 'shell',
      callID: 'call1',
      command: 'pwd',
      output: '/repo',
      time: { created: 1001, completed: 1002 },
    } as any,
  ])

  assert.equal(message.role, 'assistant')
  assert.equal(message.content, '')
  assert.equal(message.openCodeParts?.[0]?.type, 'shell')
  assert.equal(message.openCodeParts?.[0]?.toolName, 'shell')
})

test('builds OpenCode timeline rows without flattening assistant parts into one display unit', () => {
  const messages = mapOpenCodeMessagesToChatMessages([
    { id: 'u1', type: 'user', text: '读一下 README', time: { created: 1000 } } as any,
    {
      info: { id: 'a1', type: 'assistant', agent: 'coder', time: { created: 1001 } },
      parts: [
        { type: 'reasoning', id: 'r1', text: '## 计划\n先读文件' },
        { type: 'tool', id: 'read1', callID: 'call_1', tool: 'read', state: { status: 'running', input: { filePath: 'README.md' } } },
        { type: 'text', id: 't1', text: '我正在读取。' },
      ],
    } as any,
  ])

  const rows = buildOpenCodeTimelineRows(messages, {
    isStreaming: true,
    activeAssistantMessageId: 'a1',
  })

  assert.deepEqual(rows.map(row => row.type), ['user', 'context-group', 'assistant-part'])
  assert.equal(rows[1].type === 'context-group' ? rows[1].parts[0].toolName : '', 'read')
})

test('builds dedicated system rows for OpenCode runtime events', () => {
  const messages = mapOpenCodeMessagesToChatMessages([
    {
      info: { id: 'a_sys', type: 'assistant', agent: 'coder', time: { created: 1001 } },
      parts: [
        { type: 'agent', id: 'agent1', name: 'build' },
        { type: 'compaction', id: 'compact1', auto: true, overflow: true },
        { type: 'retry', id: 'retry1', attempt: 2, error: { message: 'rate limited' } },
        { type: 'step-finish', id: 'step1', reason: 'done' },
        { type: 'step-fail', id: 'step2', error: { message: 'failed' } },
      ],
    } as any,
  ])

  const rows = buildOpenCodeTimelineRows(messages)

  assert.deepEqual(rows.map(row => row.type), [
    'turn-divider',
    'system-event',
  ])
  assert.equal(rows[0].type === 'turn-divider' ? rows[0].label : '', 'compaction')
  assert.match(rows[1].type === 'system-event' ? rows[1].text : '', /rate limited/)
  assert.doesNotMatch(rows.map(row => row.type === 'system-event' ? row.text : '').join('\n'), /build/)
})

test('applies OpenCode part delta to arbitrary official fields without dropping non-text data', () => {
  const message = {
    id: 'a_delta',
    role: 'assistant',
    content: '',
    timestamp: 1000,
    openCodeParts: [
      normalizeOpenCodePart({
        type: 'tool',
        id: 'tool1',
        tool: 'bash',
        state: { status: 'running', input: { command: 'pwd' }, output: 'line 1' },
      }, 'a_delta'),
    ],
  } as any

  const part = applyOpenCodePartDelta(message, 'tool1', 'result', '\nline 2')

  assert.equal(part.type, 'tool')
  assert.match(part.result || '', /line 2/)
  assert.equal(message.openCodeParts[0].result, 'line 1\nline 2')
})

test('keeps official hidden tools out of normal timeline while preserving todo dock carrier expectations', () => {
  const todoPart = normalizeOpenCodePart({
    type: 'tool',
    id: 'todo1',
    tool: 'todowrite',
    state: { status: 'completed', input: { todos: [{ content: 'x' }] } },
  }, 'a_todo')
  const questionPart = normalizeOpenCodePart({
    type: 'tool',
    id: 'q1',
    tool: 'question',
    state: { status: 'running', input: { question: '继续吗？' } },
  }, 'a_todo')

  assert.equal(isRenderableOpenCodePart(todoPart), false)
  assert.equal(isRenderableOpenCodePart(questionPart), false)
})

test('groups consecutive official context tools into a single context group', () => {
  const parts = [
    normalizeOpenCodePart({ type: 'tool', id: 'read1', tool: 'read', state: { status: 'completed' } }, 'a_ctx'),
    normalizeOpenCodePart({ type: 'tool', id: 'grep1', tool: 'grep', state: { status: 'completed' } }, 'a_ctx'),
    normalizeOpenCodePart({ type: 'text', id: 'text1', text: '完成' }, 'a_ctx'),
    normalizeOpenCodePart({ type: 'tool', id: 'bash1', tool: 'bash', state: { status: 'completed' } }, 'a_ctx'),
  ]

  const groups = groupOpenCodeTimelineParts(parts)

  assert.deepEqual(groups.map(group => group.type), ['context', 'part', 'part'])
  assert.equal(groups[0].type === 'context' ? groups[0].parts.length : 0, 2)
  assert.equal(groups[1].type === 'part' ? groups[1].part.type : '', 'text')
})

test('aligns shell and edit tool default expansion with official settings flags', () => {
  const bash = normalizeOpenCodePart({ type: 'tool', id: 'bash1', tool: 'bash', state: { status: 'completed' } }, 'a_open')
  const edit = normalizeOpenCodePart({ type: 'tool', id: 'edit1', tool: 'edit', state: { status: 'completed' } }, 'a_open')
  const write = normalizeOpenCodePart({ type: 'tool', id: 'write1', tool: 'write', state: { status: 'completed' } }, 'a_open')
  const patch = normalizeOpenCodePart({ type: 'tool', id: 'patch1', tool: 'apply_patch', state: { status: 'completed' } }, 'a_open')
  const read = normalizeOpenCodePart({ type: 'tool', id: 'read1', tool: 'read', state: { status: 'completed' } }, 'a_open')

  assert.equal(openCodePartDefaultOpen(bash), false)
  assert.equal(openCodePartDefaultOpen(bash, { shellToolPartsExpanded: true }), true)
  assert.equal(openCodePartDefaultOpen(edit, { editToolPartsExpanded: true }), true)
  assert.equal(openCodePartDefaultOpen(write, { editToolPartsExpanded: true }), true)
  assert.equal(openCodePartDefaultOpen(patch, { editToolPartsExpanded: true }), true)
  assert.equal(openCodePartDefaultOpen(read, { shellToolPartsExpanded: true, editToolPartsExpanded: true }), undefined)
})

test('renders dismissed OpenCode question as a weak system event instead of a normal tool row', () => {
  const messages = mapOpenCodeMessagesToChatMessages([
    {
      info: { id: 'a_question', type: 'assistant', agent: 'coder', time: { created: 1001 } },
      parts: [
        {
          type: 'tool',
          id: 'q_dismissed',
          tool: 'question',
          state: {
            status: 'error',
            input: { question: '继续吗？' },
            error: 'Error: User dismissed this question',
          },
        },
      ],
    } as any,
  ])

  const rows = buildOpenCodeTimelineRows(messages)

  assert.deepEqual(rows.map(row => row.type), ['system-event'])
  assert.match(rows[0].type === 'system-event' ? rows[0].text : '', /问题已忽略/)
})

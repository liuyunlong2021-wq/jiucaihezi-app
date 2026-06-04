import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createToolRuntimeKernel } from '../kernel'

test('kernel rejects tool calls that were not exposed by ToolConnection', async () => {
  const kernel = createToolRuntimeKernel({
    executors: {
      demo_tool: async () => ({ status: 'ok', toolName: 'demo_tool', data: { ok: true } }),
    },
  })

  const result = await kernel.execute({
    call: {
      id: 'call_1',
      function: {
        name: 'demo_tool',
        arguments: '{}',
      },
    },
    exposedToolNames: new Set(['other_tool']),
  })

  assert.equal(result.status, 'error')
  assert.equal(result.errorCode, 'TOOL_NOT_EXPOSED')
  assert.equal(result.toolName, 'demo_tool')
})

test('kernel executes a registered tool when ToolConnection exposed it', async () => {
  const kernel = createToolRuntimeKernel({
    executors: {
      demo_tool: async ({ args, call }) => ({
        status: 'ok',
        toolName: call.function.name,
        callId: call.id,
        data: { value: args.value },
      }),
    },
  })

  const result = await kernel.execute({
    call: {
      id: 'call_2',
      function: {
        name: 'demo_tool',
        arguments: '{"value":"ready"}',
      },
    },
    exposedToolNames: new Set(['demo_tool']),
  })

  assert.equal(result.status, 'ok')
  assert.equal(result.toolName, 'demo_tool')
  assert.equal(result.callId, 'call_2')
  assert.deepEqual(result.data, { value: 'ready' })
})

test('kernel can delegate exposed tools to a fallback executor with parsed args and context', async () => {
  const seen: Array<{ value: unknown; context: unknown }> = []
  const kernel = createToolRuntimeKernel({
    executors: {},
    fallbackExecutor: async ({ args, context }) => {
      seen.push({ value: args.value, context })
      return {
        status: 'ok',
        toolName: 'fallback_tool',
        message: JSON.stringify({ status: 'success', value: args.value }),
      }
    },
  })

  const context = { files: [{ name: 'demo.md', content: 'content' }] }
  const result = await kernel.execute({
    call: {
      id: 'call_fallback_1',
      function: {
        name: 'fallback_tool',
        arguments: '{"value":"from-kernel"}',
      },
    },
    exposedToolNames: new Set(['fallback_tool']),
    context,
  })

  assert.equal(result.status, 'ok')
  assert.equal(result.message, '{"status":"success","value":"from-kernel"}')
  assert.deepEqual(seen, [{ value: 'from-kernel', context }])
})

test('kernel returns structured errors for invalid JSON arguments', async () => {
  const kernel = createToolRuntimeKernel({
    executors: {
      demo_tool: async () => ({ status: 'ok', toolName: 'demo_tool' }),
    },
  })

  const result = await kernel.execute({
    call: {
      id: 'call_3',
      function: {
        name: 'demo_tool',
        arguments: '{"broken"',
      },
    },
    exposedToolNames: new Set(['demo_tool']),
  })

  assert.equal(result.status, 'error')
  assert.equal(result.errorCode, 'INVALID_TOOL_ARGUMENTS_JSON')
  assert.match(result.errorMessage || '', /JSON/)
})

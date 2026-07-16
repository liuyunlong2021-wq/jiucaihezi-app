import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildToolDisplayModel } from '../toolDisplayModel'

test('buildToolDisplayModel hides empty tool summaries', () => {
  const model = buildToolDisplayModel({ toolCalls: [], files: [] })

  assert.equal(model.visible, false)
  assert.equal(model.status, 'idle')
})

test('buildToolDisplayModel summarizes pending tool calls without exposing arguments by default', () => {
  const model = buildToolDisplayModel({
    toolCalls: [{
      id: 'call_1',
      type: 'function',
      function: { name: 'create_document', arguments: '{"content":"secret"}' },
    }],
    files: [],
  })

  assert.equal(model.visible, true)
  assert.equal(model.status, 'queued')
  assert.equal(model.title, '准备使用 1 个工具')
  assert.equal(model.primaryToolLabel, '创建文档')
  assert.equal(model.showArgumentsByDefault, false)
})

test('buildToolDisplayModel treats generated files as the primary success result', () => {
  const model = buildToolDisplayModel({
    toolCalls: [{
      id: 'call_1',
      type: 'function',
      function: { name: 'office_create', arguments: '{}' },
    }],
    files: [{ filename: '剧本.docx', url: 'asset://outputs/script.docx', size: 2048 }],
  })

  assert.equal(model.visible, true)
  assert.equal(model.status, 'succeeded')
  assert.equal(model.title, '已生成 1 个文件')
  assert.equal(model.files[0].filename, '剧本.docx')
  assert.equal(model.files[0].sizeLabel, '2.0 KB')
})

test('buildToolDisplayModel uses explicit failure status instead of scanning tool content', () => {
  const model = buildToolDisplayModel({
    toolCalls: [{
      id: 'call_1',
      type: 'function',
      function: { name: 'run_code', arguments: '{}' },
    }],
    files: [],
    toolResult: '<skill_content>测试失败案例和 failed 断言</skill_content>',
    status: 'succeeded',
  })

  assert.equal(model.visible, true)
  assert.equal(model.status, 'succeeded')
  assert.equal(model.title, '工具已完成')
})

test('buildToolDisplayModel treats successful tool result without files as completed evidence', () => {
  const model = buildToolDisplayModel({
    toolCalls: [{
      id: 'call_1',
      type: 'function',
      function: { name: 'browser_search', arguments: '{}' },
    }],
    toolResult: '{"status":"success","result":"done"}',
  })

  assert.equal(model.visible, true)
  assert.equal(model.status, 'succeeded')
  assert.equal(model.title, '工具已完成')
})

test('buildToolDisplayModel labels MCP calls as external add-on tools', () => {
  const model = buildToolDisplayModel({
    toolCalls: [{
      id: 'call_mcp_1',
      type: 'function',
      function: { name: 'mcp__docs__lookup', arguments: '{}' },
    }],
  })

  assert.equal(model.primaryToolLabel, '外挂工具 · docs / lookup')
})

test('buildToolDisplayModel can explicitly settle cancelled tool runs', () => {
  const model = buildToolDisplayModel({
    toolCalls: [{
      id: 'call_1',
      type: 'function',
      function: { name: 'create_document', arguments: '{}' },
    }],
    status: 'cancelled',
  })

  assert.equal(model.visible, true)
  assert.equal(model.status, 'cancelled')
  assert.equal(model.title, '工具已取消')
  assert.equal(model.showArgumentsByDefault, false)
})

test('buildToolDisplayModel treats disabled tool flow as cancelled instead of running', () => {
  const model = buildToolDisplayModel({
    toolCalls: [{
      id: 'call_1',
      type: 'function',
      function: { name: 'browser_search', arguments: '{}' },
    }],
    toolResult: '{"status":"cancelled","reason":"tool_disabled"}',
    status: 'cancelled',
  })

  assert.equal(model.visible, true)
  assert.equal(model.status, 'cancelled')
  assert.equal(model.title, '工具已取消')
})

test('buildToolDisplayModel keeps completed steps active while the model is preparing its answer', () => {
  const model = buildToolDisplayModel({
    toolCalls: [{
      id: 'call_frame',
      type: 'function',
      function: { name: 'terminal', arguments: '{}' },
    }],
    steps: [{ toolCallId: 'call_frame', name: 'terminal', phase: 'result', result: 'ok', isError: false }],
    isRunning: true,
  })

  assert.equal(model.status, 'running')
  assert.equal(model.title, '正在整理结果')
})

test('buildToolDisplayModel summarizes completed step count after the direct run ends', () => {
  const model = buildToolDisplayModel({
    toolCalls: [{
      id: 'call_skill',
      type: 'function',
      function: { name: 'skill', arguments: '{}' },
    }, {
      id: 'call_frame',
      type: 'function',
      function: { name: 'terminal', arguments: '{}' },
    }],
    steps: [
      { toolCallId: 'call_skill', name: 'skill', phase: 'result', result: 'ok', isError: false },
      { toolCallId: 'call_frame', name: 'terminal', phase: 'result', result: 'ok', isError: false },
    ],
  })

  assert.equal(model.status, 'succeeded')
  assert.equal(model.title, '已完成 2 步')
})

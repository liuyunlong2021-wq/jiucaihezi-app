import assert from 'node:assert/strict'
import { test } from 'node:test'

import { memoryToolNeedsApproval } from '../memoryToolPolicy'

function call(name: string, args: Record<string, unknown>) {
  return { id: `call_${name}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }
}

test('memory tools approve side effects without blocking safe project work', () => {
  assert.equal(memoryToolNeedsApproval(call('read', { path: 'wiki/hot.md' }), '查看资料'), false)
  assert.equal(memoryToolNeedsApproval(call('write', { path: 'wiki/new.md', content: 'x' }), '保存资料'), false)
  assert.equal(memoryToolNeedsApproval(call('terminal', { command: 'ls' }), '运行命令'), true)
  assert.equal(memoryToolNeedsApproval(call('delete', { path: 'wiki/new.md' }), '删除资料'), true)
})

test('memory tools require explicit current-turn paths before external access', () => {
  assert.equal(memoryToolNeedsApproval(call('read', { path: 'skill://local/wiki/references/rule.md' }), '执行 Wiki'), false)
  assert.equal(memoryToolNeedsApproval(call('read', { path: '/tmp/source.txt' }), '读取 /tmp/source.txt'), false)
  assert.equal(memoryToolNeedsApproval(call('write', { path: '/tmp/result.txt', content: 'x' }), '保存到 /tmp/result.txt'), true)
  assert.throws(
    () => memoryToolNeedsApproval(call('write', { path: '/tmp/result.txt', content: 'x' }), '保存结果'),
    /本轮明确提供/,
  )
  assert.throws(
    () => memoryToolNeedsApproval(call('read', { path: '/tmp/source.txt' }), '查看资料'),
    /本轮明确提供/,
  )
  assert.throws(
    () => memoryToolNeedsApproval(call('read', { path: '/' }), '读取 https://example.com'),
    /本轮明确提供/,
  )
  assert.throws(
    () => memoryToolNeedsApproval(call('read', { path: '/tmp/a.txt' }), '读取 /tmp/a.txt.bak'),
    /本轮明确提供/,
  )
  assert.throws(
    () => memoryToolNeedsApproval(call('read', { path: '/skills/wiki/references/rule.md' }), '执行 Wiki'),
    /本轮明确提供/,
  )
  assert.throws(
    () => memoryToolNeedsApproval(call('write', { path: '/skills/new.md', content: 'x' }), '执行 Skill'),
    /本轮明确提供/,
  )
})

test('memory wiki previews auto-run but writing actions require approval', () => {
  assert.equal(memoryToolNeedsApproval(call('wiki', { action: 'inspect' }), '检查 Wiki'), false)
  assert.equal(memoryToolNeedsApproval(call('wiki', { action: 'replace', apply: false }), '预览修改'), false)
  assert.equal(memoryToolNeedsApproval(call('wiki', { action: 'scaffold' }), '创建 Wiki'), true)
  assert.equal(memoryToolNeedsApproval(call('wiki', { action: 'graph' }), '生成关系图'), true)
  assert.equal(memoryToolNeedsApproval(call('wiki', { action: 'replace', apply: true }), '修改 Wiki'), true)
  assert.equal(memoryToolNeedsApproval(call('wiki', { action: 'link', apply: true }), '修改 Wiki'), true)
  assert.equal(memoryToolNeedsApproval(call('wiki', { action: 'extend', apply: true }), '修改 Wiki'), true)
})

test('memory tools auto-run annotated read-only MCP and approve unannotated MCP', () => {
  const original = (globalThis as any).__jiucaihezi_mcpStore__
  ;(globalThis as any).__jiucaihezi_mcpStore__ = {
    useMcpStore: () => ({
      allMcpTools: [{
        name: 'mcp__github__get_file', description: '', inputSchema: {}, serverId: 'github', originalName: 'get_file',
        annotations: { readOnlyHint: true },
      }],
      isServerEnabled: () => true,
      isServerConnected: () => true,
    }),
  }
  try {
    assert.equal(memoryToolNeedsApproval(call('mcp__github__get_file', {}), '查看仓库'), false)
    assert.equal(memoryToolNeedsApproval(call('mcp__github__create_issue', {}), '创建 issue'), true)
  } finally {
    ;(globalThis as any).__jiucaihezi_mcpStore__ = original
  }
})

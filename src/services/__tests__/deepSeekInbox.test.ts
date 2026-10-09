import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deepSeekSessionInbox, deepSeekSessionProcess, deepSeekSessionUsage } from '@/services/deepSeekHarness'

const message = (id: string, text: string) => ({
  id, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }],
})

test('session Inbox is reconstructed from durable splice events in order', () => {
  const snapshot = { session: { id: 's' }, events: [
    { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, inserted: [message('a', '第一条'), message('b', '第二条')] } },
    { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 1, removedCount: 1, inserted: [message('c', '已编辑')] } },
    { type: 'agent/inbox/spliced', data: { target: 'next-step', start: 0, inserted: [message('d', '转向')] } },
  ] }
  assert.deepEqual(deepSeekSessionInbox(snapshot).map(item => [item.id, item.target, item.text]), [
    ['a', 'next-turn', '第一条'], ['c', 'next-turn', '已编辑'], ['d', 'next-step', '转向'],
  ])
})

test('session Inbox applies removals and consumption without duplicating inserted messages', () => {
  const snapshot = { session: { id: 's' }, events: [
    { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, inserted: [message('a', '保留'), message('b', '删除')] } },
    { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 1, removedCount: 1, inserted: [] } },
    { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [] } },
  ] }
  assert.deepEqual(deepSeekSessionInbox(snapshot).map(item => item.id), [])
})

test('session process retains PTC parent links and trusted read line metadata', () => {
  const snapshot = { session: { id: 's' }, events: [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'user/message', surfaceOp: 'append', seq: 1, time: 1, data: { ...message('u1', '查文件'), source: { kind: 'user' } } },
    { type: 'tool/call', data: { turn: 1, step: 1, callId: 'root', name: 'run_code', arguments: '{}' }, time: 2 },
    { type: 'tool/ptc-dispatch-start', data: { rootCallId: 'root', parentCallId: 'root', subCallId: 'child', name: 'read', arguments: { file_path: 'docs/a.md' } }, time: 3 },
    { type: 'tool/ptc-dispatch', data: { rootCallId: 'root', parentCallId: 'root', subCallId: 'child', name: 'read', arguments: {}, isError: false, content: [{ type: 'text', text: '1: A' }] }, time: 4 },
    { type: 'tool/result', surfaceOp: 'append', data: { message: { toolCallId: 'root', isError: false, content: [{ type: 'text', text: 'done' }] }, meta: { path: 'docs/a.md', offset: 7, lines: [{ number: 7, text: 'G' }], totalLines: 10, lang: 'md' } }, time: 5 },
    { type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, message: { id: 'a1', content: [{ type: 'text', text: '完成' }] }, usage: { inputTokens: 30, outputTokens: 5, cacheReadTokens: 10 } }, time: 6 },
    { type: 'turn/end', data: { turn: 1 } },
  ] }
  const steps = deepSeekSessionProcess(snapshot).get('u1') || []
  assert.equal(steps.length, 2)
  assert.equal(steps[1]?.parentCallId, 'root')
  assert.deepEqual(steps[0]?.readFile, { path: 'docs/a.md', lineStart: 7, lineCount: 1, totalLines: 10, language: 'md' })
  assert.deepEqual(deepSeekSessionUsage(snapshot).get('u1'), { inputTokens: 30, outputTokens: 5, cacheReadTokens: 10 })
})

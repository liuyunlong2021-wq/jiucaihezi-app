import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChatMessage } from '@/composables/useChat'
import {
  buildContinuationChildrenByParent,
  buildLatestToolResultByAssistantId,
  collectContinuationThreadIds,
  getContinuationTailMessage,
} from '../continuationDisplayModel'

function assistant(id: string, content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role: 'assistant', content, timestamp: 1, ...extra }
}

function user(id: string, content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role: 'user', content, timestamp: 1, ...extra }
}

function tool(id: string, content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role: 'tool', content, timestamp: 1, ...extra }
}

test('buildContinuationChildrenByParent keeps continuation metadata in order', () => {
  const children = buildContinuationChildrenByParent([
    assistant('parent', '第一段'),
    assistant('child1', '第二段', {
      continuationParentId: 'parent',
      finishReason: 'length',
      reasoningContent: 'reasoning',
      officeDownloadFiles: [{ filename: 'a.docx', url: 'asset://a.docx' }],
      searchResults: [{ title: 'source', url: 'https://example.com', snippet: 's' }],
    }),
    assistant('child2', '第三段', { continuationParentId: 'parent' }),
  ]).get('parent')

  assert.equal(children?.length, 2)
  assert.equal(children?.[0].id, 'child1')
  assert.equal(children?.[0].finishReason, 'length')
  assert.equal(children?.[0].reasoningContent, 'reasoning')
  assert.equal(children?.[0].officeDownloadFiles?.[0].filename, 'a.docx')
  assert.equal(children?.[1].id, 'child2')
})

test('buildLatestToolResultByAssistantId assigns hidden tool results to the requesting assistant', () => {
  const result = buildLatestToolResultByAssistantId([
    assistant('toolAssistant', '', {
      toolCalls: [{ id: 'call_1', type: 'function', function: { name: 'create_document', arguments: '{}' } }],
    }),
    tool('toolResult', '{"status":"success"}', { toolCallId: 'call_1', toolName: 'create_document' }),
    assistant('finalAssistant', '文档已生成'),
  ])

  assert.equal(result.get('toolAssistant'), '{"status":"success"}')
  assert.equal(result.has('finalAssistant'), false)
})

test('buildContinuationChildrenByParent carries hidden tool result evidence into continuation parts', () => {
  const children = buildContinuationChildrenByParent([
    assistant('parent', '第一段'),
    assistant('child1', '第二段', {
      continuationParentId: 'parent',
      toolCalls: [{ id: 'call_1', type: 'function', function: { name: 'create_document', arguments: '{}' } }],
    }),
    tool('toolResult', '{"status":"success"}', {
      continuationParentId: 'parent',
      toolCallId: 'call_1',
      toolName: 'create_document',
    }),
  ]).get('parent')

  assert.equal(children?.[0].latestToolResult, '{"status":"success"}')
})

test('getContinuationTailMessage continues from the latest child rather than the original parent', () => {
  const tail = getContinuationTailMessage([
    assistant('parent', '原始回答'),
    assistant('child1', '第一次续写', { continuationParentId: 'parent' }),
    assistant('child2', '第二次续写', { continuationParentId: 'parent' }),
  ], 'parent')

  assert.equal(tail?.id, 'child2')
  assert.equal(tail?.content, '第二次续写')
})

test('collectContinuationThreadIds removes hidden prompts and children with deleted parent', () => {
  const ids = collectContinuationThreadIds([
    assistant('parent', '原始回答'),
    user('prompt1', '继续', { isContinuationPrompt: true, continuationParentId: 'parent' }),
    assistant('child1', '第一次续写', { continuationParentId: 'parent' }),
  ], 'parent')

  assert.deepEqual(ids, ['parent', 'prompt1', 'child1'])
})

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { renderConversationContextEvidence } from '../conversationContextConnection'

test('renderConversationContextEvidence wraps conversation memory as context evidence', () => {
  const rendered = renderConversationContextEvidence({
    evidencePrompt: '用户之前确认采用冷静克制的风格。',
    runtimeSegmentId: 'seg_1',
    loadLevel: 'standard',
    memoryHitCount: 2,
    degraded: false,
  })

  assert.match(rendered, /对话上下文只能作为历史证据/)
  assert.match(rendered, /\[Conversation Context Evidence Start\]/)
  assert.match(rendered, /runtimeSegmentId: seg_1/)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { compactConversationMemory, scoreConversationMemory } from '../memoryCompaction'

test('memory score favors anchors and penalizes conflicts', () => {
  const anchored = scoreConversationMemory({
    importanceScore: 0.8,
    recencyScore: 0.5,
    usageScore: 0.4,
    anchorBoost: 1,
    conflictPenalty: 0,
  })
  const conflicted = scoreConversationMemory({
    importanceScore: 0.8,
    recencyScore: 0.5,
    usageScore: 0.4,
    anchorBoost: 0,
    conflictPenalty: 1,
  })

  assert.ok(anchored > conflicted)
})

test('memory compaction keeps anchors and archives low-value facts', () => {
  const now = 10000
  const result = compactConversationMemory({
    activeRuntimeSegmentCount: 3,
    now,
    items: [
      {
        id: 'anchor_1',
        sessionId: 'sess_1',
        runtimeSegmentId: 'seg_1',
        kind: 'decision',
        layer: 'anchor',
        text: '关键决策',
        score: 0.95,
        recallReason: 'test',
        sourceMessageIds: ['u1'],
        createdAt: 1000,
        tokenCount: 10,
        updatedAt: 1000,
        indexDriver: 'local',
        idempotencyKey: 'a',
        syncStatus: 'synced',
        metadata: {},
      },
      {
        id: 'fact_1',
        sessionId: 'sess_1',
        runtimeSegmentId: 'seg_1',
        kind: 'fact',
        layer: 'turn',
        text: '低价值事实',
        score: 0.05,
        recallReason: 'test',
        sourceMessageIds: ['u2'],
        createdAt: 1000,
        tokenCount: 10,
        updatedAt: 1000,
        indexDriver: 'local',
        idempotencyKey: 'f',
        syncStatus: 'synced',
        metadata: { missedCount: 12 },
      },
    ],
  })

  assert.ok(result.active.some(item => item.id === 'anchor_1'))
  assert.ok(result.archived.some(item => item.id === 'fact_1'))
  assert.ok(result.maxActiveAnchors >= 30)
})

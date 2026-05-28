import assert from 'node:assert/strict'
import { test } from 'node:test'

import { shouldShowKnowledgeReferences } from '../messageEvidence'
import type { RecallKnowledgeHit } from '../vaultRecallTrace'

const hit: RecallKnowledgeHit = {
  id: 'wiki_1',
  path: 'wiki/产品/定位.md',
  title: '定位.md',
  source: 'wiki',
  reason: 'Wiki 命中 · title:定位',
  score: 12,
  snippet: '韭菜盒子是本地优先 AI 工作台。',
}

test('shouldShowKnowledgeReferences only shows citations for assistant messages with real hits', () => {
  assert.equal(shouldShowKnowledgeReferences('assistant', [hit]), true)
  assert.equal(shouldShowKnowledgeReferences('assistant', []), false)
  assert.equal(shouldShowKnowledgeReferences('assistant', undefined), false)
})

test('shouldShowKnowledgeReferences never shows citations on user system or tool messages', () => {
  assert.equal(shouldShowKnowledgeReferences('user', [hit]), false)
  assert.equal(shouldShowKnowledgeReferences('system', [hit]), false)
  assert.equal(shouldShowKnowledgeReferences('tool', [hit]), false)
})

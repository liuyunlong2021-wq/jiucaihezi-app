import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createEcommerceHistoryRecord,
  ecommerceHistoryRecordPath,
  listEcommerceHistory,
} from '../ecommerceHistory'

test('ecommerce runs use one project-local record path per run', () => {
  assert.equal(
    ecommerceHistoryRecordPath('run_123'),
    'jc-media/ecommerce/run_123/record.json',
  )
  assert.equal(createEcommerceHistoryRecord({
    runId: 'run_123',
    action: 'reverse-prompt',
    modelId: 'gpt-5.6-terra',
    status: 'success',
    output: '商品图中文提示词',
    thumbnail: 'data:image/png;base64,abc',
  }).action, 'reverse-prompt')
})

test('ecommerce history scans every project record without reading Chat', async () => {
  const records = Array.from({ length: 121 }, (_, index) => createEcommerceHistoryRecord({
    runId: `run_${index}`,
    action: 'reverse-prompt',
    modelId: 'gpt-5.6-terra',
    status: 'success',
    output: `提示词 ${index}`,
    createdAt: index,
  }))
  const history = await listEcommerceHistory({
    async list() {
      return records.map(record => ({
        runtime: 'web' as const,
        owner: 'project-a',
        path: ecommerceHistoryRecordPath(record.runId),
        name: 'record.json',
        isDirectory: false,
        kind: 'document' as const,
      }))
    },
    async readText(resource) {
      const runId = resource.path.split('/')[2]
      const record = records.find(item => item.runId === runId)!
      return { content: JSON.stringify(record), size: 1, truncated: false, revision: { value: runId, size: 1 } }
    },
  }, 'project-a')

  assert.equal(history.length, 121)
  assert.equal(history[0]?.runId, 'run_120')
})

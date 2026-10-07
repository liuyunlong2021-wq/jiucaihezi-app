import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareUpdateParticipants } from '../desktopUpdatePreparation'

test('a busy participant prevents every save and close', async () => {
  let saved = 0
  await assert.rejects(prepareUpdateParticipants([
    { busy: () => '', save: async () => { saved++ }, close: async () => {} },
    { busy: () => '另一窗口任务仍在运行', save: async () => { saved++ }, close: async () => {} },
  ], 'save'), /任务仍在运行/)
  assert.equal(saved, 0)
})

test('a failed save cannot advance to runtime shutdown', async () => {
  let closed = 0
  const participant = { busy: () => '', save: async () => { throw new Error('文件冲突') }, close: async () => { closed++ } }
  await assert.rejects(prepareUpdateParticipants([participant], 'save'), /文件冲突/)
  assert.equal(closed, 0)
})

test('tasks that become busy while saving must block installation', async () => {
  let busy = false
  await assert.rejects(prepareUpdateParticipants([
    { busy: () => busy ? '新增任务' : '', save: async () => { busy = true }, close: async () => {} },
  ], 'save'), /新增任务/)
})

test('all participants save before the separate close phase', async () => {
  const calls: string[] = []
  const participants = ['workbench', 'media'].map(name => ({
    busy: () => '', save: async () => { calls.push(`save:${name}`) }, close: async () => { calls.push(`close:${name}`) },
  }))
  await prepareUpdateParticipants(participants, 'save')
  assert.deepEqual(calls, ['save:workbench', 'save:media'])
  await prepareUpdateParticipants(participants, 'close')
  assert.deepEqual(calls, ['save:workbench', 'save:media', 'close:workbench', 'close:media'])
})

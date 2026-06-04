import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createToolJobRunner } from '../jobRunner'
import { createToolJobStore } from '../jobStore'

test('job runner returns a running result immediately and stores final result by session', async () => {
  const store = createToolJobStore({ now: () => 1000 })
  const runner = createToolJobRunner({ store, createId: () => 'job_1' })

  const started = runner.start({
    toolName: 'run_skill_tests',
    callId: 'call_1',
    sessionId: 'session_a',
    task: async ({ emit }) => {
      emit({ stage: 'testing', message: '正在运行测试', progress: 0.5 })
      return { status: 'ok', toolName: 'run_skill_tests', message: '{"status":"ok"}' }
    },
  })

  assert.equal(started.status, 'running')
  assert.equal(started.jobId, 'job_1')
  assert.equal(store.getJob('job_1')?.status, 'running')

  const final = await runner.waitForJob('job_1')
  assert.equal(final?.status, 'succeeded')
  assert.equal(final?.result?.status, 'ok')
  assert.deepEqual(store.listJobsBySession('session_a').map(job => job.id), ['job_1'])
  assert.ok(store.getEvents('job_1').some(event => event.stage === 'testing' && event.progress === 0.5))
})

test('job runner records failures without throwing out of band', async () => {
  const store = createToolJobStore({ now: () => 2000 })
  const runner = createToolJobRunner({ store, createId: () => 'job_failed' })

  runner.start({
    toolName: 'document_to_markdown',
    callId: 'call_failed',
    sessionId: 'session_a',
    task: async () => {
      throw new Error('转换失败')
    },
  })

  const final = await runner.waitForJob('job_failed')
  assert.equal(final?.status, 'failed')
  assert.equal(final?.errorMessage, '转换失败')
  assert.equal(final?.result?.status, 'error')
  assert.equal(final?.result?.errorCode, 'TOOL_JOB_FAILED')
})

test('job runner cancellation prevents a late result from overwriting cancelled state', async () => {
  const store = createToolJobStore({ now: () => 3000 })
  const runner = createToolJobRunner({ store, createId: () => 'job_cancelled' })
  let releaseTask!: () => void

  runner.start({
    toolName: 'skill_creator_open_eval_review',
    callId: 'call_cancelled',
    sessionId: 'session_b',
    task: async ({ signal }) => {
      await new Promise<void>(resolve => { releaseTask = resolve })
      if (signal.aborted) {
        return { status: 'error', toolName: 'skill_creator_open_eval_review', errorCode: 'ABORTED' }
      }
      return { status: 'ok', toolName: 'skill_creator_open_eval_review' }
    },
  })

  await Promise.resolve()
  const cancelled = runner.cancelJob('job_cancelled', '用户停止生成')
  assert.equal(cancelled, true)
  releaseTask()

  const final = await runner.waitForJob('job_cancelled')
  assert.equal(final?.status, 'cancelled')
  assert.equal(final?.errorMessage, '用户停止生成')
  assert.equal(final?.result?.status, 'error')
  assert.equal(final?.result?.errorCode, 'TOOL_JOB_CANCELLED')
})

import { createToolJobStore, toolJobStore, type ToolJob, type ToolJobEvent, type ToolJobStore } from './jobStore'
import type { ToolExecutionResult } from './types'

export interface ToolJobRunnerContext {
  jobId: string
  signal: AbortSignal
  emit: (event: Omit<ToolJobEvent, 'jobId' | 'at'> & { at?: number }) => void
}

export interface StartToolJobInput {
  toolName: string
  callId?: string
  sessionId?: string
  task: (context: ToolJobRunnerContext) => Promise<ToolExecutionResult | string | Record<string, unknown>> | ToolExecutionResult | string | Record<string, unknown>
}

export interface CreateToolJobRunnerOptions {
  store?: ToolJobStore
  createId?: () => string
}

export interface ToolJobRunner {
  start(input: StartToolJobInput): ToolExecutionResult
  cancelJob(jobId: string, reason?: string): boolean
  waitForJob(jobId: string): Promise<ToolJob | null>
}

interface RunningJob {
  controller: AbortController
  promise: Promise<ToolJob | null>
}

export function createToolJobRunner(options: CreateToolJobRunnerOptions = {}): ToolJobRunner {
  const store = options.store || createToolJobStore()
  const createId = options.createId || defaultJobId
  const running = new Map<string, RunningJob>()

  function normalizeResult(toolName: string, callId: string | undefined, value: ToolExecutionResult | string | Record<string, unknown>): ToolExecutionResult {
    if (typeof value === 'string') {
      return { status: 'ok', toolName, callId, message: value }
    }
    if (isToolExecutionResult(value)) {
      return { ...value, toolName: value.toolName || toolName, callId: value.callId || callId }
    }
    return { status: 'ok', toolName, callId, data: value }
  }

  function makeCancelledResult(toolName: string, callId: string | undefined): ToolExecutionResult {
    return {
      status: 'error',
      toolName,
      callId,
      errorCode: 'TOOL_JOB_CANCELLED',
      errorMessage: '工具任务已取消。',
    }
  }

  function makeFailedResult(toolName: string, callId: string | undefined, message: string): ToolExecutionResult {
    return {
      status: 'error',
      toolName,
      callId,
      errorCode: 'TOOL_JOB_FAILED',
      errorMessage: message,
    }
  }

  return {
    start(input) {
      const jobId = createId()
      const controller = new AbortController()
      const job = store.createJob({
        id: jobId,
        toolName: input.toolName,
        callId: input.callId,
        sessionId: input.sessionId,
      })
      store.markRunning(job.id)
      store.addEvent(job.id, { stage: 'running', message: `开始执行 ${input.toolName}` })

      const promise = Promise.resolve()
        .then(async () => {
          const rawResult = await input.task({
            jobId: job.id,
            signal: controller.signal,
            emit: event => { store.addEvent(job.id, event) },
          })
          const current = store.getJob(job.id)
          if (current?.status === 'cancelled') return current
          const result = normalizeResult(input.toolName, input.callId, rawResult)
          return store.markSucceeded(job.id, result)
        })
        .catch((error) => {
          const current = store.getJob(job.id)
          if (current?.status === 'cancelled') return current
          const message = error instanceof Error ? error.message : String(error)
          return store.markFailed(job.id, message, makeFailedResult(input.toolName, input.callId, message))
        })
        .finally(() => {
          running.delete(job.id)
        })

      running.set(job.id, { controller, promise })

      return {
        status: 'running',
        toolName: input.toolName,
        callId: input.callId,
        jobId: job.id,
        data: {
          jobId: job.id,
          sessionId: input.sessionId,
          status: 'running',
        },
      }
    },
    cancelJob(jobId, reason = '工具任务已取消。') {
      const job = store.getJob(jobId)
      if (!job || job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') return false
      const runningJob = running.get(jobId)
      runningJob?.controller.abort()
      store.addEvent(jobId, { stage: 'cancelled', message: reason })
      store.markCancelled(jobId, reason, makeCancelledResult(job.toolName, job.callId))
      return true
    },
    async waitForJob(jobId) {
      const runningJob = running.get(jobId)
      if (runningJob) return await runningJob.promise
      return store.getJob(jobId)
    },
  }
}

function isToolExecutionResult(value: unknown): value is ToolExecutionResult {
  if (!value || typeof value !== 'object') return false
  const record = value as ToolExecutionResult
  return record.status === 'ok' || record.status === 'error' || record.status === 'running'
}

function defaultJobId(): string {
  return `tool_job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export const toolJobRunner = createToolJobRunner({ store: toolJobStore })

import type { ToolExecutionResult } from './types'

export type ToolJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface ToolJobEvent {
  jobId: string
  at: number
  stage: string
  message: string
  progress?: number
}

export interface ToolJob {
  id: string
  toolName: string
  callId?: string
  sessionId?: string
  status: ToolJobStatus
  createdAt: number
  updatedAt: number
  startedAt?: number
  finishedAt?: number
  result?: ToolExecutionResult
  errorMessage?: string
}

export interface CreateToolJobStoreOptions {
  now?: () => number
}

export interface CreateToolJobInput {
  id: string
  toolName: string
  callId?: string
  sessionId?: string
}

export interface ToolJobStore {
  createJob(input: CreateToolJobInput): ToolJob
  markRunning(jobId: string): ToolJob | null
  markSucceeded(jobId: string, result: ToolExecutionResult): ToolJob | null
  markFailed(jobId: string, errorMessage: string, result?: ToolExecutionResult): ToolJob | null
  markCancelled(jobId: string, reason: string, result?: ToolExecutionResult): ToolJob | null
  addEvent(jobId: string, event: Omit<ToolJobEvent, 'jobId' | 'at'> & { at?: number }): ToolJobEvent | null
  getJob(jobId: string): ToolJob | null
  getEvents(jobId: string): ToolJobEvent[]
  listJobsBySession(sessionId: string): ToolJob[]
}

export function createToolJobStore(options: CreateToolJobStoreOptions = {}): ToolJobStore {
  const now = options.now || Date.now
  const jobs = new Map<string, ToolJob>()
  const events = new Map<string, ToolJobEvent[]>()

  function cloneJob(job: ToolJob): ToolJob {
    return {
      ...job,
      result: job.result ? { ...job.result } : undefined,
    }
  }

  function updateJob(jobId: string, updater: (job: ToolJob, at: number) => void): ToolJob | null {
    const job = jobs.get(jobId)
    if (!job) return null
    const at = now()
    updater(job, at)
    job.updatedAt = at
    jobs.set(jobId, job)
    return cloneJob(job)
  }

  return {
    createJob(input) {
      const at = now()
      const job: ToolJob = {
        id: input.id,
        toolName: input.toolName,
        callId: input.callId,
        sessionId: input.sessionId,
        status: 'queued',
        createdAt: at,
        updatedAt: at,
      }
      jobs.set(job.id, job)
      events.set(job.id, [])
      return cloneJob(job)
    },
    markRunning(jobId) {
      return updateJob(jobId, (job, at) => {
        if (job.status === 'cancelled') return
        job.status = 'running'
        job.startedAt = job.startedAt || at
      })
    },
    markSucceeded(jobId, result) {
      return updateJob(jobId, (job, at) => {
        if (job.status === 'cancelled') return
        job.status = 'succeeded'
        job.finishedAt = at
        job.result = result
        job.errorMessage = undefined
      })
    },
    markFailed(jobId, errorMessage, result) {
      return updateJob(jobId, (job, at) => {
        if (job.status === 'cancelled') return
        job.status = 'failed'
        job.finishedAt = at
        job.errorMessage = errorMessage
        job.result = result
      })
    },
    markCancelled(jobId, reason, result) {
      return updateJob(jobId, (job, at) => {
        job.status = 'cancelled'
        job.finishedAt = at
        job.errorMessage = reason
        job.result = result
      })
    },
    addEvent(jobId, event) {
      if (!jobs.has(jobId)) return null
      const saved: ToolJobEvent = {
        jobId,
        at: event.at ?? now(),
        stage: event.stage,
        message: event.message,
        progress: typeof event.progress === 'number' ? event.progress : undefined,
      }
      const list = events.get(jobId) || []
      list.push(saved)
      events.set(jobId, list)
      return { ...saved }
    },
    getJob(jobId) {
      const job = jobs.get(jobId)
      return job ? cloneJob(job) : null
    },
    getEvents(jobId) {
      return (events.get(jobId) || []).map(event => ({ ...event }))
    },
    listJobsBySession(sessionId) {
      return Array.from(jobs.values())
        .filter(job => job.sessionId === sessionId)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(cloneJob)
    },
  }
}

export const toolJobStore = createToolJobStore()

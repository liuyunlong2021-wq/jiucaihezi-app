import { RemoteProtocolError } from './desktopRemoteProtocol'

export type DesktopRemoteContext = {
  projectName: string
  conversationTitle: string
  conversationId: string
  sessionId: string
}

export type DesktopRemoteEvent = {
  sessionId: string
  seq: number
  type: string
  payload: unknown
}

export type DesktopRemoteProject = { projectId: string; name: string; current: boolean }
export type DesktopRemoteSessionSummary = {
  sessionId: string
  title: string
  updatedAt: string
  current: boolean
  running: boolean
  /** 创作模式：manju / short-drama / novel / none。 */
  mode: string
}

type DesktopRemoteHostDependencies = {
  getContext: () => DesktopRemoteContext
  /** 电脑当前对话之外、手机可以操作的对话（M2）。缺省即只认当前对话。 */
  hasSession?: (sessionId: string) => boolean
  listProjects?: () => Promise<DesktopRemoteProject[]>
  listSessions?: (projectId: string) => Promise<DesktopRemoteSessionSummary[]>
  createSession?: (projectId: string) => Promise<DesktopRemoteContext>
  setMode?: (sessionId: string, mode: string) => Promise<{ mode: string }>
  /** 手机看成果：只读成果目录（见 desktopRemoteFiles）。 */
  listFiles?: (projectId: string, path: string) => Promise<unknown[]>
  readFile?: (projectId: string, path: string, offset: number) => Promise<unknown>
  readSession: (sessionId: string) => Promise<unknown>
  sendMessage: (text: string, sessionId: string) => Promise<{ runId: string } | void>
  stopRun: (sessionId: string) => Promise<string>
  respondApproval: (approvalId: string, decision: 'approve' | 'reject' | 'always', sessionId: string) => Promise<void>
  subscribe: (listener: (event: DesktopRemoteEvent) => void) => () => void
  isBusy?: (sessionId: string) => boolean
}

export class DesktopRemoteHost {
  private readonly sending = new Set<string>()

  constructor(private readonly dependencies: DesktopRemoteHostDependencies) {}

  context(): DesktopRemoteContext {
    const value = this.dependencies.getContext()
    return {
      projectName: value.projectName,
      conversationTitle: value.conversationTitle,
      conversationId: value.conversationId,
      sessionId: value.sessionId,
    }
  }

  async listProjects() {
    return await this.dependencies.listProjects?.() ?? []
  }

  async listSessions(projectId: string) {
    if (!this.dependencies.listSessions) throw new RemoteProtocolError('PROJECT_NOT_FOUND')
    return await this.dependencies.listSessions(projectId)
  }

  async createSession(projectId: string) {
    if (!this.dependencies.createSession) throw new RemoteProtocolError('PROJECT_NOT_FOUND')
    return await this.dependencies.createSession(projectId)
  }

  async listFiles(projectId: string, path: string) {
    if (!this.dependencies.listFiles) throw new RemoteProtocolError('PROJECT_NOT_FOUND')
    return await this.dependencies.listFiles(projectId, path)
  }

  async readFile(projectId: string, path: string, offset: number) {
    if (!this.dependencies.readFile) throw new RemoteProtocolError('PROJECT_NOT_FOUND')
    return await this.dependencies.readFile(projectId, path, offset)
  }

  async setMode(sessionId: string, mode: string) {
    this.assertKnownSession(sessionId)
    if (!this.dependencies.setMode) throw new RemoteProtocolError('MODE_INVALID')
    return await this.dependencies.setMode(sessionId, mode)
  }

  async readSession(sessionId: string) {
    this.assertKnownSession(sessionId)
    return await this.dependencies.readSession(sessionId)
  }

  subscribeSession(sessionId: string, emit: (event: DesktopRemoteEvent) => void) {
    this.assertKnownSession(sessionId)
    return this.dependencies.subscribe(event => {
      if (event.sessionId === sessionId) emit(event)
    })
  }

  async sendMessage(sessionId: string, text: string) {
    this.assertKnownSession(sessionId)
    if (!text.trim()) throw new RemoteProtocolError('MESSAGE_EMPTY')
    if (this.sending.has(sessionId) || this.dependencies.isBusy?.(sessionId)) throw new RemoteProtocolError('SESSION_BUSY')
    this.sending.add(sessionId)
    try {
      const receipt = await this.dependencies.sendMessage(text, sessionId)
      if (!receipt?.runId) throw new RemoteProtocolError('RUN_NOT_STARTED')
      return receipt
    } finally {
      this.sending.delete(sessionId)
    }
  }

  async stopRun(sessionId: string) {
    this.assertKnownSession(sessionId)
    return await this.dependencies.stopRun(sessionId)
  }

  async respondApproval(
    sessionId: string,
    approvalId: string,
    decision: 'approve' | 'reject' | 'always',
  ) {
    this.assertKnownSession(sessionId)
    if (!approvalId) throw new RemoteProtocolError('APPROVAL_NOT_FOUND')
    await this.dependencies.respondApproval(approvalId, decision, sessionId)
  }

  assertKnownSession(sessionId: string) {
    if (sessionId && (sessionId === this.context().sessionId || this.dependencies.hasSession?.(sessionId))) return
    throw new RemoteProtocolError('SESSION_NOT_FOUND')
  }
}

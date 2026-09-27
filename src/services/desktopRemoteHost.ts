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

type DesktopRemoteHostDependencies = {
  getContext: () => DesktopRemoteContext
  readSession: (sessionId: string) => Promise<unknown>
  sendMessage: (text: string) => Promise<void>
  stopRun: () => Promise<string>
  respondApproval: (approvalId: string, decision: 'approve' | 'reject' | 'always') => Promise<void>
  subscribe: (listener: (event: DesktopRemoteEvent) => void) => () => void
  isBusy?: () => boolean
}

export class DesktopRemoteHost {
  private sending = false

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

  async readSession(sessionId: string) {
    this.assertCurrentSession(sessionId)
    return await this.dependencies.readSession(sessionId)
  }

  subscribeSession(sessionId: string, emit: (event: DesktopRemoteEvent) => void) {
    this.assertCurrentSession(sessionId)
    return this.dependencies.subscribe(event => {
      if (event.sessionId === this.context().sessionId && event.sessionId === sessionId) emit(event)
    })
  }

  async sendMessage(sessionId: string, text: string) {
    this.assertCurrentSession(sessionId)
    if (!text.trim()) throw new RemoteProtocolError('MESSAGE_EMPTY')
    if (this.sending || this.dependencies.isBusy?.()) throw new RemoteProtocolError('SESSION_BUSY')
    this.sending = true
    try {
      await this.dependencies.sendMessage(text)
    } finally {
      this.sending = false
    }
  }

  async stopRun(sessionId: string) {
    this.assertCurrentSession(sessionId)
    return await this.dependencies.stopRun()
  }

  async respondApproval(
    sessionId: string,
    approvalId: string,
    decision: 'approve' | 'reject' | 'always',
  ) {
    this.assertCurrentSession(sessionId)
    if (!approvalId) throw new RemoteProtocolError('APPROVAL_NOT_FOUND')
    await this.dependencies.respondApproval(approvalId, decision)
  }

  private assertCurrentSession(sessionId: string) {
    if (sessionId !== this.context().sessionId) throw new RemoteProtocolError('SESSION_NOT_CURRENT')
  }
}

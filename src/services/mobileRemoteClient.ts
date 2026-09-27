import { RemoteProtocolError } from './desktopRemoteProtocol'

export type MobileRemoteContext = {
  projectName: string
  conversationTitle: string
  conversationId: string
  sessionId: string
}

export type MobileRemoteTurn = {
  id: string
  role: string
  content: string
  createdAt?: number
}

export type MobileRemoteStep = {
  id: string
  label: string
  state: string
  durationMs?: number
  errorReason?: string
}

export type MobileRemoteRun = {
  state: string
  status?: string
  steps: MobileRemoteStep[]
  approval: { id: string; message: string } | null
}

export type MobileRemoteState = 'idle' | 'connecting' | 'connected' | 'offline'

export type MobileRemoteView = {
  state: MobileRemoteState
  context: MobileRemoteContext | null
  turns: MobileRemoteTurn[]
  streamingText: string
  run: MobileRemoteRun
  lastSeq: number
}

export type MobileRemoteApprovalDecision = 'approve' | 'reject' | 'always'

/**
 * 控制器只经此接口与 Desktop 说话。真实实现是 Rust 侧 Noise 加密连接；
 * 测试用内存假桥，两边共用同一份协议逻辑。
 */
export type MobileRemoteTransport = {
  request(input: { type: string; payload: Record<string, unknown> }): Promise<unknown>
  subscribe(listener: (message: unknown) => void): () => void
}

const IDLE_RUN: MobileRemoteRun = { state: 'idle', steps: [], approval: null }

/**
 * 从各层抛出的东西里取出错误码。
 * Tauri 会把 Rust 的 `Err(String)` 原样抛成字符串，协议层抛 RemoteProtocolError（带 code）。
 */
function errorCode(cause: unknown): string {
  if (typeof cause === 'string') return cause
  if (cause && typeof cause === 'object') {
    const record = cause as { code?: unknown; message?: unknown }
    if (typeof record.code === 'string') return record.code
    if (typeof record.message === 'string') return record.message
  }
  return ''
}

/**
 * 只渲染 Desktop 公开投影的控制器客户端。
 * 不持有第二份会话、不调用 Provider、不自行发起 Runtime（合同 §3.2、§12）。
 */
export class MobileRemoteClient {
  private state: MobileRemoteState = 'idle'
  private context: MobileRemoteContext | null = null
  private contextRetry: ReturnType<typeof setInterval> | undefined
  private turns: MobileRemoteTurn[] = []
  private streamingText = ''
  private run: MobileRemoteRun = IDLE_RUN
  private lastSeq = 0
  private unsubscribe: (() => void) | undefined
  private readonly listeners = new Set<(view: MobileRemoteView) => void>()

  constructor(
    private readonly transport: MobileRemoteTransport,
    /** 电脑没活动对话时的重试间隔；测试里调小。 */
    private readonly options: { contextRetryMs?: number } = {},
  ) {}

  get view(): MobileRemoteView {
    return {
      state: this.state,
      context: this.context,
      turns: this.turns,
      streamingText: this.streamingText,
      run: this.run,
      lastSeq: this.lastSeq,
    }
  }

  onChange(listener: (view: MobileRemoteView) => void) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** 合同 §10.4：初次连接与重连都走 context.get → session.read → session.subscribe。 */
  async connect() {
    this.state = 'connecting'
    this.notify()
    this.unsubscribe ??= this.transport.subscribe(message => this.handle(message))
    try {
      await this.enterWith(parseContext(await this.transport.request({ type: 'context.get', payload: {} })))
      return
    } catch (error) {
      // 电脑上还没打开对话时不能就此离线：离线状态下 handle() 会忽略一切事件。
      // 也不能只等 context.changed（它只在“变化”时发，顺序不对就永远等不到），
      // 所以定时重试 context.get，电脑一有对话就进去（2026-09-27 真机）。
      if (errorCode(error).startsWith('INVALID_CONTEXT')) {
        this.state = 'connecting'
        this.watchForContext()
        this.notify()
      } else {
        this.state = 'offline'
        this.notify()
      }
      throw error
    }
  }

  private async enterWith(context: MobileRemoteContext) {
    this.stopContextWatch()
    this.adoptContext(context)
    await this.readCurrentSession()
    this.state = 'connected'
    this.notify()
  }

  /** 电脑上还没有活动对话时定时重试，直到电脑上打开一个。 */
  private watchForContext() {
    if (this.contextRetry) return
    const interval = this.options.contextRetryMs ?? 2000
    this.contextRetry = setInterval(() => {
      if (this.state !== 'connecting') {
        this.stopContextWatch()
        return
      }
      void this.transport
        .request({ type: 'context.get', payload: {} })
        .then(value => this.enterWith(parseContext(value)))
        .catch(() => undefined)
    }, interval)
  }

  private stopContextWatch() {
    if (!this.contextRetry) return
    clearInterval(this.contextRetry)
    this.contextRetry = undefined
  }

  disconnect() {
    this.stopContextWatch()
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.state = 'offline'
    this.notify()
  }

  /**
   * 通道被对端或系统断开时由传输层通知（合同 §10.7）：只置离线，
   * 不猜测任务是成功还是失败，也不清掉屏幕上已有的投影。
   */
  handleTransportClosed() {
    this.stopContextWatch()
    if (this.state === 'offline') return
    this.state = 'offline'
    this.notify()
  }

  /** 合同 §11：副作用命令在未取得回执时不得自动重发，由用户决定。 */
  async sendMessage(text: string) {
    if (!text.trim()) throw new RemoteProtocolError('MESSAGE_EMPTY')
    await this.transport.request({ type: 'message.send', payload: { ...this.requireConnected(), text } })
  }

  /** 合同 §11：停下幂等，已结束的运行重复停止不算错误。 */
  async stopRun() {
    await this.transport.request({ type: 'run.stop', payload: this.requireConnected() })
  }

  /** 合同 §11：只接受当前待审批项的精确 ID。 */
  async respondApproval(approvalId: string, decision: MobileRemoteApprovalDecision) {
    if (!approvalId) throw new RemoteProtocolError('APPROVAL_NOT_FOUND')
    if (decision !== 'approve' && decision !== 'reject' && decision !== 'always')
      throw new RemoteProtocolError('APPROVAL_DECISION_INVALID')
    await this.transport.request({
      type: 'approval.respond',
      payload: { ...this.requireConnected(), approvalId, decision },
    })
  }

  private requireConnected() {
    if (this.state !== 'connected' || !this.context) throw new RemoteProtocolError('REMOTE_NOT_CONNECTED')
    return { sessionId: this.context.sessionId }
  }

  private async readCurrentSession() {
    const sessionId = this.context?.sessionId
    const snapshot = await this.transport.request({ type: 'session.read', payload: { sessionId } })
    this.turns = Array.isArray((snapshot as { turns?: unknown })?.turns)
      ? (snapshot as { turns: MobileRemoteTurn[] }).turns
      : []
    await this.transport.request({ type: 'session.subscribe', payload: { sessionId } })
    this.notify()
  }

  private adoptContext(context: MobileRemoteContext) {
    this.context = context
    // 换对话即丢弃旧投影，历史只从官方 session.read 回来（合同 §10.2、§10.6）。
    this.turns = []
    this.streamingText = ''
    this.run = IDLE_RUN
    this.lastSeq = 0
  }

  private handle(message: unknown) {
    if (this.state !== 'connected' && this.state !== 'connecting') return
    const envelope = message as { type?: unknown; payload?: unknown } | null
    if (!envelope || typeof envelope !== 'object') return

    if (envelope.type === 'context.changed') {
      this.handleContextChange(envelope.payload as MobileRemoteContext)
      return
    }
    if (envelope.type !== 'session.event') return

    const event = envelope.payload as Partial<{ sessionId: string; seq: number }> & Partial<MobileRemoteView>
    if (!this.context || event.sessionId !== this.context.sessionId) return
    if (typeof event.seq !== 'number' || !Number.isFinite(event.seq) || event.seq <= this.lastSeq) return

    this.lastSeq = event.seq
    if (Array.isArray(event.turns)) this.turns = event.turns
    this.streamingText = typeof event.streamingText === 'string' ? event.streamingText : ''
    this.run = event.run && typeof event.run === 'object' ? event.run : IDLE_RUN
    this.notify()
  }

  private handleContextChange(next: MobileRemoteContext) {
    if (this.context?.sessionId === next?.sessionId) return
    this.state = 'connecting'
    this.notify()
    // ponytail: 物理连接复用，Desktop 在收到新 session.subscribe 时重绑订阅；不另开第二条连接。
    void this.enterWith(next).catch(() => {
      this.state = 'offline'
      this.notify()
    })
  }

  private notify() {
    const view = this.view
    for (const listener of this.listeners) listener(view)
  }
}

function parseContext(value: unknown): MobileRemoteContext {
  const context = value as Partial<MobileRemoteContext> | null
  if (!context || typeof context !== 'object' || typeof context.sessionId !== 'string' || !context.sessionId)
    // 把电脑的原始返回带出来：这个错只可能是两端对不上，光看错误码查不出来（2026-09-27）。
    throw new RemoteProtocolError(`INVALID_CONTEXT 电脑返回：${safeJson(value)}`)
  return {
    projectName: String(context.projectName ?? ''),
    conversationTitle: String(context.conversationTitle ?? ''),
    conversationId: String(context.conversationId ?? ''),
    sessionId: context.sessionId,
  }
}

function safeJson(value: unknown): string {
  try {
    const text = JSON.stringify(value)
    return text === undefined ? String(value) : text.slice(0, 200)
  } catch {
    return String(value).slice(0, 200)
  }
}

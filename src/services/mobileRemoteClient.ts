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
  runId?: string
  state: string
  status?: string
  error?: string
  steps: MobileRemoteStep[]
  approval: { id: string; message: string } | null
}

export type MobileRemoteState = 'idle' | 'connecting' | 'connected' | 'offline'

export type MobilePendingMessage = {
  commandId: string
  content: string
  state: 'sending' | 'accepted' | 'unconfirmed' | 'failed'
  runId?: string
  existingTurnIds: string[]
}

export type MobileRemoteView = {
  state: MobileRemoteState
  context: MobileRemoteContext | null
  turns: MobileRemoteTurn[]
  pendingTurn: MobileRemoteTurn | null
  streamingText: string
  run: MobileRemoteRun
  lastSeq: number
  pendingMessages: MobilePendingMessage[]
}

export type MobileRemoteApprovalDecision = 'approve' | 'reject' | 'always'

/**
 * 控制器只经此接口与 Desktop 说话。真实实现是 Rust 侧 Noise 加密连接；
 * 测试用内存假桥，两边共用同一份协议逻辑。
 */
export type MobileRemoteTransport = {
  request(input: { type: string; payload: Record<string, unknown> }): Promise<unknown>
  subscribe(listener: (message: unknown) => void): (() => void) | Promise<() => void>
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
  private refreshTimer: ReturnType<typeof setTimeout> | undefined
  private turns: MobileRemoteTurn[] = []
  private pendingTurn: MobileRemoteTurn | null = null
  private streamingText = ''
  private run: MobileRemoteRun = IDLE_RUN
  private lastSeq = 0
  private gatewayEpoch = ''
  private recovery: Promise<void> | undefined
  private snapshotReads = 0
  private snapshotVersion = 0
  private bufferedEvents: unknown[] = []
  private pendingMessages: MobilePendingMessage[] = []
  private unsubscribe: (() => void) | undefined
  private listenerReady: Promise<void> | undefined
  private readonly listeners = new Set<(view: MobileRemoteView) => void>()

  constructor(
    private readonly transport: MobileRemoteTransport,
    /** 电脑没活动对话时的重试间隔；测试里调小。 */
    private readonly options: { contextRetryMs?: number; refreshMs?: number } = {},
  ) {}

  get view(): MobileRemoteView {
    return {
      state: this.state,
      context: this.context,
      turns: this.turns,
      pendingTurn: this.pendingTurn,
      streamingText: this.streamingText,
      run: this.run,
      lastSeq: this.lastSeq,
      pendingMessages: this.pendingMessages,
    }
  }

  onChange(listener: (view: MobileRemoteView) => void) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** 初次连接与重连都走 context.get → session.attach，封住读完尚未订阅的空窗。 */
  async connect() {
    this.state = 'connecting'
    this.notify()
    try {
      if (!this.unsubscribe) {
        this.listenerReady ??= (async () => {
          const stop = await this.transport.subscribe(message => this.handle(message))
          if (this.state === 'offline') stop()
          else this.unsubscribe = stop
        })().finally(() => { this.listenerReady = undefined })
        await this.listenerReady
      }
      if (this.view.state === 'offline') throw new RemoteProtocolError('REMOTE_NOT_CONNECTED')
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
    if (this.context?.sessionId !== context.sessionId || this.state === 'offline') return
    this.state = 'connected'
    this.notify()
    this.scheduleRefresh()
  }

  private async refreshContext() {
    const sessionId = this.context?.sessionId
    let next: MobileRemoteContext
    try {
      next = parseContext(await this.transport.request({ type: 'context.get', payload: {} }))
    } catch (cause) {
      if (!errorCode(cause).startsWith('INVALID_CONTEXT') || this.state !== 'connected') throw cause
      this.waitForContext()
      return true
    }
    if (this.state !== 'connected' || this.context?.sessionId !== sessionId) return true
    if (next.sessionId === sessionId) return false
    await this.enterWith(next)
    return true
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

  private waitForContext() {
    this.stopRefresh()
    this.snapshotVersion += 1
    this.bufferedEvents = []
    this.context = null
    this.turns = []
    this.pendingTurn = null
    this.streamingText = ''
    this.run = IDLE_RUN
    this.lastSeq = 0
    this.gatewayEpoch = ''
    this.state = 'connecting'
    this.watchForContext()
    this.notify()
  }

  disconnect() {
    this.stopContextWatch()
    this.stopRefresh()
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.snapshotVersion += 1
    this.bufferedEvents = []
    this.state = 'offline'
    this.notify()
  }

  async refresh() {
    if (this.state !== 'connected') throw new RemoteProtocolError('REMOTE_NOT_CONNECTED')
    if (!await this.refreshContext()) await this.readCurrentSession(true)
  }

  /**
   * 通道被对端或系统断开时由传输层通知（合同 §10.7）：只置离线，
   * 不猜测任务是成功还是失败，也不清掉屏幕上已有的投影。
   */
  handleTransportClosed() {
    this.stopContextWatch()
    this.stopRefresh()
    this.snapshotVersion += 1
    this.bufferedEvents = []
    if (this.state === 'offline') return
    this.state = 'offline'
    this.notify()
  }

  /** 合同 §11：副作用命令在未取得回执时不得自动重发，由用户决定。 */
  async sendMessage(text: string) {
    if (!text.trim()) throw new RemoteProtocolError('MESSAGE_EMPTY')
    const session = this.requireConnected()
    const commandId = crypto.randomUUID()
    this.pendingMessages = [...this.pendingMessages, {
      commandId, content: text, state: 'sending',
      existingTurnIds: this.turns.filter(turn => turn.role === 'user').map(turn => turn.id),
    }]
    this.notify()
    try {
      const receipt = await this.transport.request({
        type: 'message.send', payload: { ...session, text, commandId },
      }) as { accepted?: boolean; runId?: string }
      if (receipt?.accepted !== true || !receipt.runId) throw new RemoteProtocolError('RUN_NOT_STARTED')
      this.updatePending(commandId, { state: 'accepted', runId: receipt.runId })
      this.reconcilePending()
      this.scheduleRefresh()
    } catch (cause) {
      this.updatePending(commandId, { state: errorCode(cause) === 'REMOTE_CONNECTION_CLOSED' ? 'unconfirmed' : 'failed' })
      throw cause
    }
  }

  private updatePending(commandId: string, patch: Partial<MobilePendingMessage>) {
    this.pendingMessages = this.pendingMessages.map(message =>
      message.commandId === commandId ? { ...message, ...patch } : message)
    this.notify()
  }

  private reconcilePending(officialHistory = false) {
    this.pendingMessages = this.pendingMessages.map(message =>
      message.state === 'accepted' && message.runId === this.run.runId
        && (this.run.state === 'failed' || this.run.state === 'stopped')
        ? { ...message, state: 'failed' as const } : message)
    const next = this.pendingMessages.filter(message =>
      !(officialHistory && (message.state === 'accepted' || message.state === 'unconfirmed')
        && this.turns.some(turn => turn.role === 'user'
          && turn.content === message.content
          && !message.existingTurnIds.includes(turn.id))))
    if (next.length !== this.pendingMessages.length) {
      this.pendingMessages = next
      this.notify()
    }
  }

  private scheduleRefresh() {
    if (this.refreshTimer || this.state !== 'connected') return
    const active = this.pendingMessages.some(message => message.state === 'accepted' || message.state === 'unconfirmed')
      || this.run.state === 'running'
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined
      void this.readCurrentSession(false).catch(async cause => {
        if (errorCode(cause) === 'SESSION_NOT_CURRENT' && this.state === 'connected') {
          try { await this.refreshContext() } catch { /* 下一次补读继续尝试。 */ }
        }
      }).finally(() => this.scheduleRefresh())
    // ponytail: G1 空闲低频补读兜住丢推送；G2 用版本心跳替代固定读取。
    }, this.options.refreshMs ?? (active ? 3000 : 10000))
    ;(this.refreshTimer as { unref?: () => void }).unref?.()
  }

  private stopRefresh() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = undefined
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

  private async readCurrentSession(attach = true) {
    const sessionId = this.context?.sessionId
    const version = ++this.snapshotVersion
    this.snapshotReads += 1
    try {
      const response = await this.transport.request({
        type: attach ? 'session.attach' : 'session.read', payload: { sessionId },
      })
      if (version !== this.snapshotVersion || sessionId !== this.context?.sessionId || this.state === 'offline') return
      const attachment = response as Partial<{ gatewayEpoch: string; seq: number; snapshot: unknown }>
      const snapshot = attach ? attachment.snapshot : response
      const cursor = (attach ? attachment : snapshot) as Partial<{ gatewayEpoch: string; seq: number }>
      if (cursor?.gatewayEpoch === this.gatewayEpoch && typeof cursor.seq === 'number'
        && Number.isSafeInteger(cursor.seq) && cursor.seq < this.lastSeq) return
      if (typeof cursor?.gatewayEpoch === 'string') {
        if (this.gatewayEpoch !== cursor.gatewayEpoch) this.lastSeq = 0
        this.gatewayEpoch = cursor.gatewayEpoch
      }
      if (typeof cursor?.seq === 'number' && Number.isSafeInteger(cursor.seq) && cursor.seq >= 0)
        this.lastSeq = cursor.seq
      // attach 的外层 seq 是读前基线；快照若已包含读中事件，以快照自己的游标为准。
      const projected = snapshot as Partial<{ gatewayEpoch: string; seq: number }>
      if (attach && projected?.gatewayEpoch === this.gatewayEpoch
        && typeof projected.seq === 'number' && Number.isSafeInteger(projected.seq) && projected.seq > this.lastSeq)
        this.lastSeq = projected.seq
      this.turns = Array.isArray((snapshot as { turns?: unknown })?.turns)
        ? (snapshot as { turns: MobileRemoteTurn[] }).turns
        : []
      this.pendingTurn = parsePendingTurn((snapshot as { pendingTurn?: unknown })?.pendingTurn)
      const live = snapshot as Partial<{ streamingText: string; run: MobileRemoteRun }>
      this.streamingText = typeof live?.streamingText === 'string' ? live.streamingText : ''
      this.run = live?.run && typeof live.run === 'object' ? live.run : IDLE_RUN
      this.reconcilePending(true)
      this.notify()
    } finally {
      this.snapshotReads -= 1
      if (this.snapshotReads === 0) {
        const events = this.bufferedEvents.splice(0)
        for (const event of events) this.handle(event)
      }
    }
  }

  private adoptContext(context: MobileRemoteContext) {
    const switched = this.context?.sessionId !== context.sessionId
    this.context = context
    // 换对话即丢弃旧投影，历史只从官方 session.read 回来（合同 §10.2、§10.6）。
    this.turns = []
    this.pendingTurn = null
    this.streamingText = ''
    this.run = IDLE_RUN
    this.lastSeq = 0
    if (switched) this.gatewayEpoch = ''
    if (switched) this.pendingMessages = []
  }

  private handle(message: unknown) {
    if (this.state !== 'connected' && this.state !== 'connecting') return
    if (this.snapshotReads > 0) {
      this.bufferedEvents.push(message)
      return
    }
    const envelope = message as { type?: unknown; payload?: unknown } | null
    if (!envelope || typeof envelope !== 'object') return

    if (envelope.type === 'context.changed') {
      this.handleContextChange(envelope.payload as MobileRemoteContext)
      return
    }
    if (envelope.type !== 'session.event') return

    const event = envelope.payload as Partial<{ sessionId: string; seq: number; gatewayEpoch: string }> & Partial<MobileRemoteView>
    if (!this.context || event.sessionId !== this.context.sessionId) return
    if (typeof event.seq !== 'number' || !Number.isSafeInteger(event.seq) || event.seq < 1) return
    if (event.gatewayEpoch && this.gatewayEpoch && event.gatewayEpoch !== this.gatewayEpoch) {
      this.recoverSnapshot()
      return
    }
    if (event.seq <= this.lastSeq) return
    if (event.seq > this.lastSeq + 1) {
      this.recoverSnapshot()
      return
    }

    if (event.gatewayEpoch) this.gatewayEpoch = event.gatewayEpoch
    this.lastSeq = event.seq
    if (Array.isArray(event.turns)) this.turns = event.turns
    this.pendingTurn = parsePendingTurn(event.pendingTurn)
    this.streamingText = typeof event.streamingText === 'string' ? event.streamingText : ''
    this.run = event.run && typeof event.run === 'object' ? event.run : IDLE_RUN
    this.reconcilePending()
    this.notify()
    this.scheduleRefresh()
    // 终态事件的 turns 可能来自页面卸载前的可见投影；官方 Session 才是最终历史。
    if (this.run.state === 'done' || this.run.state === 'failed' || this.run.state === 'stopped')
      this.recoverSnapshot()
  }

  private recoverSnapshot() {
    this.recovery ??= this.readCurrentSession(false).catch(() => {
      this.scheduleRefresh()
    }).finally(() => { this.recovery = undefined })
  }

  private handleContextChange(next: MobileRemoteContext) {
    if (this.context?.sessionId === next?.sessionId) return
    if (!next?.sessionId) {
      this.waitForContext()
      return
    }
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

function parsePendingTurn(value: unknown): MobileRemoteTurn | null {
  if (!value || typeof value !== 'object') return null
  const turn = value as Partial<MobileRemoteTurn>
  return typeof turn.id === 'string' && turn.role === 'user' && typeof turn.content === 'string'
    ? { id: turn.id, role: 'user', content: turn.content } : null
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

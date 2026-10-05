import { randomUUID } from 'node:crypto'

// SDK 自己拥有的 Agent scope；请求、审计和临时授权仍交给官方 ApprovalService。
export async function attachApprovalBridge(agent, notify) {
  const pending = new Map()
  let ready = false
  const plugin = agent.ctx.plugin({
    name: 'jiucaihezi-sdk-approval',
    inject: ['approval'],
    apply(ctx) {
      ctx.on('approval/request', req => {
        if (req.signal?.aborted) return 'cancelled'
        return new Promise(resolve => {
          const id = randomUUID()
          let turn, target
          for (let seq = req.agent.session.seq - 1; seq >= 0; seq--) {
            const event = req.agent.session.eventAt(seq)
            if (event?.type === 'tool/call' && event.data.callId === req.callId) {
              try {
                const args = typeof event.data.arguments === 'string' ? JSON.parse(event.data.arguments) : event.data.arguments
                const value = args?.file_path || args?.path || args?.command
                if (typeof value === 'string') target = value.slice(0, 1000)
              } catch { /* malformed tool arguments remain in the tool timeline */ }
            }
            if (event?.type === 'turn/start') { turn = event.data.turn; break }
          }
          const identity = { id, sessionId: agent.session.header.id, requestSessionId: req.agent.session.header.id, agentId: req.agent.id,
            turn, callId: req.callId }
          const finish = outcome => {
            if (!pending.delete(id)) return
            req.signal?.removeEventListener('abort', abort)
            resolve(outcome)
            try { notify('session.approval-settled', { ...identity, outcome }) } catch { /* transport closed */ }
          }
          const abort = () => finish('cancelled')
          pending.set(id, { identity, finish })
          req.signal?.addEventListener('abort', abort, { once: true })
          if (req.signal?.aborted) { abort(); return }
          try {
            notify('session.approval-request', { ...identity, toolName: req.toolName, target,
              reason: req.reason, displayReason: req.displayReason })
          } catch { finish('unavailable') }
        })
      })
      ctx.effect(() => () => {
        for (const request of pending.values()) request.finish('cancelled')
      })
      ready = true
    },
  })
  try {
    await plugin.await()
    if (!ready) throw new Error('DSH approval bridge service unavailable')
    plugin.assertActive()
  } catch (error) { await plugin.dispose(); throw error }
  return {
    answer(params) {
      plugin.assertActive()
      const request = pending.get(params.id)
      if (!request || ['sessionId', 'requestSessionId', 'agentId', 'turn', 'callId'].some(key => params[key] !== request.identity[key]))
        throw new Error('approval request expired or not pending in this session/agent/turn/call')
      if (!['allowed-once', 'rejected', 'unavailable'].includes(params.outcome)) throw new Error('invalid approval outcome')
      request.finish(params.outcome)
      return { outcome: params.outcome }
    },
    dispose: () => plugin.dispose(),
  }
}

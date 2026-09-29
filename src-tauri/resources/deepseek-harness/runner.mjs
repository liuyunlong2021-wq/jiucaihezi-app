import { createInterface } from 'node:readline'
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'

const config = JSON.parse(process.argv[2] || '{}')
const harness = new DeepSeekHarness({
  cwd: config.cwd,
  provider: 'jiucaihezi',
  model: config.model,
  patches: [config.patchPath],
  dshHome: config.dshHome,
  processCwd: config.cwd,
  env: process.env,
  initializeTimeoutMs: 15_000,
  maxTokens: 32_768,
})

const send = value => process.stdout.write(`${JSON.stringify(value)}\n`)
const errorMessage = error => error instanceof Error ? error.message : String(error)
let closing = false

async function close() {
  if (closing) return
  closing = true
  try { await harness.close() } finally { send({ type: 'closed' }) }
}

createInterface({ input: process.stdin }).on('line', line => {
  let command
  try { command = JSON.parse(line) } catch { return }
  if (command.type === 'close') {
    void close()
    return
  }
  if (command.type === 'list-sessions' || command.type === 'read-session') {
    void harness.start().then(() => harness.client.request(
      command.type === 'list-sessions' ? 'session/list' : 'session/read',
      command.type === 'read-session' ? { sessionId: command.sessionId } : {},
    )).then(
      data => send({ type: 'query-result', requestId: command.requestId, data }),
      error => send({ type: 'error', requestId: command.requestId, error: errorMessage(error) }),
    )
    return
  }
  // 会话权限是 durable 事实，进程级 DSH_PERMISSION_MODE 只管新会话的默认值。
  // 已存在的会话必须经官方命令面切换，否则打开 @文件 也松不开沙箱。
  if (command.type === 'permission') {
    void harness.start().then(() => harness.client.request('session/permission', {
      sessionId: command.sessionId,
      preset: command.preset,
    })).then(
      data => send({ type: 'query-result', requestId: command.requestId, data }),
      error => send({ type: 'error', requestId: command.requestId, error: errorMessage(error) }),
    )
    return
  }
  if (command.type !== 'run') return
  let turnError = ''
  let turnTruncated = false
  void harness.run(command.contentBlocks, {
    sessionId: command.sessionId,
    onNotification(notification) {
      // 子代理（subagent）的事件也走这条通知流，而子会话是独立 turn：
      // 只认本会话的 turn/end，否则子会话的失败会顶替本轮的结论——实测一轮 34 分钟正常
      // 跑完、20 集全部落盘，却被一个早已失败的子会话的 content_filter 判成「处理失败」。
      const params = notification.params
      const ownSession = params?.sessionId === command.sessionId
      const event = ownSession && notification.method === 'session.event' ? params.event : undefined
      if (event?.type === 'turn/end' && event.data?.reason?.kind === 'error')
        turnError = event.data.reason.error?.message || 'DeepSeek Harness 执行失败'
      if (event?.type === 'turn/end' && event.data?.reason?.kind === 'max-tokens')
        turnTruncated = true
      send({ type: 'notification', requestId: command.requestId, notification })
    },
  }).then(
    result => {
      if (turnError) return send({ type: 'error', requestId: command.requestId, error: turnError })
      // `max-tokens` 原先直接走成功分支：上游在整段 prompt 命中缓存时只回 1 个 token 就
      // 报 length，这一轮根本没有正文，前端的 `await completed || finalText` 于是拿上一个
      // step 的旧正文顶上——半截答案以「已完成」落盘，用户只能打「继续」，而「继续」不改
      // 前缀，命中同一条缓存路径后必然再次截断。实测一条会话被锁死 35 分钟（9 次，全在
      // deepseek-v4.1-flash 上，in=0 时 9/9 失败、有真实输入时 0/316 失败）。
      // 有正文的截断仍是成功（长回答写到上限）；没有正文的截断必须报错，否则等于谎报完成。
      if (turnTruncated && !String(result.finalResponse || '').trim())
        return send({
          type: 'error',
          requestId: command.requestId,
          error: '模型因长度上限提前终止，且本轮没有返回任何正文。通常是上游渠道故障，换一个模型重试即可。',
        })
      send({ type: 'result', requestId: command.requestId, text: result.finalResponse })
    },
    error => send({ type: 'error', requestId: command.requestId, error: errorMessage(error) }),
  )
})

process.stdin.on('end', () => void close())
process.on('SIGTERM', () => void close().finally(() => process.exit(0)))
send({ type: 'ready' })

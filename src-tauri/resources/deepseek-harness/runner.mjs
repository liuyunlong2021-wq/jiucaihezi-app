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
  if (command.type !== 'run') return
  let turnError = ''
  void harness.run(command.contentBlocks, {
    sessionId: command.sessionId,
    onNotification(notification) {
      const event = notification.method === 'session.event' ? notification.params?.event : undefined
      if (event?.type === 'turn/end' && event.data?.reason?.kind === 'error')
        turnError = event.data.reason.error?.message || 'DeepSeek Harness 执行失败'
      send({ type: 'notification', requestId: command.requestId, notification })
    },
  }).then(
    result => turnError
      ? send({ type: 'error', requestId: command.requestId, error: turnError })
      : send({ type: 'result', requestId: command.requestId, text: result.finalResponse }),
    error => send({ type: 'error', requestId: command.requestId, error: errorMessage(error) }),
  )
})

process.stdin.on('end', () => void close())
process.on('SIGTERM', () => void close().finally(() => process.exit(0)))
send({ type: 'ready' })

import { SdkProtocolError, validatedSessionEvent } from '@deepseek-ai/dsh-sdk-client'

// 官方 run() 在首次 idle 返回；工作台任务要等受管理子任务及根会话汇总结束。
export async function runHarnessTask(harness, contentBlocks, { sessionId, onNotification, requiredTools = [], productionMode }) {
  await harness.start()
  const client = harness.client
  if (productionMode !== undefined && (await client.request('session/production-scope', {})).version !== 1) throw new Error('当前运行时不支持创作 Skill 白名单，请重启应用。')
  if (requiredTools.length) await client.request('session/check-tools', { names: requiredTools })
  const subscription = client.subscribeSessionTree(sessionId)
  let received = false
  let finalResponse = ''
  try {
    const messageId = productionMode === undefined
      ? await client.prompt(sessionId, contentBlocks)
      : (await client.request('session/prompt', { sessionId, contentBlocks, productionMode })).messageId
    const finished = client.request('session/wait', { sessionId }).then(() => null)
    const collect = notification => {
      const own = notification.params?.sessionId === sessionId
      const event = own && notification.method === 'session.event'
        ? validatedSessionEvent(notification.params.event) : undefined
      if (!received) {
        if (event?.type !== 'agent/inbox/spliced'
          || !event.data?.inserted?.some(message => message.id === messageId)) return
        received = true
      }
      if (event?.type === 'assistant/message') {
        finalResponse = event.data.message.content.filter(block => block.type === 'text')
          .map(block => block.text).join('')
      }
      onNotification(notification)
    }
    let next = subscription.next()
    while (true) {
      const notification = await Promise.race([next, finished])
      if (notification === null) {
        let pending
        while ((pending = subscription.tryNext()) !== undefined) collect(pending)
        break
      }
      collect(notification)
      next = subscription.next()
    }
    if (!received) throw new SdkProtocolError('task finished without its durable input receipt')
    return { finalResponse }
  } finally {
    subscription.close()
  }
}

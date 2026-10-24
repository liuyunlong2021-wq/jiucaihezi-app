import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { ApiSessionList } from './node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/list.js'

// Reuse the pinned official GUI list projection; this domain contains only app preferences.
const preferences = defineDomain({
  name: 'jiucaihezi_session_ui', version: 1, layout: 'per-record',
  tables: { preferences: domainTable(z.object({
    hidden: z.boolean().optional(),
    manju: z.record(z.string(), z.unknown()).optional(),
    novel: z.record(z.string(), z.unknown()).optional(),
    shortDrama: z.record(z.string(), z.unknown()).optional(),
    // 历史 @3D 偏好必须可读并原样保留，否则 strict 校验会阻断整个项目的会话列表。
    scene3d: z.record(z.string(), z.unknown()).optional(),
    legacyRawPath: z.string().optional(), migratedAt: z.string().optional(),
  }).strict()) },
})
const normalize = value => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '')
const conversationId = id => id.startsWith('jc-v1-') ? id.slice(6) : id
const wireId = id => id.startsWith('jc-v1-') ? id : `jc-v1-${id}`

export function createConversationUi(server, { sessionList = new ApiSessionList(server.ctx, 16) } = {}) {
  const ctx = server.ctx
  const domain = ctx.storageDomain.open(preferences)
  server.disposers.push(async () => (await domain).close())
  const table = async () => (await domain).table('preferences')
  const cwd = () => server.cwd || process.cwd()
  const held = new Map()
  let route
  server.disposers.push(async () => { for (const handle of held.values()) await handle.dispose?.() })
  const records = async () => (await ctx.sessionQuery.listSessions()).filter(row =>
    row.header.origin !== 'subagent' && normalize(row.header.cwd) === normalize(cwd()))
  async function exactId(id) {
    const rows = await records()
    return (rows.find(row => row.header.id === id) || rows.find(row => conversationId(row.header.id) === id))?.header.id
  }
  async function owned(id, create = false) {
    const exact = await exactId(id)
    if (!exact && !create) throw new Error('会话不存在，请刷新列表')
    const sessionId = exact || wireId(id)
    let agent = ctx.agents.get(sessionId)
    if (!agent) {
      const agentOptions = { provider: route.provider, model: route.model }
      const handle = exact
        ? await ctx.agents.resume({ resumeSessionId: exact, agentOptions })
        : await ctx.agents.create({ sessionId, meta: { cwd: cwd() }, agentOptions })
      held.set(sessionId, handle)
      agent = handle.agent
    }
    if (normalize(agent.session.header.cwd) !== normalize(cwd())) throw new Error('会话属于其他项目')
    return agent.session
  }
  async function list() {
    const prefs = await table()
    const headers = new Map((await records()).map(row => [row.header.id, row.header]))
    const alias = id => headers.has(conversationId(id)) ? id : conversationId(id)
    const rows = (await sessionList.list()).filter(row => headers.has(row.sessionId))
    const missing = rows.filter(row => !row.projections?.values?.title)
    const titles = missing.length ? await ctx.sessionQuery.readTitleSnapshots(missing.map(row => row.sessionId)) : []
    const titleMap = new Map(titles.filter(row => row.status === 'fulfilled').map(row => [row.sessionId, row.value.title]))
    const hiddenIds = [...prefs.entries()].filter(([, value]) => value.hidden).map(([id]) => alias(id))
    return {
      entries: rows.filter(row => !prefs.get(row.sessionId)?.hidden).map(row => {
        const metadata = prefs.get(row.sessionId) || {}
        const title = row.projections?.values?.title || titleMap.get(row.sessionId)?.title || '新对话'
        return {
          ...metadata, conversationId: alias(row.sessionId), sessionId: row.sessionId,
          workspaceKey: cwd(), title, createdAt: new Date(headers.get(row.sessionId).createdAt).toISOString(),
          updatedAt: new Date(Math.max(row.updatedAt, titleMap.get(row.sessionId)?.updatedAt || 0)).toISOString(),
        }
      }),
      hiddenIds,
      warnings: titles.filter(row => row.status === 'rejected').map(row => `会话 ${row.sessionId} 的标题读取失败`),
    }
  }
  async function rename(id, title) {
    const session = await owned(id, true)
    ctx.sessionTitle.rename(session, title)
    await ctx.sessions.flush(session)
  }
  return async function request(params) {
    route = { provider: params.provider || 'jiucaihezi', model: params.model || 'history-reader' }
    if (params.action === 'list') return await list()
    if (params.action === 'create') {
      const session = await owned(params.conversationId, true)
      await ctx.sessions.flush(session)
    } else if (params.action === 'rename') {
      await rename(params.conversationId, params.title)
    } else if (params.action === 'preferences' || params.action === 'hide') {
      let id = await exactId(params.conversationId)
      if (!id && params.action === 'preferences' && params.preferences?.legacyRawPath) {
        const session = await owned(params.conversationId, true)
        if (params.title && params.title !== '新对话') ctx.sessionTitle.rename(session, params.title)
        await ctx.sessions.flush(session)
        id = session.id
      }
      id ||= wireId(params.conversationId)
      const patch = params.action === 'hide' ? { hidden: true } : params.preferences
      const checked = preferences.tables.preferences.valueSchema.parse(patch)
      const prefs = await table()
      if (!prefs.get(id)) await prefs.put(id, {})
      await prefs.update(id, previous => ({ ...previous, ...checked }))
    } else if (params.action === 'import') {
      if (!Array.isArray(params.entries) || params.entries.length > 10_000) throw new Error('旧偏好格式无效')
      const prefs = await table()
      for (const entry of params.entries) {
        if (entry.workspaceKey !== cwd() || typeof entry.conversationId !== 'string') continue
        let id = await exactId(entry.conversationId)
        if (!id) {
          const session = await owned(entry.conversationId, true)
          await ctx.sessions.flush(session)
          id = session.id
        }
        id ||= wireId(entry.conversationId)
        const patch = Object.fromEntries(['manju', 'novel', 'shortDrama', 'scene3d', 'legacyRawPath', 'migratedAt']
          .filter(key => entry[key] !== undefined).map(key => [key, entry[key]]))
        const checked = preferences.tables.preferences.valueSchema.parse(patch)
        // Already migrated or recently edited preferences always win on retry / another WebView origin.
        if (!prefs.get(id)) await prefs.put(id, {})
        await prefs.update(id, previous => ({ ...checked, ...previous }))
        if (entry.title && entry.title !== '新对话' && await exactId(entry.conversationId)) {
          const title = await ctx.sessionQuery.readTitleSnapshot(id)
          if (title.title?.source.kind !== 'user') await rename(entry.conversationId, entry.title)
        }
      }
    } else throw new Error('未知会话操作')
    return await list()
  }
}

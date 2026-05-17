export interface OrganizeConversation {
  id: string
  agentId?: string
  vaultId?: string | null
  title?: string
}

export interface OrganizeMessage {
  id?: string
  role: string
  content: string
  agentId?: string
  agentName?: string
}

export interface OrganizeMessageRecord {
  id: string
  items?: OrganizeMessage[]
}

export interface VaultConversationPair {
  sessionId: string
  vaultId: string
  agentId: string
  messageIds: string[]
  text: string
}

export interface VaultConversationGroup {
  vaultId: string
  pairs: VaultConversationPair[]
}

export function collectVaultConversations(
  conversations: OrganizeConversation[],
  records: OrganizeMessageRecord[],
): { groups: VaultConversationGroup[]; skippedSessionIds: string[] } {
  const conversationMap = new Map(conversations.map(c => [c.id, c]))
  const grouped = new Map<string, VaultConversationPair[]>()
  const skippedSessionIds: string[] = []

  for (const rec of records) {
    if (!rec?.id || !Array.isArray(rec.items)) continue
    const conversation = conversationMap.get(rec.id)
    const vaultId = conversation?.vaultId || null
    if (!vaultId) {
      skippedSessionIds.push(rec.id)
      continue
    }

    const sessionAgentId = conversation?.agentId || 'general'
    for (let i = 0; i < rec.items.length - 1; i++) {
      const current = rec.items[i]
      const next = rec.items[i + 1]
      if (current?.role !== 'user' || next?.role !== 'assistant') continue

      const text = `用户: ${current.content || ''}\n助手: ${next.content || ''}`.trim()
      if (!text) continue

      const pair: VaultConversationPair = {
        sessionId: rec.id,
        vaultId,
        agentId: current.agentId || sessionAgentId,
        messageIds: [current.id, next.id].filter(Boolean) as string[],
        text,
      }
      const bucket = grouped.get(vaultId) || []
      bucket.push(pair)
      grouped.set(vaultId, bucket)
    }
  }

  return {
    groups: Array.from(grouped.entries()).map(([vaultId, pairs]) => ({ vaultId, pairs })),
    skippedSessionIds,
  }
}

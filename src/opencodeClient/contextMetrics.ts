import type { ModelEntry } from '@/stores/agentStore'
interface ContextMessage { id: string; role: string; providerID?: string; modelID?: string; cost?: number; tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }; time?: { created?: number } }
export interface SessionContextMetrics { totalCost: number; context?: { message: ContextMessage; providerID: string; modelID: string; providerLabel: string; modelLabel: string; limit?: number; input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number; total: number; usage: number | null } }
const tokenTotal = (msg: ContextMessage) => { if (!msg.tokens) return 0; return msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read + msg.tokens.cache.write }
const lastAssistantWithTokens = (messages: ContextMessage[]) => { for (let i = messages.length - 1; i >= 0; i--) { const msg = messages[i]; if (msg.role !== 'assistant') continue; if (tokenTotal(msg) <= 0) continue; return msg } }
function buildModelLookup(models: ModelEntry[]): Map<string, { label: string; contextWindow?: number }> { const map = new Map<string, { label: string; contextWindow?: number }>(); for (const m of models) { if (m.id) map.set(m.id, { label: m.label, contextWindow: m.contextWindow }) }; return map }
export function getSessionContextMetrics(messages: ContextMessage[] = [], models: ModelEntry[] = []): SessionContextMetrics {
  const totalCost = messages.reduce((sum, msg) => sum + (msg.role === 'assistant' ? (msg.cost ?? 0) : 0), 0)
  const message = lastAssistantWithTokens(messages); if (!message) return { totalCost, context: undefined }
  const modelLookup = buildModelLookup(models); const modelInfo = modelLookup.get(message.modelID ?? ''); const limit = modelInfo?.contextWindow; const total = tokenTotal(message)
  return { totalCost, context: { message, providerID: message.providerID ?? '', modelID: message.modelID ?? '', providerLabel: message.providerID ?? '', modelLabel: modelInfo?.label ?? message.modelID ?? '', limit, input: message.tokens?.input ?? 0, output: message.tokens?.output ?? 0, reasoning: message.tokens?.reasoning ?? 0, cacheRead: message.tokens?.cache?.read ?? 0, cacheWrite: message.tokens?.cache?.write ?? 0, total, usage: limit ? Math.round((total / limit) * 100) : null } }
}

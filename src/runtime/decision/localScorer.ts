import type { DecisionCandidate, DecisionProvider, DecisionResult } from './types'

/**
 * 本地打分服务 provider（`scripts/jev-scorer/serve.py`）。
 *
 * 分工：它只回答「该挂哪个 Skill」——把「任务 + 每个候选的描述」交给常驻的交叉编码器进程，
 * 拿回分数，过阈值才算数。能力芯片（@文件/@图文/@影音/@3D）仍然归规则层，那是有明确关键词的
 * 结构判断，拿语义模型去猜反而更差。
 *
 * 为什么值得有这一层：本地 9b 聊天模型 2.3 秒/条、71%；交叉编码器 0.6 秒/条、76%（14×47 候选
 * 一次批完）。同一条链路里它同时赢了速度和准确率，而且不联网不花钱。
 */
const DEFAULT_SCORER_URL = 'http://127.0.0.1:4789'

/** 服务是常驻本地的，8 秒还没回来说明它没起来或在重启，别把发送拖住。 */
const SCORER_TIMEOUT_MS = 8000

export interface LocalScorerOptions {
  url?: string
  timeoutMs?: number
  /** 注入 fetch 只给测试用。 */
  fetchImpl?: typeof fetch
}

interface ScorerResponse {
  picked?: string | null
  ranked?: Array<{ id?: string; score?: number }>
  threshold?: number
}

export function createLocalScorerProvider(options: LocalScorerOptions = {}): DecisionProvider {
  const url = (options.url || DEFAULT_SCORER_URL).replace(/\/$/, '')
  const timeoutMs = options.timeoutMs ?? SCORER_TIMEOUT_MS
  const doFetch = options.fetchImpl || fetch

  return {
    id: 'scorer',
    async decide(request) {
      const skills = request.candidates.filter(candidate => candidate.kind === 'skill')
      if (!skills.length) return null
      const payload = {
        task: request.userRequest,
        candidates: skills.map(candidate => ({
          id: candidate.id,
          text: String(candidate.description || '').replace(/\s+/g, ' '),
        })),
      }
      const response = await doFetch(`${url}/score`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) return null
      const data = (await response.json()) as ScorerResponse
      // 服务只负责排序；「服务是不是抽风返回了一个不存在的 id」由这里兜住 —— 候选清单外的一律丢。
      const allowed = new Set(skills.map(candidate => candidate.id))
      const picked = data.picked && allowed.has(data.picked) ? data.picked : ''
      if (!picked) return null
      const result: DecisionResult = {
        skills: [picked],
        tools: [],
        modelTier: null,
        suggestions: [],
        reason: '本地打分器',
        provider: 'scorer',
        latencyMs: 0,
      }
      return result
    },
  }
}

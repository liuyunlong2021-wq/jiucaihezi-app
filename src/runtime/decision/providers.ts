import { resolveSkillApplicability } from '@/runtime/connection/skillApplicability'
import { sendDirectRequestWithRetry } from '@/runtime/direct/directEngine'
import { sendNewApiRequest } from '@/runtime/direct/newApiAttachments'
import {
  buildChatCompletionExtras,
  buildHeaders,
  ChatHttpError,
  readChatErrorResponse,
  resolveApiConfig,
} from '@/utils/api'
import { safeFetch } from '@/utils/httpClient'
import type {
  DecisionCandidate,
  DecisionModelTier,
  DecisionProvider,
  DecisionRequest,
  DecisionResult,
} from './types'

/** 决策调用用的模型。providerId 决定走本地 Ollama 原生接口还是云端 chat/completions。 */
export interface DecisionModelRef {
  modelId: string
  providerId: string
}

// ─── 规则 provider：常见说法零成本零延迟命中 ───

/**
 * `@文件` 开的是本机全权（文件工具 + 终端 + Skill 脚本，零弹窗），所以这条授权
 * 只能来自用户自己的话，不能由模型猜。命中即视为用户已授权。
 */
export const LOCAL_GRANT_INTENT =
  /保存|存到|存入|写入|写到|文件|文件夹|目录|项目里|项目内|导出到|磁盘/i

/** 决策层不得代开的能力芯片，由 decide() 统一执行。 */
export const LOCAL_GRANT_TOOL_IDS = new Set(['file'])

export function isToolGrantedByUser(toolId: string, userRequest: string): boolean {
  if (!LOCAL_GRANT_TOOL_IDS.has(toolId)) return true
  return LOCAL_GRANT_INTENT.test(userRequest)
}

/**
 * 用户这句话直接点名的能力芯片。只收明确信号；模糊说法留给 LLM provider，避免误开能力反而更费 token。
 */
const TOOL_RULES: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: 'file', pattern: LOCAL_GRANT_INTENT },
  {
    id: 'av',
    pattern:
      /生成.{0,6}(图片|照片|图像|插画|封面)|画一[张幅个]|出图|配图|生图|文生图|文生视频|生成视频|配音|朗读|语音|音频|音乐|bgm/i,
  },
  { id: 'media', pattern: /文档|网页|幻灯片|ppt|演示稿|海报排版/i },
  { id: 'scene3d', pattern: /3d|三维|建模/i },
]

const LIGHT_TIER = /翻译|译成|总结|摘要|概括|提炼|校对|错别字|格式化|提取|列出|列个|润色|缩写/i
const STRONG_TIER =
  /小说|续写|大纲|分集|分镜|剧本|长篇|重构|架构|规划|方案|分析|改编|连载|世界观|人设/i

/** 按档位关键词判断本轮该用哪一档模型。没有明确信号就返回 null，不动用户当前的模型。 */
function inferTier(userRequest: string): DecisionModelTier | null {
  if (STRONG_TIER.test(userRequest)) return 'strong'
  if (LIGHT_TIER.test(userRequest)) return 'light'
  return null
}

/**
 * 取第一个词。命中判定用的就是这批词，所以这里只做空白归一化，**不截断**：
 * 描述曾经在候选阶段被按 80 字硬切，切出过尾巴上的半个 ASCII 词（`…产出并维护 wi`），
 * 那个 `wi` 会命中任何带「Wiki」的消息，把一个错的 Skill 强制挂上来。
 * 截断是提示词排版的事，放在 buildDecisionPrompt 里按分隔符切。
 */
function normalizeTermSource(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 弱命中剔除。
 * - ASCII 词必须整词命中：`wi` 不能命中 `Wiki`，`use` 不能命中 `useful`。
 * - CJK 没有词边界，保持子串判断（「剧本」就该命中「短剧剧本」）。
 */
function isMeaningfulMatch(term: string, userRequest: string): boolean {
  if (!/^[\x20-\x7e]+$/.test(term)) return true
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}($|[^A-Za-z0-9_])`).test(userRequest)
}

/**
 * 用 Skill 的 triggers 去撞用户这句话，取最具体的那一个。
 *
 * 两条都是实测踩出来的：
 * 1. **只信 triggers，不扫描述。** triggers 是作者手写的搜索关键词（见 types/skill.ts）；
 *    描述是写给人看的散文，拿它做子串匹配会捞出泛词——`jc-daxi` 的描述里有
 *    「剧情、人物、场景」，于是「生成一张人物照片」就把打戏 Skill 挂上来了。
 *    代价是没写 triggers 的 Skill 规则层看不见，会落到 LLM provider，那比猜错便宜。
 * 2. **按词的具体程度排序，不是按命中条数。** 「帮我写一个短剧剧本」时 jc-duanju 命中
 *    「短剧剧本」、jc-daoyan-fenjing 命中「剧本」，都是 1 条；只比条数就按目录顺序定胜负，
 *    结果选了导演分镜。长词优先才对。
 *
 * 只取一个 Skill 也是故意的：多挂一个就多注入一份 SKILL.md 全文，而省 token 正是 @Jev
 * 存在的理由；真要组合两个，用户看到 chip 行自己再点一个就行。
 */
function rankSkillCandidates(userRequest: string, candidates: DecisionCandidate[]): string[] {
  return candidates
    .filter(candidate => candidate.kind === 'skill')
    .map(candidate => ({
      id: candidate.id,
      terms: resolveSkillApplicability({
        userInput: userRequest,
        // 故意不给 description 与 skillContent：让词表只剩 triggers（和名字）。
        selectedSkill: { id: candidate.id, name: candidate.label, triggers: candidate.triggers },
      })
        .matchedTerms
        // 合成信号不是真实词命中，会让所有写作类 Skill 一起中招。
        .filter(term => term !== 'writing-intent')
        .filter(term => isMeaningfulMatch(term, userRequest)),
    }))
    .filter(item => item.terms.length > 0)
    .sort((left, right) => specificity(right.terms) - specificity(left.terms))
    .slice(0, 1)
    .map(item => item.id)
}

/** 先比命中的最长词（越具体越可信），再比命中条数。 */
function specificity(terms: string[]): number {
  return Math.max(...terms.map(term => term.length)) * 10 + terms.length
}

export function createRuleDecisionProvider(): DecisionProvider {
  return {
    id: 'rule',
    async decide(request) {
      const tools = TOOL_RULES.filter(rule => rule.pattern.test(request.userRequest))
        .map(rule => rule.id)
        .filter(id =>
          request.candidates.some(candidate => candidate.kind === 'tool' && candidate.id === id),
        )
      const skills = rankSkillCandidates(request.userRequest, request.candidates)
      // 一个都没命中 = 规则没把握，交给下一个 provider，别硬猜。
      if (!skills.length && !tools.length) return null
      return {
        skills,
        tools,
        modelTier: inferTier(request.userRequest),
        suggestions: [],
        reason: '常见说法直接命中',
        provider: 'rule',
        latencyMs: 0,
      }
    },
  }
}

// ─── LLM provider：把开放生成收敛成封闭选项的选择题 ───

export const DECISION_MAX_TOKENS = 500

/**
 * 提示词里每条描述最多留多少字。
 * 实测 ~/.agents/skills 的 47 条描述最长 317 字、全量合计才 5,586 字，所以 400 字等于
 * 「不截断」，同时挡掉异常超长描述把 prompt 撑爆。
 * 曾经设 80 字：只有 8/47 条能完整保留，`jc-juben-yingyi` 结尾的「只做中译英，不改剧情」
 * 被切掉，模型据此以为它「也支持反向」——路由恰恰需要这类限定条件。
 * 仍按分隔符切，不要切出半个 ASCII 词：半个词在 prompt 里会被当成真关键词。
 */
const CLIP_LIMIT = 400

const CLIP_SEPARATORS = ['、', '，', '；', '。', ' ', '：', ':', '\n']

function clipForPrompt(value: string, limit = CLIP_LIMIT): string {
  const text = normalizeTermSource(value)
  if (text.length <= limit) return text
  const head = text.slice(0, limit)
  const cut = Math.max(...CLIP_SEPARATORS.map(separator => head.lastIndexOf(separator)))
  // cut 是分隔符自身的位置，+1 才把它留下，否则会切到半个词的尾巴上。
  return `${cut >= limit / 2 ? head.slice(0, cut + 1) : head}…`
}

export function buildDecisionPrompt(request: DecisionRequest): string {
  const render = (kind: DecisionCandidate['kind']) => {
    const rows = request.candidates
      .filter(candidate => candidate.kind === kind)
      .map(candidate => `- ${candidate.id}：${clipForPrompt(candidate.description)}`)
    return rows.length ? rows : ['（无）']
  }
  return [
    '你是韭菜盒子的能力路由器。根据用户这一句话，从候选里挑出完成它所需的最少能力，并判断该用哪一档模型。',
    '要求：',
    '1. 只能选候选清单里出现过的 id，一个都不能编。',
    '2. 不需要就留空数组；宁少勿多，多开能力会让本轮更慢更贵。',
    '3. skills 最多 1 个，而且必须真有一款 Skill 是为这件事设计的。只是「沾边」、只是话题相同（如提到剧本），都不算——选错会强制挂上一整份不相干的 SKILL.md。',
    '4. 没有任何一款合适就留空，直接回答反而更好，这是允许的答案。',
    '5. modelTier 只能取 keep / light / medium / strong；拿不准就 keep。',
    '只输出一行 JSON，不要解释、不要 Markdown、不要代码围栏：',
    '{"skills":[],"tools":[],"modelTier":"keep","reason":"一句话"}',
    '',
    '候选 Skill：',
    ...render('skill'),
    '',
    '候选能力芯片：',
    ...render('tool'),
  ].join('\n')
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : []
}

/**
 * 校验模型返回。候选清单外的 id 一律丢弃——「只能选现有能力」这条约束由代码保证，不靠提示词自觉。
 */
export function parseDecisionOutput(
  text: string,
  candidates: DecisionCandidate[],
): Pick<DecisionResult, 'skills' | 'tools' | 'modelTier' | 'reason'> | null {
  const block = String(text || '').match(/\{[\s\S]*\}/)
  if (!block) return null
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(block[0]) as Record<string, unknown>
  } catch {
    return null
  }
  const allowed = (kind: DecisionCandidate['kind']) =>
    new Set(candidates.filter(candidate => candidate.kind === kind).map(candidate => candidate.id))
  const skills = asStringArray(raw.skills)
    .filter(id => allowed('skill').has(id))
    .slice(0, 1)
  const tools = asStringArray(raw.tools).filter(id => allowed('tool').has(id))
  const tier =
    raw.modelTier === 'light' || raw.modelTier === 'medium' || raw.modelTier === 'strong'
      ? raw.modelTier
      : null
  return { skills, tools, modelTier: tier, reason: String(raw.reason || '').slice(0, 200) }
}
function buildDecisionRequestBody(model: string, request: DecisionRequest, providerId: string) {
  const messages = [
    { role: 'system' as const, content: buildDecisionPrompt(request) },
    { role: 'user' as const, content: `用户请求：${request.userRequest}` },
  ]
  if (providerId === 'local-ollama') {
    return {
      model,
      stream: false,
      think: false,
      options: { temperature: 0, num_predict: DECISION_MAX_TOKENS },
      messages,
    }
  }
  return {
    model,
    stream: false,
    temperature: 0,
    max_tokens: DECISION_MAX_TOKENS,
    messages,
  }
}

export function readDecisionText(payload: unknown): string {
  const data = payload as any
  const content = data?.choices?.[0]?.message?.content ?? data?.message?.content
  return typeof content === 'string' ? content : ''
}

export function createLlmDecisionProvider(
  resolveModel: () => DecisionModelRef | null,
): DecisionProvider {
  return {
    id: 'llm',
    async decide(request) {
      const target = resolveModel()
      if (!target) return null
      const config = await resolveApiConfig({
        modelId: target.modelId,
        modelProviderId: target.providerId,
      })
      const isOllama = config.providerId === 'local-ollama'
      const response = await sendDirectRequestWithRetry(() =>
        sendNewApiRequest(
          {
            ...buildDecisionRequestBody(config.model, request, config.providerId),
            ...buildChatCompletionExtras(config),
          },
          payload =>
            safeFetch(`${config.apiBase}${isOllama ? '/api/chat' : '/v1/chat/completions'}`, {
              method: 'POST',
              headers: buildHeaders(config),
              body: payload,
            }),
        ),
      )
      if (!response.ok)
        throw new ChatHttpError(
          await readChatErrorResponse(response, '决策模型请求失败', config.apiKey),
        )
      const parsed = parseDecisionOutput(
        readDecisionText(await response.json().catch(() => null)),
        request.candidates,
      )
      if (!parsed) return null
      return { ...parsed, suggestions: [], provider: 'llm', latencyMs: 0 }
    },
  }
}

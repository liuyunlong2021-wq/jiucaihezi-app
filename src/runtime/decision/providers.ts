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
  /保存|存到|存入|存进|写入|写进|写到|文件|文件夹|目录|项目里|项目内|导出到|磁盘|放入|放进|归档|落盘|wiki/i

/** 决策层不得代开的能力芯片，由 decide() 统一执行。 */
export const LOCAL_GRANT_TOOL_IDS = new Set(['file'])

export function isToolGrantedByUser(toolId: string, userRequest: string): boolean {
  if (!LOCAL_GRANT_TOOL_IDS.has(toolId)) return true
  return LOCAL_GRANT_INTENT.test(userRequest)
}

/**
 * 用户这句话有没有命中这个 Skill 自己声明的 triggers。
 *
 * triggers 是作者手写的「什么时候该用我」（types/skill.ts），所以它同时是**复核模型判断的依据**：
 * 一个都没命中，说明模型在硬凑而不是真匹配。实测它会把「只做中译英、不改剧情」的
 * `jc-juben-yingyi` 挂到「翻译成中文」上，理由是「反向操作」。
 *
 * 没写 triggers 的 Skill 返回 true——无从复核就尊重模型的判断（47 个里只有 17 个写了）。
 */
export function matchesOwnTriggers(
  candidate: Pick<DecisionCandidate, 'triggers'> | undefined,
  userRequest: string,
): boolean {
  const triggers = (candidate?.triggers || [])
    .map(term =>
      String(term || '')
        .trim()
        .toLowerCase(),
    )
    .filter(term => term.length >= 2)
  if (!triggers.length) return true
  const lower = String(userRequest || '').toLowerCase()
  return triggers.some(term => lower.includes(term) && isMeaningfulMatch(term, userRequest))
}

/**
 * 「要的是一段文字」的请求：写提示词、写文案、写脚本。
 * 这类请求里出现的「文生视频」「生成图片」是在说**这段字写给谁用**，不是要出片，
 * 而 @影音 / @图文 是产出型能力——开了就会真的去调生图生视频模型。
 * 实测：「根据上面的内容写一个 MiniMax 的文生视频的视频提示词」把 @影音 打开了，
 * 用户要的只是一段字。反过来「用这段提示词生成一段视频」里动词在「提示词」之后，
 * 不命中，照常开 @影音。
 */
const TEXT_DELIVERABLE_INTENT =
  /(写|拟|起草|整理|生成|优化|润色|改|来一?[份个段])[^，。；！？\n]{0,8}(提示词|prompt)/i

/** 产出型能力：会真的调用模型造出文件。只在用户要成品时才自动开。 */
const PRODUCING_TOOL_IDS = new Set(['av', 'media'])

/**
 * 用户这句话直接点名的能力芯片。只收明确信号；模糊说法留给 LLM provider，避免误开能力反而更费 token。
 */
const TOOL_RULES: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: 'file', pattern: LOCAL_GRANT_INTENT },
  {
    id: 'av',
    // 产出动作 + 媒体名词，两个都要有。曾经 video 这一支只收了「文生视频」这个**模式名**
    // （它本身不是动作），结果两头都错：用户说「写一个文生视频的提示词」误开了 @影音，
    // 而真要出片时说「做个视频」「生成一段视频」反而一个都不中。
    // 图片类名词额外禁止动作与名词之间出现「成/为」：「把这段做成图片」是把现成内容排版导出，
    // 归 @图文；而「做成视频」是真的要出片，所以只对图片类收窄。
    pattern:
      /(生成|做|出|画|渲染|合成|配|弄|来一?[段张个份])(?:(?![成为])[^，。；！？\n]){0,4}(图片|照片|图像|插画|封面|海报)|(生成|做|出|画|渲染|合成|配|弄|来一?[段张个份])[^，。；！？\n]{0,4}(视频|短片|动画|音频|配音|语音|朗读|音乐|bgm)|画一[张幅个]|出图|配图|生图|配音|朗读|语音/i,
  },
  {
    id: 'media',
    // 「以图片的形式」「长图」「图文卡片」指的是把内容排版成图（export_markdown_png），
    // 不是 AI 生图——所以归 @图文 而不是 @影音。原来只认「文档/网页/幻灯片/海报排版」，
    // 用户说「写一个长文，以图片的形式发我」时两个都掽不上，@图文 没开、模型只能说不支持。
    pattern:
      /文档|网页|幻灯片|ppt|演示稿|海报|排版|长图|图文卡片|卡片图|以图片(的)?形式|图片形式|做成图片|变成图片|转成图片|导出.{0,4}图片|存成图片/i,
  },
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
 * 用候选自己声明的关键词撞用户这句话，取最具体的那几个。
 * 适用对象：Skill（triggers 是作者手写的「什么时候该用我」）与 MCP 服务（服务名 +
 * 工具名 + 工具说明——`McpServerConfig` 没有 description 字段，工具是唯一可信的信号）。
 *
 * 三条都是实测踩出来的：
 * 1. **只信自带关键词，不扫描述。** 描述是写给人看的散文，拿它做子串匹配会捞出泛词——
 *    `jc-daxi` 的描述里有「剧情、人物、场景」，于是「生成一张人物照片」就把打戏挂上来了。
 *    代价是没写关键词的 Skill 规则层看不见，会落到 LLM provider，那比猜错便宜。
 * 2. **按词的具体程度排序，不是按命中条数。** 「帮我写一个短剧剧本」时 jc-duanju 命中
 *    「短剧剧本」、jc-daoyan-fenjing 命中「剧本」，都是 1 条；只比条数就按目录顺序定胜负，
 *    结果选了导演分镜。长词优先才对。
 * 3. **Skill 只取 1 个**（多挂一个就多注入一份 SKILL.md 全文，而省 token 正是 @Jev 存在的
 *    理由）；MCP 服务取 2 个，因为它只多几份工具 schema，而漏掉用户要的那一个代价更大。
 */
function rankByOwnKeywords(
  userRequest: string,
  candidates: DecisionCandidate[],
  kind: DecisionCandidate['kind'],
): string[] {
  return candidates
    .filter(candidate => candidate.kind === kind && (candidate.triggers || []).length)
    .map(candidate => ({ id: candidate.id, terms: matchedKeywordTerms(userRequest, candidate) }))
    .filter(item => item.terms.length > 0)
    .sort((left, right) => specificity(right.terms) - specificity(left.terms))
    .slice(0, kind === 'skill' ? 1 : 2)
    .map(item => item.id)
}

function matchedKeywordTerms(userRequest: string, candidate: DecisionCandidate): string[] {
  return (
    resolveSkillApplicability({
      userInput: userRequest,
      // 故意不给 description 与 skillContent：让词表只剩 triggers（和名字）。
      selectedSkill: { id: candidate.id, name: candidate.label, triggers: candidate.triggers },
    })
      .matchedTerms
      // 合成信号不是真实词命中，会让所有写作类 Skill 一起中招。
      .filter(term => term !== 'writing-intent')
      .filter(term => isMeaningfulMatch(term, userRequest))
  )
}

/** 先比命中的最长词（越具体越可信），再比命中条数。 */
function specificity(terms: string[]): number {
  return Math.max(...terms.map(term => term.length)) * 10 + terms.length
}

export function createRuleDecisionProvider(): DecisionProvider {
  return {
    id: 'rule',
    async decide(request) {
      // 要文字的那轮不开产出型能力，看 TEXT_DELIVERABLE_INTENT 的说明。
      const wantsText = TEXT_DELIVERABLE_INTENT.test(request.userRequest)
      const chipIds = TOOL_RULES.filter(rule => rule.pattern.test(request.userRequest))
        .map(rule => rule.id)
        .filter(
          id =>
            !(wantsText && PRODUCING_TOOL_IDS.has(id)) &&
            request.candidates.some(candidate => candidate.kind === 'tool' && candidate.id === id),
        )
      // MCP 服务也按它自己声明的关键词选，和 Skill 走同一套。
      const tools = [
        ...new Set([
          ...chipIds,
          ...rankByOwnKeywords(request.userRequest, request.candidates, 'tool'),
        ]),
      ]
      const skills = rankByOwnKeywords(request.userRequest, request.candidates, 'skill')
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
    '2. 不需要就留空数组；宁少勿多，多开能力会让本轮更慢更贵。「提到某种能力」不等于「要用它」：用户要一段提示词、文案、脚本、方案时，文中出现的文生视频、生图、配音之类只是谈论对象，不要因此开影音、图文这类真的会去调模型产出文件的能力。',
    '3. skills 最多 1 个，而且必须真有一款 Skill 是为这件事设计的。必须看限定语（「只做某方向」「仅限X」「不负责Y」）：用户请求落在它的排除范围里就不算合适。只是「沾边」、只是话题相同（如提到剧本），都不算——选错会强制挂上一整份不相干的 SKILL.md。',
    '4. 没有任何一款合适就留空，直接回答反而更好，这是允许的答案。',
    '5. id 以 mcp__ 开头的是已连接的外部 MCP 服务。用户要联网搜索、抓网页、查仓库这类本机没有的能力时，从工具清单里挑提供该能力的服务。',
    '6. modelTier 只能取 keep / light / medium / strong；拿不准就 keep。',
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
  resolveModels: () => DecisionModelRef[],
): DecisionProvider {
  return {
    id: 'llm',
    async decide(request) {
      const targets = resolveModels()
      // 按优先级逐个试：本地 Ollama 优先，它不可用（没拉起来、不是聊天模型、报错）就回落云端轻量档。
      // 只判断「有没有配本地模型」不够——实测用户列表第一个是 glm-ocr，决策落到 OCR 模型上什么都选不出来，
      // 而且失败被 decide() 静默吞掉，表现就是「@Jev 什么都没开」。
      for (const target of targets) {
        try {
          const result = await callDecisionModel(target, request)
          if (result) return result
        } catch (cause) {
          console.debug(
            '[jev] 决策模型不可用',
            target.providerId,
            target.modelId,
            cause instanceof Error ? cause.message : cause,
          )
        }
      }
      return null
    },
  }
}

/** 拿一个模型跑一次决策。抛错代表这个模型不可用，由调用方决定是否换下一个。 */
async function callDecisionModel(
  target: DecisionModelRef,
  request: DecisionRequest,
): Promise<DecisionResult | null> {
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
}

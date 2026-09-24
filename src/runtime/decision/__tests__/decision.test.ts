import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { decide } from '@/runtime/decision'
import { orderDecisionModelRefs } from '@/runtime/decision/index'
import { createLocalScorerProvider } from '@/runtime/decision/localScorer'
import {
  buildDecisionPrompt,
  createRuleDecisionProvider,
  gateSkillsByOwnTriggers,
  isToolGrantedByUser,
  parseDecisionOutput,
  pickLocalDecisionModel,
} from '@/runtime/decision/providers'
import type { DecisionCandidate, DecisionProvider } from '@/runtime/decision/types'

/**
 * 候选的形状照抄真实来源：Skill 用 triggers 当搜索关键词（`src/types/skill.ts` 里这个字段
 * 就是为此存在的），描述是逗号串起的长句——正是这种长句按标点切词后撞不上用户短话，
 * 所以必须靠 triggers，不然规则命中率会接近零。
 */
const CANDIDATES: DecisionCandidate[] = [
  {
    id: 'jc-duanju',
    kind: 'skill',
    label: 'jc-duanju',
    description: '创作可拍摄的中文短剧剧本、单场戏与分集大纲',
    triggers: ['短剧', '剧本', '分集大纲'],
  },
  {
    id: 'jc-juben-yingyi',
    kind: 'skill',
    label: 'jc-juben-yingyi',
    description: '把中文剧本、对白或分场翻译成英文剧本',
    triggers: ['翻译', '英文'],
  },
  {
    id: 'jc-novel',
    kind: 'skill',
    label: 'jc-novel',
    description: '创作长篇网文或连载小说，设计角色与世界观',
    triggers: ['小说', '连载', '世界观'],
  },
  {
    id: 'file',
    kind: 'tool',
    label: '文件',
    description: '读取、创建、修改和保存当前项目中的文件',
  },
  {
    id: 'media',
    kind: 'tool',
    label: '排版',
    description: '把内容排成文档、网页、长图、幻灯片并导出成文件',
  },
  // 「提到文生视频」不等于「要出片」，说明里写清它会真的调模型产出文件，减少误选。
  {
    id: 'av',
    kind: 'tool',
    label: '影音',
    description: '调用生图、生视频、配音模型，真的产出图片、视频、音频文件',
  },
  { id: 'scene3d', kind: 'tool', label: '3D', description: '创建或编辑 3D 场景' },
]

const request = (userRequest: string) => ({ userRequest, candidates: CANDIDATES })

function stub(
  id: string,
  result: Awaited<ReturnType<DecisionProvider['decide']>>,
): DecisionProvider {
  return { id, decide: async () => result }
}

test('规则命中：写短剧剧本只选剧本 Skill，不开任何文件或终端能力', async () => {
  // 显式传链路：默认链里第一个是本地打分器（一次 HTTP 调用），
  // 拿默认链做断言会变成「看服务在不在跑」而不是看代码。
  const result = await decide(request('帮我写一个短剧剧本'), [createRuleDecisionProvider()])
  assert.deepEqual(result?.skills, ['jc-duanju'])
  assert.deepEqual(result?.tools, [])
  assert.equal(result?.modelTier, 'strong')
  assert.equal(result?.provider, 'rule')
})

test('规则命中：翻译剧本选中翻译 Skill，用户没提文件就不开 @文件', async () => {
  const result = await decide(request('把当前剧本翻译成英文'), [createRuleDecisionProvider()])
  // 只取最匹配的一个：多挂一个 Skill 就多注入一份 SKILL.md 全文。
  assert.deepEqual(result?.skills, ['jc-juben-yingyi'])
  assert.deepEqual(result?.tools, [])
})

test('规则命中：用户自己说了「保存到项目里」，才允许代开 @文件', async () => {
  const result = await decide(request('把当前剧本翻译成英文，然后保存到项目里'), [createRuleDecisionProvider()])
  assert.deepEqual(result?.skills, ['jc-juben-yingyi'])
  assert.deepEqual(result?.tools, ['file'])
  assert.deepEqual(result?.suggestions, [])
})

// 本地打分器只回答「该挂哪个 Skill」，芯片仍归规则层。
// 它是外部进程，所以返回的 id 必须复核：服务抽风编一个不存在的 id 不能直接挂上去。
test('本地打分器：过阈值的 Skill 才挂，清单外的 id 一律丢掉', async () => {
  const fake = (payload: unknown) =>
    (async () => ({ ok: true, json: async () => payload })) as unknown as typeof fetch
  const candidates = CANDIDATES

  const normal = await createLocalScorerProvider({ fetchImpl: fake({ picked: 'jc-novel' }) }).decide(
    { userRequest: '我想写一部关于口红的小说', candidates },
  )
  assert.deepEqual(normal?.skills, ['jc-novel'])
  assert.deepEqual(normal?.tools, [])

  const noMatch = await createLocalScorerProvider({ fetchImpl: fake({ picked: null }) }).decide(
    { userRequest: '今天天气怎么样', candidates },
  )
  assert.equal(noMatch, null, '没过阈值就该什么都不挂')

  const invented = await createLocalScorerProvider({ fetchImpl: fake({ picked: 'made-up' }) }).decide(
    { userRequest: '随便', candidates },
  )
  assert.equal(invented, null)
})

// provider 抛错是允许的（decide() 负责兜住并继续下一个），所以这里测的是「链路不断」。
test('本地打分器：服务没起来时链路继续走到下一个 provider', async () => {
  const boom = (async () => {
    throw new Error('ECONNREFUSED')
  }) as unknown as typeof fetch
  const result = await decide(request('帮我写一个短剧剧本'), [
    createLocalScorerProvider({ fetchImpl: boom }),
    createRuleDecisionProvider(),
  ])
  assert.deepEqual(result?.skills, ['jc-duanju'])
})

test('规则命中：生成照片开 @影音', async () => {
  const result = await decide(request('生成一张人物照片'), [createRuleDecisionProvider()])
  assert.deepEqual(result?.tools, ['av'])
})

// 用户实测：@Jev 老是「判断没回来」。根因是决策模型取了模型清单里第一个非 OCR 的——
// 那是一台 27B（34.9GB），光读完 4k token 的决策提示词就超过 HTTP 层 30s 上限。
// 决策该用云端还是本地：云端 1~3 秒且判断力更好（代价是一次约 4.5k token 的调用）；
// 本地零 token，但 9b 级判断力偏弱、冷启动 20 秒。默认云端优先，本地兜底。
test('决策模型顺序：云端优先，本地兜底，缺一个时另一个顶上', () => {
  const cloud = { modelId: 'glm-4.6', providerId: 'jiucaihezi' }
  const local = { modelId: 'qwen3.8:9b-q5', providerId: 'local-ollama' }
  assert.deepEqual(orderDecisionModelRefs(cloud, local), [cloud, local])
  assert.deepEqual(orderDecisionModelRefs(cloud, null), [cloud])
  assert.deepEqual(orderDecisionModelRefs(null, local), [local])
  assert.deepEqual(orderDecisionModelRefs(null, null), [])
})

test('决策模型按体积挑最小的，不能盲取第一个', async () => {
  const picked = await pickLocalDecisionModel([
    { name: 'glm-ocr:latest', size: 2_219_299_168 },
    { name: 'orcarouter/Qwen3.8-27B-Uncensored:latest', size: 17_741_860_746 },
    { name: 'qwen3.8:9b-q5', size: 6_642_544_089 },
    { name: 'qwen3.8:27b-mlx', size: 18_174_721_847 },
    { name: 'qwen2.5-coder:1.5b-base', size: 986_060_385 },
  ])
  assert.deepEqual(picked, { modelId: 'qwen3.8:9b-q5', providerId: 'local-ollama' })
})

test('云端模型混在清单里时不被当成本地模型：它的 size 只是几百字节的占位符', async () => {
  const picked = await pickLocalDecisionModel([
    { name: 'gemini-3-flash-preview:latest', size: 367 },
    { name: 'glm-4.6:cloud', size: 366 },
    { name: 'qwen3.8:27b-mlx', size: 18_174_721_847 },
  ])
  assert.deepEqual(picked, { modelId: 'qwen3.8:27b-mlx', providerId: 'local-ollama' })
})

// 用户实测：让 @Jev 挑「写视频提示词」的 Skill，它却开了 @影音（会真的去调生视频模型）。
// 「文生视频」「生成图片」在这类句子里是模式名，说明这段字写给谁用，不是要出片。
// 闸门在 decide() 里执行，所以两个 provider 都绕不过去，测试也必须走 decide()。
test('要一段文字时不开产出型能力：写视频提示词不开 @影音', async () => {
  for (const userRequest of [
    '根据上面的内容写一个MiniMax的文生视频的视频提示词',
    '帮我写一个生成视频的提示词',
    '写一段海报的提示词',
  ]) {
    const result = await decide(request(userRequest), [createRuleDecisionProvider()])
    assert.ok(!(result?.tools || []).includes('av'), `${userRequest} 不该开 @影音`)
  }
})

// 用户实测第二条：模型自己给「写美女拿着口红的图片的提示词」开了 @影音。
// 要的是文字却开了会真的生图的能力，只能改放进 suggestions 由用户自己点。
test('模型层想开产出型能力，用户要的是文字，就只能进 suggestions', async () => {
  const modelSays = stub('llm', {
    skills: ['gpt-image-2-prompts'],
    tools: ['av'],
    modelTier: null,
    suggestions: [],
    reason: '要生图',
    provider: 'llm',
    latencyMs: 0,
  })
  const wantsText = await decide(
    request('给我写一个真人摄影风格的美女拿着口红的有氛围感的图片的提示词'),
    [modelSays],
  )
  assert.deepEqual(wantsText?.tools, [])
  assert.deepEqual(wantsText?.suggestions, ['av'])
  // 真的要出片时照样开。
  const wantsMedia = await decide(request('用这段提示词生成一张图片'), [modelSays])
  assert.deepEqual(wantsMedia?.tools, ['av'])
})

test('反过来没被误伤：真的要出片仍然开 @影音', async () => {
  const provider = createRuleDecisionProvider()
  for (const userRequest of [
    '用这段提示词生成一段视频',
    '把这个脚本做成视频',
    '帮我做个视频',
    '生成一张人物照片',
  ]) {
    const result = await provider.decide(request(userRequest))
    assert.ok(result?.tools.includes('av'), `${userRequest} 该开 @影音`)
  }
})

test('规则没把握就说没把握：运行项目测试交给下一个 provider，不硬猜能力', async () => {
  assert.equal(await createRuleDecisionProvider().decide(request('运行项目测试')), null)
  const result = await decide(request('运行项目测试'), [
    createRuleDecisionProvider(),
    stub('llm', {
      skills: [],
      tools: ['file'],
      modelTier: null,
      suggestions: [],
      reason: '需要执行命令',
      provider: 'llm',
      latencyMs: 0,
    }),
  ])
  // 用户没提文件，模型猜出来的能力只能进 suggestions，由用户自己开。
  assert.deepEqual(result?.tools, [])
  assert.deepEqual(result?.suggestions, ['file'])
})

test('@文件 的授权边界：模型想要、用户没说，就只建议不代开', async () => {
  const provider = stub('llm', {
    skills: ['jc-duanju'],
    tools: ['file', 'media'],
    modelTier: 'strong',
    suggestions: [],
    reason: 'x',
    provider: 'llm',
    latencyMs: 0,
  })
  const denied = await decide(request('帮我把这部小说整理一下'), [provider])
  assert.deepEqual(denied?.tools, ['media'])
  assert.deepEqual(denied?.suggestions, ['file'])
  // 话里带了文件，同一份结果就放行。
  const granted = await decide(request('帮我把这部小说整理成文件'), [provider])
  assert.deepEqual(granted?.tools, ['file', 'media'])
  assert.deepEqual(granted?.suggestions, [])
})

test('模型挑的 Skill 必须被它自己声明的 triggers 佐证，否则退回不挂', async () => {
  // 真实场景：jc-juben-yingyi 只做中译英，模型却把它挂到「翻译成中文」上，理由是「反向操作」。
  const candidates: DecisionCandidate[] = [
    {
      id: 'jc-juben-yingyi',
      kind: 'skill',
      label: 'jc-juben-yingyi',
      description: '把中文剧本翻译成英文剧本。只做中译英，不改剧情。',
      triggers: ['剧本翻译', '中译英'],
    },
  ]
  // 闸门只对模型层执行：模型是自由发挥，方向相反的错得拦。
  assert.deepEqual(
    gateSkillsByOwnTriggers(['jc-juben-yingyi'], {
      userRequest: '把上面的提示词翻译成中文，放入Wiki里',
      candidates,
    }),
    [],
  )
  // 真命中作者写的关键词时才放行。
  assert.deepEqual(
    gateSkillsByOwnTriggers(['jc-juben-yingyi'], {
      userRequest: '把这个剧本翻译成英文剧本',
      candidates,
    }),
    ['jc-juben-yingyi'],
  )
})

// 修的是这个：bench.py 里打分器单独测 93%，接进产品链路只剩 79%。
// 14 条漏选全是「打分器排第 1、分数 0.84~0.997，却被触发器闸门毙掉」——
// 触发词是「写打戏」「把素材写成短剧」这种短语，本来就匹配不上自然句。
// 语义判断的结论不该被字面匹配推翻，所以闸门现在只管模型层。
test('打分器的语义结论不被字面触发器推翻', async () => {
  const candidates: DecisionCandidate[] = [
    {
      id: 'jc-daxi',
      kind: 'skill',
      label: '打戏',
      description: '写打戏动作设计。',
      // 真实触发词就是这个形式：短语，不含用户那句话里的连续子串。
      triggers: ['写打戏', '搏斗分镜'],
    },
  ]
  const scorerSays = stub('scorer', {
    skills: ['jc-daxi'],
    tools: [],
    modelTier: null,
    suggestions: [],
    reason: '本地打分器',
    provider: 'scorer',
    latencyMs: 0,
  })
  const result = await decide({ userRequest: '帮我写一段两个人巷战的打戏', candidates }, [scorerSays])
  assert.deepEqual(result?.skills, ['jc-daxi'])
  assert.equal(result?.provider, 'scorer')
})

test('没写 triggers 的 Skill 无从复核，尊重模型的判断', async () => {
  const candidates: DecisionCandidate[] = [
    {
      id: 'no-triggers',
      kind: 'skill',
      label: 'no-triggers',
      description: '什么都干',
      triggers: [],
    },
  ]
  const result = await decide({ userRequest: '帮我处理一下这个', candidates }, [
    stub('llm', {
      skills: ['no-triggers'],
      tools: [],
      modelTier: null,
      suggestions: [],
      reason: '',
      provider: 'llm',
      latencyMs: 0,
    }),
  ])
  assert.deepEqual(result?.skills, ['no-triggers'])
})

test('决策层是增强不是单点：provider 抛错返回 null，发送照旧', async () => {
  const failing: DecisionProvider = {
    id: 'boom',
    decide: async () => {
      throw new Error('上游 500')
    },
  }
  assert.equal(await decide(request('把当前剧本翻译成英文'), [failing]), null)
  // 前一个挂掉不影响后一个接力。
  const chained = await decide(request('把当前剧本翻译成英文'), [
    failing,
    stub('rule', {
      skills: ['jc-juben-yingyi'],
      tools: [],
      modelTier: null,
      suggestions: [],
      reason: 'r',
      provider: 'rule',
      latencyMs: 0,
    }),
  ])
  assert.deepEqual(chained?.skills, ['jc-juben-yingyi'])
  assert.equal(chained?.provider, 'rule')
})

test('模型返回的候选清单外的 id 一律丢弃', () => {
  const parsed = parseDecisionOutput(
    '{"skills":["jc-duanju","随便编的Skill","jc-novel"],"tools":["file","rm-rf"],"modelTier":"heroic","reason":"x"}',
    CANDIDATES,
  )
  // 候选清单外的 id 丢弃，且 Skill 只留最匹配的一个。
  assert.deepEqual(parsed?.skills, ['jc-duanju'])
  assert.deepEqual(parsed?.tools, ['file'])
  assert.equal(parsed?.modelTier, null)
})

test('模型返回非 JSON 时判为没把握，而不是猜一个', () => {
  assert.equal(parseDecisionOutput('我觉得应该用剧本翻译那个', CANDIDATES), null)
  assert.equal(parseDecisionOutput('```json\n{"skills":[]}\n```', CANDIDATES)?.skills.length, 0)
})

test('决策提示词是封闭选择题：只列候选，且要求拿不准就不改模型', () => {
  const prompt = buildDecisionPrompt(request('把当前剧本翻译成英文'))
  assert.match(prompt, /- jc-juben-yingyi：/)
  assert.match(prompt, /keep \/ light \/ medium \/ strong/)
  assert.doesNotMatch(prompt, /日志|系统提示/)
})

test('命中更具体的词优先：短剧剧本 赢过 剧本', async () => {
  // 实测：两者各命中 1 条，只比条数就按目录顺序定胜负，结果把导演分镜挂到「写短剧剧本」上。
  const candidates: DecisionCandidate[] = [
    {
      id: 'jc-daoyan-fenjing',
      kind: 'skill',
      label: 'jc-daoyan-fenjing',
      description: '导演分镜',
      triggers: ['剧本'],
    },
    {
      id: 'jc-duanju',
      kind: 'skill',
      label: 'jc-duanju',
      description: '短剧剧本创作',
      triggers: ['短剧剧本'],
    },
  ]
  const result = await createRuleDecisionProvider().decide({
    userRequest: '帮我写一个短剧剧本',
    candidates,
  })
  assert.deepEqual(result?.skills, ['jc-duanju'])
})

test('描述里的泛词不再参与匹配：提到「人物」不该挂上打戏 Skill', async () => {
  // jc-daxi 的描述里有「根据用户提供的剧情、人物、场景」——扫散文就会把「人物」当关键词。
  const candidates: DecisionCandidate[] = [
    {
      id: 'jc-daxi',
      kind: 'skill',
      label: 'jc-daxi',
      description: '根据用户提供的剧情、人物、场景或粗略动作构思，编写打戏提示词',
      // 照抄 jc-daxi 的真实 triggers。
      triggers: ['写打戏', '打戏提示词', '动作戏'],
    },
  ]
  assert.equal(
    await createRuleDecisionProvider().decide({ userRequest: '生成一张人物照片', candidates }),
    null,
  )
  // 真提到打戏时才认。
  assert.deepEqual(
    (
      await createRuleDecisionProvider().decide({
        userRequest: '帮我把这段写成打戏提示词',
        candidates,
      })
    )?.skills,
    ['jc-daxi'],
  )
})

test('ASCII 关键词必须整词命中：wi 不许命中 Wiki', async () => {
  // 用户实测报的错：描述被按 80 字硬切断出尾巴上的 `wi`，而消息里有「Wiki」，
  // includes 判成命中了，于是一个错 Skill 被强制挂上来。
  const candidates: DecisionCandidate[] = [
    {
      id: 'jc-gaibian-silu',
      kind: 'skill',
      label: 'jc-gaibian-silu',
      description: '改编思路',
      triggers: ['wi', 'translate'],
    },
  ]
  assert.equal(
    await createRuleDecisionProvider().decide({
      userRequest: '把上面的提示词翻译成中文，放入Wiki里',
      candidates,
    }),
    null,
  )
  // 整体出现时才认。
  assert.deepEqual(
    (
      await createRuleDecisionProvider().decide({
        userRequest: '把 wi 这块改一下并且 translate',
        candidates,
      })
    )?.skills,
    ['jc-gaibian-silu'],
  )
})

test('CJK 没有词边界，仍按子串判断', async () => {
  const candidates: DecisionCandidate[] = [
    {
      id: 'jc-duanju',
      kind: 'skill',
      label: 'jc-duanju',
      description: '创作短剧剧本',
      triggers: ['短剧剧本'],
    },
  ]
  assert.deepEqual(
    (
      await createRuleDecisionProvider().decide({
        userRequest: '帮我写一个短剧剧本',
        candidates,
      })
    )?.skills,
    ['jc-duanju'],
  )
})

// skillbox 的做法：关键字撞词不算匹配，只有评分层能定。
// 「小说」在「写一部小说」「把小说翻译成英文」「这部小说帮我总结一下」里是同一个词，
// 前者该挂写小说的 Skill，后两者不该 —— 规则层分不出来，所以只命中一个短词时不结论。
test('只命中一个短词时不下结论，交给评分那一层', async () => {
  const candidates: DecisionCandidate[] = [
    {
      id: 'jc-novel',
      kind: 'skill',
      label: 'jc-novel',
      description: '创作长篇网文或连载小说',
      triggers: ['小说', '写小说'],
    },
  ]
  for (const userRequest of [
    '帮我把小说翻译成英文',
    '这部小说太长了帮我总结一下',
    // 改写说法也只命中「小说」一个词：绕一次评分层，换正确的判断。
    '帮我写一部关于口红的小说',
  ]) {
    assert.equal(
      await createRuleDecisionProvider().decide({ userRequest, candidates }),
      null,
      `${userRequest} 不该由规则层直接定 Skill`,
    )
  }
  // 作者写进 triggers 的那句原话仍然秒回，不用等一次模型往返。
  assert.deepEqual(
    (
      await createRuleDecisionProvider().decide({
        userRequest: '帮我写小说',
        candidates,
      })
    )?.skills,
    ['jc-novel'],
  )
})

test('提示词里的描述按分隔符截断，不切出半个词', () => {
  // 20 遍「很长的描述、」（122 字）只有越过 400 字上限才会被截。
  const candidates: DecisionCandidate[] = [
    {
      id: 'x',
      kind: 'skill',
      label: 'x',
      description: `${'很长的描述、'.repeat(80)}末尾`,
      triggers: [],
    },
  ]
  const prompt = buildDecisionPrompt({ userRequest: '随便', candidates })
  const line = prompt.split('\n').find(item => item.startsWith('- x：'))!
  assert.match(line, /、…$/)
})

test('短描述原样进提示词，限定条件不许被切掉', () => {
  // jc-juben-yingyi 的真实形状：结尾的限定条件是路由判对的关键。
  const description =
    'Use when 用户要把中文剧本、对白或分场翻译成英文剧本，或要求译文达到美剧原生对白水准、角色各有声音、按专业剧本格式交付时。只做中译英，不改剧情。'
  const candidates: DecisionCandidate[] = [
    { id: 'jc-juben-yingyi', kind: 'skill', label: 'jc-juben-yingyi', description, triggers: [] },
  ]
  const prompt = buildDecisionPrompt({ userRequest: '随便', candidates })
  assert.match(prompt, /只做中译英，不改剧情。/)
  assert.doesNotMatch(prompt, /…/)
})

test('「放入Wiki里」算文件写入意图，@文件 该开', async () => {
  // 用户实测报的错：「放入Wiki里」没被认出来，于是 @文件 没开、模型只能把结果留在聊天里，
  // 没真正落盘。原词表只有「保存/写入/文件/目录」这类写法，漏了「放入/放迲/wiki」。
  const candidates: DecisionCandidate[] = [
    {
      id: 'file',
      kind: 'tool',
      label: '文件',
      description: '读取、创建、修改和保存当前项目中的文件',
    },
  ]
  const message = '把上面的提示词翻译成中文，放入Wiki里'
  assert.equal(isToolGrantedByUser('file', message), true)
  assert.deepEqual(
    (await createRuleDecisionProvider().decide({ userRequest: message, candidates }))?.tools,
    ['file'],
  )
  // 只有要联网搜索就没道理送本机全权（@文件 含终端、零弹窗）。
  assert.equal(isToolGrantedByUser('file', '打开网络搜索，搜索一下今天有哪些直播的新闻'), false)
})

test('MCP 服务按自己声明的工具关键词被选中，无关服务不被误选', async () => {
  // McpServerConfig 没有 description 字段，工具名与工具说明是唯一可信的信号。
  const searchServer: DecisionCandidate = {
    id: 'mcp__search',
    kind: 'tool',
    label: '搜索',
    description: '已连接的外部 MCP 服务「搜索」，可提供：search（搜索网页并返回结果）',
    triggers: ['搜索', 'search（搜索网页并返回结果）'],
  }
  const unrelated: DecisionCandidate = {
    id: 'mcp__github',
    kind: 'tool',
    label: 'GitHub',
    description: '已连接的外部 MCP 服务「GitHub」，可提供：create_pr（创建拉取请求）',
    triggers: ['GitHub', 'create_pr（创建拉取请求）'],
  }
  const message = '打开网络搜索，搜索一下今天有哪些直播的新闻'
  assert.deepEqual(
    (
      await createRuleDecisionProvider().decide({
        userRequest: message,
        candidates: [searchServer, unrelated],
      })
    )?.tools,
    ['mcp__search'],
  )
  assert.equal(
    await createRuleDecisionProvider().decide({ userRequest: message, candidates: [unrelated] }),
    null,
  )
})

test('「以图片的形式发我」算内容排版，要开 @排版', async () => {
  // 用户实测：说「写一个小红书的长文，以图片的形式发我」，@排版 没开，模型只能回
  // 「无法直接生成二进制图片」。原规则表只认「文档/网页/幻灯片/海报排版」。
  const candidates: DecisionCandidate[] = [
    { id: 'media', kind: 'tool', label: '排版', description: '创建文档、网页、长图和幻灯片' },
    { id: 'av', kind: 'tool', label: '影音', description: '生成图片、视频和音频' },
  ]
  const mediaPhrasings = [
    '写一个小红书的长文，以图片的形式发我',
    '把上面这段做成图片',
    '生成长图',
    '整理成图文卡片',
    '导出成图片给我',
  ]
  for (const userRequest of mediaPhrasings)
    assert.deepEqual(
      (await createRuleDecisionProvider().decide({ userRequest, candidates }))?.tools,
      ['media'],
      userRequest,
    )
  // AI 生图仍然走 @影音，没被改坏。
  assert.deepEqual(
    (
      await createRuleDecisionProvider().decide({
        userRequest: '生成一张人物照片',
        candidates,
      })
    )?.tools,
    ['av'],
  )
})

test('@Jev 只从 @ 提及进入，且在发送链路的最前面回填芯片', () => {
  const workbench = readFileSync(
    join(process.cwd(), 'src/components/memory/MemoryWorkbench.vue'),
    'utf8',
  )
  assert.match(workbench, /type: 'tool', id: 'jev', display: 'Jev'/)
  // 输入框下沿的常驻开关、以及那个菜单里的同名项都已撤（用户 2026-09-20 要求，
  // 他自己用 @ 时才开）。范围切片里搜，别全局搜 id: 'jev' —— enableTool /
  // disableTool 里合法地还有它。
  assert.doesNotMatch(workbench, /\{ id: 'jev', label: '@Jev'/)
  const strip = workbench.slice(
    workbench.indexOf('const toolCommands = ['),
    workbench.indexOf('const primaryCommands'),
  )
  assert.ok(!strip.includes("id: 'jev'"), '输入框下沿的指令条里不该再有 @Jev')
  // 开它的唯一路径是 @ 提及里选中 / 取消。
  assert.match(workbench, /if \(id === 'jev'\) jevSelected\.value = true/)
  assert.match(workbench, /if \(id === 'jev'\) jevSelected\.value = false/)
  // 决策必须发生在所有发送快照之前，否则本轮发出去的还是决策前的空选择。
  assert.match(
    workbench,
    /if \(jevSelected\.value\) await applyJevDecision\(message\)\s*\n\s*const useHarness = desktopOnlyRuntime\s*\n\s*const skillSnapshot = selectedSkillNames\.value\.slice\(\)/,
  )
  // 决策结果只能落成芯片与模型选择；执行器由平台固定，不由 Jev 切换。
  assert.match(workbench, /for \(const id of result\.tools\) enableTool\(id\)/)
  // 选中的 Skill 与芯片已经在 chip 行里看得见，说明行不得再复述一遍（用户实测报的噪音）。
  assert.doesNotMatch(workbench, /@Jev 已选：/)
  // 但 chip 行看不到的两件事要留：模型档位被动过、还有能力需要用户自己开。
  assert.match(workbench, /notes\.push\(`模型切到 \$\{result\.modelTier\} 档`\)/)
  assert.match(workbench, /需要你自己开/)
  // 决策没选到 Skill 时不得清空用户自己点的 Skill。
  assert.match(
    workbench,
    /if \(result\.skills\.length\) \{\s*\n\s*selectedSkillNames\.value = result\.skills/,
  )
})

test('决策层只有选择权：不引入任何执行器、终端或文件写入', () => {
  const root = join(process.cwd(), 'src/runtime/decision')
  const stripComments = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const name of readdirSync(root).filter(file => file.endsWith('.ts'))) {
    const code = stripComments(readFileSync(join(root, name), 'utf8'))
    assert.doesNotMatch(
      code,
      /invoke\(|@tauri-apps|child_process|createWebProjectToolExecutor|createDesktopProjectToolExecutor|runMemoryChat/,
    )
    assert.doesNotMatch(code, /\bterminal\b/)
  }
  // 决策层只依赖既有的 Skill 适用性判断与 API 工具，没有自造一套 Registry / Tier / Trace。
  const providers = readFileSync(join(root, 'providers.ts'), 'utf8')
  assert.match(providers, /from '@\/runtime\/connection\/skillApplicability'/)
  assert.match(providers, /resolveSkillApplicability/)
})

// 用户实测：点发送后按钮一直是亮的、点了却没反应，其实是在等决策。
// 根因是决策用了带重试的请求路径（3 次重试把 30s 上限放大成 96s），而发送被它挡着。
test('决策有总预算：provider 挂着不返回也要按时退回手动模式', async () => {
  const hung: DecisionProvider = { id: 'hang', decide: () => new Promise<never>(() => {}) }
  const startedAt = Date.now()
  const result = await decide(
    { userRequest: '我想写一部关于口红的小说', candidates: CANDIDATES },
    [hung],
    40,
  )
  assert.equal(result, null, '超时等于没把握，不改任何芯片')
  assert.ok(Date.now() - startedAt < 2000, '必须在预算内返回，不能把发送按住')
})

test('决策请求不走重试路径，且发送按钮看得见决策中的状态', () => {
  const providers = readFileSync(join(process.cwd(), 'src/runtime/decision/providers.ts'), 'utf8')
  assert.doesNotMatch(providers, /sendDirectRequestWithRetry/)
  const workbench = readFileSync(
    join(process.cwd(), 'src/components/memory/MemoryWorkbench.vue'),
    'utf8',
  )
  // 发送锁非响应式时，按钮看着是亮的、点了却被静默吐掉——这就是「点不动」的观感。
  assert.match(workbench, /const sendInFlight = ref\(false\)/)
  assert.match(workbench, /:disabled="sendInFlight \|\| \(!input\.trim\(\)/)
  // 决策期间的等待要有提示语，不能什么都不显示。
  assert.match(workbench, /@Jev 正在判断这一轮该用哪个 Skill/)
})

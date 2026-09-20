import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { decide } from '@/runtime/decision'
import {
  buildDecisionPrompt,
  createRuleDecisionProvider,
  isToolGrantedByUser,
  parseDecisionOutput,
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
    label: '图文',
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
  const result = await decide(request('帮我写一个短剧剧本'))
  assert.deepEqual(result?.skills, ['jc-duanju'])
  assert.deepEqual(result?.tools, [])
  assert.equal(result?.modelTier, 'strong')
  assert.equal(result?.provider, 'rule')
})

test('规则命中：翻译剧本选中翻译 Skill，用户没提文件就不开 @文件', async () => {
  const result = await decide(request('把当前剧本翻译成英文'))
  // 只取最匹配的一个：多挂一个 Skill 就多注入一份 SKILL.md 全文。
  assert.deepEqual(result?.skills, ['jc-juben-yingyi'])
  assert.deepEqual(result?.tools, [])
})

test('规则命中：用户自己说了「保存到项目里」，才允许代开 @文件', async () => {
  const result = await decide(request('把当前剧本翻译成英文，然后保存到项目里'))
  assert.deepEqual(result?.skills, ['jc-juben-yingyi'])
  assert.deepEqual(result?.tools, ['file'])
  assert.deepEqual(result?.suggestions, [])
})

test('规则命中：生成照片开 @影音', async () => {
  const result = await decide(request('生成一张人物照片'))
  assert.deepEqual(result?.tools, ['av'])
})

// 用户实测：让 @Jev 挑「写视频提示词」的 Skill，它却开了 @影音（会真的去调生视频模型）。
// 「文生视频」「生成图片」在这类句子里是模式名，说明这段字写给谁用，不是要出片。
// 规则层扫不到该开的 Skill 时返回 null 交给下一个 provider，也算正确结果。
test('要一段文字时不开产出型能力：写视频提示词不开 @影音', async () => {
  const provider = createRuleDecisionProvider()
  for (const userRequest of [
    '根据上面的内容写一个MiniMax的文生视频的视频提示词',
    '帮我写一个生成视频的提示词',
    '写一段海报的提示词',
  ]) {
    const result = await provider.decide(request(userRequest))
    assert.ok(!(result?.tools || []).includes('av'), `${userRequest} 不该开 @影音`)
  }
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
  const modelSays = stub('llm', {
    skills: ['jc-juben-yingyi'],
    tools: [],
    modelTier: null,
    suggestions: [],
    reason: '反向操作',
    provider: 'llm',
    latencyMs: 0,
  })
  assert.equal(
    await decide({ userRequest: '把上面的提示词翻译成中文，放入Wiki里', candidates }, [modelSays]),
    null,
  )
  // 真命中作者写的关键词时才放行。
  assert.deepEqual(
    (await decide({ userRequest: '把这个剧本翻译成英文剧本', candidates }, [modelSays]))?.skills,
    ['jc-juben-yingyi'],
  )
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
      triggers: ['剧本'],
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

test('「以图片的形式发我」算图文排版，要开 @图文', async () => {
  // 用户实测：说「写一个小红书的长文，以图片的形式发我」，@图文 没开，模型只能回
  // 「无法直接生成二进制图片」。原规则表只认「文档/网页/幻灯片/海报排版」。
  const candidates: DecisionCandidate[] = [
    { id: 'media', kind: 'tool', label: '图文', description: '创建文档、网页、图片和幻灯片' },
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

test('@Jev 接在输入框的提及列表里，且在发送链路的最前面回填芯片', () => {
  const workbench = readFileSync(
    join(process.cwd(), 'src/components/memory/MemoryWorkbench.vue'),
    'utf8',
  )
  assert.match(workbench, /type: 'tool', id: 'jev', display: 'Jev'/)
  assert.match(workbench, /\{ id: 'jev', label: '@Jev', icon: 'alt-route'/)
  // 指令条（输入框下面那排）里 @Jev 必须排在 @Skill 左边——用户指定的位置。
  const strip = workbench.slice(workbench.indexOf('const toolCommands = ['))
  assert.ok(
    strip.indexOf("id: 'jev'") >= 0 && strip.indexOf("id: 'jev'") < strip.indexOf("id: 'skill'"),
    '指令条里 @Jev 要排在 @Skill 左边',
  )
  assert.match(workbench, /if \(command\.id === 'jev'\) jevSelected\.value = true/)
  // 决策必须发生在 skillSnapshot 之前，否则本轮发出去的还是决策前的空选择。
  assert.match(
    workbench,
    /if \(jevSelected\.value\) await applyJevDecision\(message\)\s*\n\s*const skillSnapshot = selectedSkillNames\.value\.slice\(\)/,
  )
  // 决策结果只能落成芯片与模型选择；执行仍然交给 runMemoryChat。
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

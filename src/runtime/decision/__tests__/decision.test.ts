import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { decide } from '@/runtime/decision'
import {
  buildDecisionPrompt,
  createRuleDecisionProvider,
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
  { id: 'media', kind: 'tool', label: '图文', description: '创建文档、网页、图片和幻灯片' },
  { id: 'av', kind: 'tool', label: '影音', description: '生成图片、视频和音频' },
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

test('@Jev 接在输入框的提及列表里，且在发送链路的最前面回填芯片', () => {
  const workbench = readFileSync(
    join(process.cwd(), 'src/components/memory/MemoryWorkbench.vue'),
    'utf8',
  )
  assert.match(workbench, /type: 'tool', id: 'jev', display: 'Jev'/)
  assert.match(workbench, /\{ id: 'jev', label: '@Jev', icon: 'alt-route'/)
  // 决策必须发生在 skillSnapshot 之前，否则本轮发出去的还是决策前的空选择。
  assert.match(
    workbench,
    /if \(jevSelected\.value\) await applyJevDecision\(message\)\s*\n\s*const skillSnapshot = selectedSkillNames\.value\.slice\(\)/,
  )
  // 决策结果只能落成芯片与模型选择；执行仍然交给 runMemoryChat。
  assert.match(workbench, /for \(const id of result\.tools\) enableTool\(id\)/)
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

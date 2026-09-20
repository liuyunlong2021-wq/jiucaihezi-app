/**
 * 决策路由的中文基准跑分。判据、用例见同目录 cases.json。
 *
 * 三种跑法：
 *   --provider rule  只跑规则层（毫秒级，离线）
 *   --provider scorer 跑产品链路（规则 + 本地打分器），需要 serve.py 在 4789 上
 *   --provider chain 跑完整链路（规则 → 云端/本地模型），需要能调模型
 *   --provider llm   跳过规则层，只跑模型层（看模型层单独有多强）
 * 加 --split test 只看留出集；--min 0.8 低于阈值就退出码 1（给 CI 用）。
 *
 * 候选来自真实 Skill 库（~/.agents/skills）+ 四个能力芯片，和 MemoryWorkbench.decisionCandidates
 * 同源；不读界面代码，所以这里量的是「决策」不是「界面」。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createLlmDecisionProvider, createRuleDecisionProvider, decide } from '@/runtime/decision'
import { createLocalScorerProvider } from '@/runtime/decision/localScorer'
import type { DecisionCandidate, DecisionProvider } from '@/runtime/decision/types'
import { parseSkillMd, stripYamlQuotes } from '@/types/skill'

type Case = {
  id: string
  split: 'train' | 'test'
  task: string
  expectSkills: string[]
  expectTools?: string[]
  forbidTools?: string[]
  note?: string
}

const args = process.argv.slice(2)
const argValue = (name: string, fallback = '') => {
  const index = args.indexOf(name)
  return index >= 0 ? String(args[index + 1] || '') : fallback
}
const provider = argValue('--provider', 'rule')
const splitFilter = argValue('--split', '')
const modelId = argValue('--model', '')
const minAccuracy = Number(argValue('--min', '0')) || 0

// 用例路径按仓库根算：这个文件会被打成单文件丢进临时目录，import.meta.url 不再是源码位置。
const casesPath = join(process.cwd(), 'scripts', 'jev-eval', 'cases.json')
const cases = (JSON.parse(readFileSync(casesPath, 'utf8')) as { cases: Case[] }).cases.filter(
  item => !splitFilter || item.split === splitFilter,
)

/** 候选和 MemoryWorkbench 同源：四个芯片 + 用户 Skill 库。 */
function buildCandidates(): DecisionCandidate[] {
  const candidates: DecisionCandidate[] = [
    { id: 'file', kind: 'tool', label: '文件', description: '读取、创建、修改和保存当前项目中的文件' },
    { id: 'media', kind: 'tool', label: '图文', description: '把内容排成文档、网页、长图、幻灯片并导出成文件' },
    { id: 'av', kind: 'tool', label: '影音', description: '调用生图、生视频、配音模型，真的产出图片、视频、音频文件' },
  ]
  const root = join(homedir(), '.agents', 'skills')
  if (!existsSync(root)) return candidates
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    const file = join(root, dir.name, 'SKILL.md')
    if (!existsSync(file)) continue
    const parsed = parseSkillMd(readFileSync(file, 'utf8'), dir.name)
    candidates.push({
      id: dir.name,
      kind: 'skill',
      label: String(parsed.displayName || dir.name),
      description: String(parsed.description || '').replace(/\s+/g, ' ').trim() || '本地 Skill',
      triggers: (parsed.triggers || []).map(value => stripYamlQuotes(String(value))),
    })
  }
  return candidates
}

function buildChain(): DecisionProvider[] {
  const rule = createRuleDecisionProvider()
  if (provider === 'rule') return [rule]
  if (provider === 'scorer') return [createLocalScorerProvider(), rule]
  if (provider === 'scorer-only') return [createLocalScorerProvider()]
  if (provider === 'llm') return [createLlmDecisionProvider(() => (modelId ? [{ modelId, providerId: 'local-ollama' }] : []))]
  return [rule, createLlmDecisionProvider(() => (modelId ? [{ modelId, providerId: 'local-ollama' }] : []))]
}

const candidates = buildCandidates()
const chain = buildChain()

/**
 * 导出交叉编码器要的 (任务, 候选) 对 —— 每条用例 × 每个候选 Skill，命中标 1，其余标 0。
 * 关键是**负例是白送的**：把「把这部小说翻译成英文」标成 expect [] 之后，jc-novel 这一对
 * 自动成为「话题沾边但没用」的负例，正是最难学的那类。每行（Python 侧不用再解析 SKILL.md）：
 *   case_id \t split \t task \t skill_id \t label \t description \t triggers
 */
const emitPairsPath = argValue('--emit-pairs', '')
if (emitPairsPath) {
  const lines = cases.flatMap(item =>
    candidates
      .filter(candidate => candidate.kind === 'skill')
      .map(candidate => {
        const label = item.expectSkills.includes(candidate.id) ? '1' : '0'
        return [
          item.id,
          item.split,
          item.task,
          candidate.id,
          label,
          String(candidate.description || '').replace(/\s+/g, ' '),
          (candidate.triggers || []).join('、'),
        ].join('\t')
      }),
  )
  writeFileSync(emitPairsPath, `${lines.join('\n')}\n`)
  const positives = lines.filter(line => line.split('\t')[4] === '1').length
  console.log(`已导出 ${lines.length} 对到 ${emitPairsPath}（正例 ${positives}）`)
  process.exit(0)
}

type Failure = { id: string; split: string; task: string; expected: string; got: string; kind: string; note?: string }
const failures: Failure[] = []
let passed = 0
let passedTest = 0
let testTotal = 0
const startedAt = Date.now()

for (const item of cases) {
  const result = await decide({ userRequest: item.task, candidates }, chain)
  const skills = [...(result?.skills || [])].sort()
  const tools = [...(result?.tools || [])].sort()
  const expectedSkills = [...item.expectSkills].sort()

  const problems: string[] = []
  if (skills.join('|') !== expectedSkills.join('|'))
    problems.push(`Skill 期望 ${JSON.stringify(expectedSkills)} 实际 ${JSON.stringify(skills)}`)
  for (const tool of item.expectTools || [])
    if (!tools.includes(tool)) problems.push(`少了能力 ${tool}`)
  for (const tool of item.forbidTools || [])
    if (tools.includes(tool)) problems.push(`不该开 ${tool}`)

  if (item.split === 'test') testTotal += 1
  if (!problems.length) {
    passed += 1
    if (item.split === 'test') passedTest += 1
    continue
  }
  failures.push({
    id: item.id,
    split: item.split,
    task: item.task,
    expected: expectedSkills.join(', ') || '（空）',
    got: skills.join(', ') || '（空）',
    note: item.note,
    kind:
      expectedSkills.length === 0
        ? '误选'
        : skills.length === 0
          ? '漏选'
          : '选错',
  })
}

const rate = (hit: number, total: number) => (total ? `${((hit / total) * 100).toFixed(0)}%` : '—')
console.log(`\n候选 ${candidates.length} 个 ｜ provider=${provider}${modelId ? ` (${modelId})` : ''} ｜ 用例 ${cases.length} 条`)
console.log(`通过 ${passed}/${cases.length} = ${rate(passed, cases.length)}`)
if (testTotal) console.log(`留出集 test：${passedTest}/${testTotal} = ${rate(passedTest, testTotal)}`)
console.log(`耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)

if (failures.length) {
  const byKind = failures.reduce<Record<string, number>>((acc, item) => {
    acc[item.kind] = (acc[item.kind] || 0) + 1
    return acc
  }, {})
  console.log('失败分类：', JSON.stringify(byKind))
  console.log('\n失败明细：')
  for (const item of failures) {
    console.log(`  [${item.split}] ${item.id}  「${item.task}」`)
    console.log(`      期望 ${item.expected} ｜ 实际 ${item.got}${item.note ? ` ｜ ${item.note}` : ''}`)
  }
}

if (minAccuracy && passed / cases.length < minAccuracy) {
  console.log(`\n低于门槛 ${minAccuracy}，退出码 1`)
  process.exit(1)
}

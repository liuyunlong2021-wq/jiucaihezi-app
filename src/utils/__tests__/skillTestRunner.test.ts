import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ALL_SKILL_TOOLS,
  aggregateBenchmark,
  buildDescriptionOptimizationPrompt,
  extractSkillMdFromModelOutput,
  packageSkillDraft,
  validateSkillDraft,
  runSkillTests,
  buildBlindComparison,
} from '../skillTestRunner'
import { __resetApiKeyMemoryCacheForTests } from '../../services/newApiClient'

const validSkillMd = `---
name: storyboard-helper
description: Use this skill whenever the user asks for short-video storyboard planning, shot breakdowns, or visual continuity checks.
---

# Storyboard Helper

Help users turn a short-video idea into a shot-by-shot storyboard.
`

function installSkillRunnerLocalStorage(values: Record<string, string> = {}) {
  const previous = (globalThis as any).localStorage
  const previousWindow = (globalThis as any).window
  const store = new Map<string, string>(Object.entries(values))
  ;(globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  }
  ;(globalThis as any).window = { location: { href: 'http://localhost/' } }
  return () => {
    ;(globalThis as any).localStorage = previous
    ;(globalThis as any).window = previousWindow
  }
}

test('Skill缔造 exposes the official lifecycle tools without changing 素材转Skill', () => {
  assert.deepEqual(ALL_SKILL_TOOLS.map(tool => tool.function.name), [
    'skill_creator_load_installed_skill',
    'skill_creator_validate',
    'run_skill_tests',
    'skill_creator_aggregate_benchmark',
    'skill_creator_open_eval_review',
    'skill_creator_submit_eval_feedback',
    'skill_creator_load_eval_feedback',
    'skill_creator_compare_outputs',
    'skill_creator_analyze_comparison',
    'skill_creator_improve_description',
    'skill_creator_package',
    'save_skill',
  ])
})

test('validateSkillDraft enforces official Skill frontmatter and package paths', () => {
  const ok = validateSkillDraft(validSkillMd, [
    { path: 'references/source.md', content: '# Source', mimeType: 'text/markdown' },
    { path: 'scripts/helper.py', content: 'print("ok")', mimeType: 'text/x-python' },
  ])

  assert.equal(ok.status, 'ok')
  assert.equal(ok.name, 'storyboard-helper')
  assert.equal(ok.checks.every(check => check.passed), true)

  const bad = validateSkillDraft('name: missing-frontmatter', [
    { path: '../secret.txt', content: 'x', mimeType: 'text/plain' },
  ])

  assert.equal(bad.status, 'error')
  assert.match(bad.message, /YAML frontmatter/)
  assert.equal(bad.checks.some(check => check.id === 'safe_package_paths' && !check.passed), true)
})

test('validateSkillDraft accepts triggers but rejects invalid official field types and limits', () => {
  const extended = validateSkillDraft(validSkillMd.replace(
    '---\n\n# Storyboard',
    'compatibility: Works with Markdown outputs\ntriggers:\n  - 分镜\n  - storyboard\n---\n\n# Storyboard',
  ))
  assert.equal(extended.status, 'ok')

  const badName = validateSkillDraft(validSkillMd.replace('storyboard-helper', 'Storyboard--Helper'))
  assert.equal(badName.status, 'error')
  assert.equal(badName.checks.some(check => check.id === 'valid_name' && !check.passed), true)

  const badDescription = validateSkillDraft(validSkillMd.replace(
    'description: Use this skill whenever the user asks for short-video storyboard planning, shot breakdowns, or visual continuity checks.',
    'description: [not, a, string]',
  ))
  assert.equal(badDescription.status, 'error')
  assert.equal(badDescription.checks.some(check => check.id === 'valid_description' && !check.passed), true)

  const badTriggers = validateSkillDraft(validSkillMd.replace('---\n\n# Storyboard', 'triggers: wrong\n---\n\n# Storyboard'))
  assert.equal(badTriggers.status, 'error')
  assert.equal(badTriggers.checks.some(check => check.id === 'valid_triggers' && !check.passed), true)
})

test('packageSkillDraft returns a deterministic local package manifest without saving user data', () => {
  const packaged = packageSkillDraft(validSkillMd, [
    { path: 'references/source.md', content: '# Source', title: 'Source', mimeType: 'text/markdown' },
  ])

  assert.equal(packaged.status, 'ok')
  assert.equal(packaged.name, 'storyboard-helper')
  assert.equal(packaged.package_file_name, 'storyboard-helper.skill')
  assert.deepEqual(packaged.asset_index.map(asset => asset.path), ['SKILL.md', 'references/source.md'])
  assert.equal(packaged.manifest.skill.name, 'storyboard-helper')
})

test('buildDescriptionOptimizationPrompt follows the official trigger optimization loop', () => {
  const prompt = buildDescriptionOptimizationPrompt({
    skillMd: validSkillMd,
    userIntent: '用户希望它在短视频分镜、镜头拆解、连续性检查时稳定命中。',
    feedback: '测试里“镜头 continuity”没有触发。',
    benchmarkNotes: ['without_skill 也通过，description 区分度不足'],
  })

  assert.match(prompt, /Optimize only the YAML description/)
  assert.match(prompt, /storyboard-helper/)
  assert.match(prompt, /镜头 continuity/)
  assert.match(prompt, /without_skill 也通过/)
})

test('extractSkillMdFromModelOutput reads a complete optimized SKILL.md from markdown fences', () => {
  const optimized = extractSkillMdFromModelOutput([
    '这是优化结果：',
    '```markdown',
    '---',
    'name: storyboard-helper',
    'description: Use this skill whenever users ask for storyboard planning or continuity checks.',
    '---',
    '',
    '# Storyboard Helper',
    '```',
  ].join('\n'))

  assert.match(optimized, /^---\nname: storyboard-helper/m)
  assert.match(optimized, /# Storyboard Helper/)
})

test('runSkillTests caps test case count before making LLM calls', async () => {
  const previousFetch = (globalThis as any).fetch
  let fetchCalls = 0
  try {
    ;(globalThis as any).fetch = async () => {
      fetchCalls += 1
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
    }

    await assert.rejects(
      () => runSkillTests(validSkillMd, Array.from({ length: 13 }, (_, index) => ({
        prompt: `测试 ${index}`,
        expect: '应该稳定命中',
        assertions: [{ text: '输出应该有结果' }],
      }))),
      /测试用例最多/,
    )
    assert.equal(fetchCalls, 0)
  } finally {
    ;(globalThis as any).fetch = previousFetch
  }
})

test('runSkillTests drafts a default assertion from expect when assertions are omitted', async () => {
  const restoreStorage = installSkillRunnerLocalStorage({
    jcModel: 'gpt-5.5',
    jcModelProviderId: 'jiucaihezi',
  })
  const previousFetch = (globalThis as any).fetch
  try {
    __resetApiKeyMemoryCacheForTests('session-cloud')
    ;(globalThis as any).fetch = async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'))
      const prompt = String(body.messages?.at?.(-1)?.content || '')
      if (prompt.includes('返回 JSON 数组')) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: '[{"text":"应该稳定命中","passed":true,"evidence":"ok"}]' } }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'ok 应该稳定命中' } }],
        usage: { total_tokens: 8 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    const results = await runSkillTests(validSkillMd, [{
      prompt: '帮我做分镜',
      expect: '应该稳定命中',
    }])

    const withSkillRun = results.results[0].runs.find(run => run.configuration === 'with_skill')
    assert.equal(withSkillRun?.assertions.length, 1)
    assert.equal(withSkillRun?.assertions[0].text, '应该稳定命中')
    assert.equal(results.summary.withSkillPassRate, 100)
  } finally {
    __resetApiKeyMemoryCacheForTests('')
    ;(globalThis as any).fetch = previousFetch
    restoreStorage()
  }
})

test('aggregateBenchmark marks API failures as errors instead of successful assertions', () => {
  const benchmark = aggregateBenchmark([{
    eval_id: 1,
    eval_name: 'API failure',
    prompt: '测试',
    expect: '应该成功',
    runs: [
      {
        configuration: 'with_skill',
        output: '[API 500]',
        tokenCount: 0,
        durationMs: 1,
        assertions: [{ text: '输出有效', passed: false, evidence: 'API 500' }],
        timing: { total_tokens: 0, duration_ms: 1, total_duration_seconds: 0.001 },
      },
      {
        configuration: 'without_skill',
        output: 'baseline',
        tokenCount: 1,
        durationMs: 1,
        assertions: [{ text: '输出有效', passed: true, evidence: 'baseline' }],
        timing: { total_tokens: 1, duration_ms: 1, total_duration_seconds: 0.001 },
      },
    ],
  }], 'api-failure-skill')

  const withRun = benchmark.runs.find(run => run.configuration === 'with_skill')
  assert.equal(withRun?.result.errors, 1)
  assert.equal(withRun?.result.pass_rate, 0)
})

test('runSkillTests repeats both configurations and uses an installed baseline', async () => {
  const restoreStorage = installSkillRunnerLocalStorage({ jcModel: 'gpt-5.5', jcModelProviderId: 'jiucaihezi' })
  const previousFetch = globalThis.fetch
  try {
    __resetApiKeyMemoryCacheForTests('session-cloud')
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body || '{}'))
      const system = String(body.messages?.[0]?.role === 'system' ? body.messages[0].content : '')
      if (String(body.messages?.at(-1)?.content || '').includes('返回 JSON 数组')) {
        return new Response(JSON.stringify({ choices: [{ message: { content: '[{"text":"ok","passed":true,"evidence":"ok"}]' } }] }), { status: 200 })
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: system.includes('Old Skill') ? 'old' : 'new' } }], usage: { total_tokens: 2 } }), { status: 200 })
    }
    const result = await runSkillTests(validSkillMd, [{ prompt: 'test', expect: 'ok' }], {
      runsPerConfiguration: 2,
      baselineSkillMd: '# Old Skill',
    })
    assert.deepEqual(result.results[0].runs.map(run => run.configuration), ['with_skill', 'installed_version', 'with_skill', 'installed_version'])
    const benchmark = aggregateBenchmark(result.results, 'storyboard-helper', { provider: 'jiucaihezi', model: 'gpt-5.5', revision: 2 })
    assert.deepEqual(benchmark.runs.map(run => run.run_number), [1, 1, 2, 2])
    assert.equal(benchmark.metadata.runs_per_configuration, 2)
    assert.equal(benchmark.metadata.model, 'gpt-5.5')
  } finally {
    __resetApiKeyMemoryCacheForTests('')
    globalThis.fetch = previousFetch
    restoreStorage()
  }
})

test('grader rejects claims about generated files when a run has no artifacts', () => {
  const benchmark = aggregateBenchmark([{ eval_id: 1, eval_name: 'file claim', prompt: 'make file', expect: 'file', runs: [{
    configuration: 'with_skill', output: '已生成 report.csv', tokenCount: 1, durationMs: 1,
    assertions: [{ text: '生成文件', passed: true, evidence: '已生成' }],
    timing: { total_tokens: 1, duration_ms: 1, total_duration_seconds: 0.001 }, transcript: [], outputs: [],
  }] }], 'file-claim')
  assert.equal(benchmark.runs[0].result.pass_rate, 0)
  assert.equal(benchmark.runs[0].claims?.[0].verified, false)
})

test('blind comparison hides configuration labels and is deterministic for a seed', () => {
  const runs = [
    { configuration: 'with_skill' as const, output: 'new output', tokenCount: 1, durationMs: 1, assertions: [], timing: { total_tokens: 1, duration_ms: 1, total_duration_seconds: 0.001 } },
    { configuration: 'installed_version' as const, output: 'old output', tokenCount: 1, durationMs: 1, assertions: [], timing: { total_tokens: 1, duration_ms: 1, total_duration_seconds: 0.001 } },
  ]
  const first = buildBlindComparison(runs, 'eval-1')
  const second = buildBlindComparison(runs, 'eval-1')
  assert.deepEqual(first, second)
  assert.doesNotMatch(JSON.stringify(first.publicInput), /with_skill|installed_version|revision/)
  assert.deepEqual(new Set([first.hiddenMapping.A, first.hiddenMapping.B]), new Set(['with_skill', 'installed_version']))
})

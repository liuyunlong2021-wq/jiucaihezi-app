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
    'skill_creator_validate',
    'run_skill_tests',
    'skill_creator_aggregate_benchmark',
    'skill_creator_open_eval_review',
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

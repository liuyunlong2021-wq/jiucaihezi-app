/**
 * skillTestRunner.ts — Skill测试执行引擎（对齐官方 skill-creator）
 *
 * 对标 anthropics/skills skill-creator 的测试评估流程：
 *   Step 1: Spawn runs (with-skill + without-skill baseline)
 *   Step 2: Draft assertions while running
 *   Step 3: Capture timing
 *   Step 4: Grade + Aggregate + Launch viewer
 *
 * 提供给 LLM 官方生命周期工具：validate / evals / benchmark / review / description optimize / package / save
 */

import { resolveApiConfig, buildHeaders } from '@/utils/api'

const MAX_TEST_CASES = 12

// ═══════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════

export interface Assertion {
  text: string
  passed?: boolean
  evidence?: string
}

export interface TestCase {
  prompt: string
  expect: string
  assertions?: Assertion[]
}

export interface RunResult {
  configuration: 'with_skill' | 'without_skill'
  output: string
  tokenCount: number
  durationMs: number
  assertions: Assertion[]
  timing: {
    total_tokens: number
    duration_ms: number
    total_duration_seconds: number
  }
}

export interface SingleTestResult {
  eval_id: number
  eval_name: string
  prompt: string
  expect: string
  runs: RunResult[]
}

export interface TestResults {
  draftSkillMd: string
  testCases: TestCase[]
  results: SingleTestResult[]
  summary: {
    withSkillPassRate: number
    withoutSkillPassRate: number
    deltaPassRate: string
    totalTests: number
  }
}

export interface BenchmarkStats {
  mean: number
  stddev: number
  min: number
  max: number
}

export interface BenchmarkData {
  metadata: {
    skill_name: string
    timestamp: string
    evals_run: number[]
    runs_per_configuration: number
  }
  runs: BenchmarkRun[]
  run_summary: {
    with_skill: {
      pass_rate: BenchmarkStats
      time_seconds: BenchmarkStats
      tokens: BenchmarkStats
    }
    without_skill: {
      pass_rate: BenchmarkStats
      time_seconds: BenchmarkStats
      tokens: BenchmarkStats
    }
    delta: {
      pass_rate: string
      time_seconds: string
      tokens: string
    }
  }
  notes: string[]
}

export interface SkillValidationCheck {
  id: string
  label: string
  passed: boolean
  message: string
}

export interface SkillValidationResult {
  status: 'ok' | 'error'
  name: string
  description: string
  message: string
  checks: SkillValidationCheck[]
}

export interface SkillPackageReferenceInput {
  path: string
  content: string
  title?: string
  mimeType?: string
}

export interface SkillPackageAsset {
  path: string
  mimeType: string
  bytes: number
  title?: string
}

export interface SkillPackageDraftResult {
  status: 'ok' | 'error'
  name: string
  package_file_name: string
  manifest: {
    schemaVersion: 1
    skill: {
      name: string
      description: string
    }
    assets: SkillPackageAsset[]
    createdAt: string
  }
  asset_index: SkillPackageAsset[]
  message: string
}

interface BenchmarkRun {
  eval_id: number
  eval_name: string
  configuration: string
  run_number: number
  result: {
    pass_rate: number
    passed: number
    failed: number
    total: number
    time_seconds: number
    tokens: number
    errors: number
  }
  expectations: { text: string; passed: boolean; evidence: string }[]
  notes: string[]
}

// ═══════════════════════════════════════════════
// 核心引擎
// ═══════════════════════════════════════════════

const MAX_CONCURRENT = 5
const TEST_TIMEOUT_MS = 60000
const EVAL_TIMEOUT_MS = 15000

function parseFrontmatter(skillMd: string): { body: string; fields: Record<string, string> } | null {
  const normalized = String(skillMd || '').replace(/\r\n/g, '\n')
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return null

  const fields: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!field) continue
    fields[field[1]] = field[2].trim().replace(/^["']|["']$/g, '')
  }
  return { body: match[2] || '', fields }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function isSafePackagePath(path: string): boolean {
  const value = String(path || '').trim().replace(/\\/g, '/')
  if (!value || value.startsWith('/') || value.includes('\0')) return false
  const segments = value.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return false
  if (value === 'SKILL.md') return true
  return /^(references|scripts|assets)\//.test(value)
}

function sanitizePackageName(name: string): string {
  const cleaned = String(name || 'skill')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'skill'
}

export function validateSkillDraft(
  skillMd: string,
  references: SkillPackageReferenceInput[] = [],
): SkillValidationResult {
  const parsed = parseFrontmatter(skillMd)
  const name = parsed?.fields.name || ''
  const description = parsed?.fields.description || ''
  const safePaths = references.every(reference => isSafePackagePath(reference.path))
  const checks: SkillValidationCheck[] = [
    {
      id: 'yaml_frontmatter',
      label: 'YAML frontmatter',
      passed: Boolean(parsed),
      message: parsed ? '已包含标准 YAML frontmatter。' : '缺少官方 Skill 必需的 YAML frontmatter。',
    },
    {
      id: 'required_name',
      label: 'name',
      passed: Boolean(name),
      message: name ? `name 为 ${name}。` : 'frontmatter 里缺少 name。',
    },
    {
      id: 'required_description',
      label: 'description',
      passed: Boolean(description),
      message: description ? 'description 已填写。' : 'frontmatter 里缺少 description。',
    },
    {
      id: 'body_content',
      label: 'body',
      passed: Boolean(parsed?.body.trim()),
      message: parsed?.body.trim() ? 'SKILL.md 正文不为空。' : 'SKILL.md 正文不能为空。',
    },
    {
      id: 'safe_package_paths',
      label: 'package paths',
      passed: safePaths,
      message: safePaths
        ? 'references/scripts/assets 路径均安全。'
        : '资料包路径只能位于 references/、scripts/ 或 assets/ 内，且不能包含 .. 或绝对路径。',
    },
  ]

  const failed = checks.filter(check => !check.passed)
  return {
    status: failed.length ? 'error' : 'ok',
    name,
    description,
    message: failed.length
      ? failed.map(check => check.message).join(' ')
      : 'Skill 草稿通过官方结构校验。',
    checks,
  }
}

export function packageSkillDraft(
  skillMd: string,
  references: SkillPackageReferenceInput[] = [],
): SkillPackageDraftResult {
  const validation = validateSkillDraft(skillMd, references)
  if (validation.status !== 'ok') {
    return {
      status: 'error',
      name: validation.name,
      package_file_name: '',
      manifest: {
        schemaVersion: 1,
        skill: { name: validation.name, description: validation.description },
        assets: [],
        createdAt: new Date(0).toISOString(),
      },
      asset_index: [],
      message: validation.message,
    }
  }

  const assets: SkillPackageAsset[] = [
    {
      path: 'SKILL.md',
      mimeType: 'text/markdown',
      bytes: byteLength(skillMd),
    },
    ...references.map(reference => ({
      path: String(reference.path),
      title: reference.title,
      mimeType: reference.mimeType || 'text/markdown',
      bytes: byteLength(reference.content),
    })),
  ]
  const manifest = {
    schemaVersion: 1 as const,
    skill: {
      name: validation.name,
      description: validation.description,
    },
    assets,
    createdAt: new Date().toISOString(),
  }

  return {
    status: 'ok',
    name: validation.name,
    package_file_name: `${sanitizePackageName(validation.name)}.skill`,
    manifest,
    asset_index: assets,
    message: 'Skill 已按官方包结构完成打包预检，可保存到本地 Skill 仓库。',
  }
}

export function buildDescriptionOptimizationPrompt(input: {
  skillMd: string
  userIntent?: string
  feedback?: string
  benchmarkNotes?: string[]
}): string {
  const parsed = parseFrontmatter(input.skillMd)
  const name = parsed?.fields.name || 'unknown-skill'
  const description = parsed?.fields.description || ''
  const notes = (input.benchmarkNotes || []).map(note => `- ${note}`).join('\n') || '- No benchmark notes provided.'

  return `Optimize only the YAML description for the Skill named "${name}".

Official Skill Creator goal:
- Make the description specific and trigger-friendly.
- Include when to use the skill and what it does.
- Do not rewrite the full skill body unless the user explicitly asks.
- Return the full updated SKILL.md so it can be validated and saved.

Current description:
${description || '(missing)'}

User intent:
${input.userIntent || '(not provided)'}

User feedback:
${input.feedback || '(not provided)'}

Benchmark notes:
${notes}

Current SKILL.md:
${input.skillMd}`
}

export function extractSkillMdFromModelOutput(output: string): string {
  const text = String(output || '').trim()
  const fenced = text.match(/```(?:markdown|md)?\s*\n([\s\S]*?\n---[\s\S]*?)```/i)
    || text.match(/```(?:markdown|md)?\s*\n([\s\S]*?)```/i)
  const candidate = (fenced?.[1] || text).trim()
  const direct = candidate.match(/(---\n[\s\S]*?\n---\n?[\s\S]*)$/m)
  return (direct?.[1] || candidate).trim()
}

async function callLlm(
  config: Awaited<ReturnType<typeof resolveApiConfig>>,
  systemPrompt: string | null,
  userPrompt: string,
  signal?: AbortSignal
): Promise<{ output: string; tokens: number; durationMs: number }> {
  const startTime = Date.now()
  const messages: any[] = []
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
  messages.push({ role: 'user', content: userPrompt })

  const res = await fetch(`${config.apiBase}/v1/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify({
      model: config.model || 'claude-sonnet-4-6',
      messages,
      temperature: 0.7,
      max_tokens: 2000,
      stream: false,
    }),
    signal,
  })

  const durationMs = Date.now() - startTime
  if (!res.ok) return { output: `[API ${res.status}]`, tokens: 0, durationMs }

  try {
    const data = await res.json()
    return {
      output: data.choices?.[0]?.message?.content || '[空输出]',
      tokens: data.usage?.total_tokens || 0,
      durationMs,
    }
  } catch {
    return { output: '[响应解析失败]', tokens: 0, durationMs }
  }
}

async function gradeAssertions(
  config: Awaited<ReturnType<typeof resolveApiConfig>>,
  output: string,
  assertions: Assertion[],
  expect: string
): Promise<Assertion[]> {
  if (!assertions.length) return []

  const assertionsText = assertions.map((a, i) => `${i + 1}. ${a.text}`).join('\n')
  const sanitizedOutput = output.slice(0, 3000).replace(/"""/g, "'")

  const prompt = `你是Skill输出评分器。评估以下输出是否满足每条断言。

期望表现：${expect}

输出内容：
"""
${sanitizedOutput}
"""

断言列表：
${assertionsText}

对每条断言判断 PASS 或 FAIL，并提供 evidence（引用输出中的具体文字）。
返回 JSON 数组：[{"text":"断言原文","passed":true|false,"evidence":"证据"}]
只返回 JSON 数组，不要其他内容。`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), EVAL_TIMEOUT_MS)

  try {
    const res = await fetch(`${config.apiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify({
        model: config.model || 'claude-haiku-4-5',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 1000,
        stream: false,
      }),
      signal: controller.signal,
    })

    if (!res.ok) return assertions.map(a => ({ ...a, passed: false, evidence: `评分API ${res.status}` }))
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || ''
    const match = content.match(/\[[\s\S]*\]/)
    if (match) {
      try {
        const parsed = JSON.parse(match[0])
        return parsed.map((g: any, i: number) => ({
          text: assertions[i]?.text || g.text || '',
          passed: g.passed ?? false,
          evidence: g.evidence || '',
        }))
      } catch {
        return assertions.map(a => ({ ...a, passed: false, evidence: '评分JSON解析失败' }))
      }
    }
    return assertions.map(a => ({ ...a, passed: false, evidence: '无法解析评分' }))
  } catch {
    return assertions.map(a => ({ ...a, passed: false, evidence: '评分异常' }))
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * run_skill_tests — 对标官方 Step 1-3
 * 并行运行 with-skill + without-skill baseline
 */
export async function runSkillTests(
  draftSkillMd: string,
  testCases: TestCase[]
): Promise<TestResults> {
  if (testCases.length > MAX_TEST_CASES) {
    throw new Error(`测试用例最多 ${MAX_TEST_CASES} 个，请分批运行。`)
  }

  const config = await resolveApiConfig()
  const results: SingleTestResult[] = []

  for (let batch = 0; batch < testCases.length; batch += MAX_CONCURRENT) {
    const batchCases = testCases.slice(batch, batch + MAX_CONCURRENT)
    const batchPromises = batchCases.map(async (tc, batchIdx) => {
      const i = batch + batchIdx
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)

      try {
        // 并行跑 with-skill + without-skill
        const [withRun, withoutRun] = await Promise.all([
          callLlm(config, draftSkillMd, tc.prompt, controller.signal),
          callLlm(config, null, tc.prompt, controller.signal),
        ])

        const assertions = normalizeTestCaseAssertions(tc)
        const [withAssertions, withoutAssertions] = await Promise.all([
          assertions.length > 0 ? gradeAssertions(config, withRun.output, assertions, tc.expect) : [],
          assertions.length > 0 ? gradeAssertions(config, withoutRun.output, assertions, tc.expect) : [],
        ])

        return {
          eval_id: i + 1,
          eval_name: tc.expect.slice(0, 40),
          prompt: tc.prompt,
          expect: tc.expect,
          runs: [
            {
              configuration: 'with_skill',
              output: withRun.output,
              tokenCount: withRun.tokens,
              durationMs: withRun.durationMs,
              assertions: withAssertions,
              timing: {
                total_tokens: withRun.tokens,
                duration_ms: withRun.durationMs,
                total_duration_seconds: withRun.durationMs / 1000,
              },
            },
            {
              configuration: 'without_skill',
              output: withoutRun.output,
              tokenCount: withoutRun.tokens,
              durationMs: withoutRun.durationMs,
              assertions: withoutAssertions,
              timing: {
                total_tokens: withoutRun.tokens,
                duration_ms: withoutRun.durationMs,
                total_duration_seconds: withoutRun.durationMs / 1000,
              },
            },
          ],
        } as SingleTestResult
      } catch (e: any) {
        const errRun: RunResult = {
          configuration: 'with_skill',
          output: e.name === 'AbortError' ? '[超时]' : `[异常: ${e.message}]`,
          tokenCount: 0, durationMs: 0, assertions: [],
          timing: { total_tokens: 0, duration_ms: 0, total_duration_seconds: 0 },
        }
        return {
          eval_id: i + 1, eval_name: tc.expect.slice(0, 40),
          prompt: tc.prompt, expect: tc.expect,
          runs: [errRun, { ...errRun, configuration: 'without_skill' }],
        } as SingleTestResult
      } finally {
        clearTimeout(timeout)
      }
    })

    const batchResults = await Promise.all(batchPromises)
    results.push(...batchResults)
  }

  const calcPassRate = (config: 'with_skill' | 'without_skill') => {
    const allA = results.flatMap(r =>
      r.runs.find(run => run.configuration === config)?.assertions || []
    )
    if (allA.length === 0) return 0
    return allA.filter(a => a.passed).length / allA.length
  }
  const wsRate = calcPassRate('with_skill')
  const wosRate = calcPassRate('without_skill')

  return {
    draftSkillMd,
    testCases,
    results,
    summary: {
      withSkillPassRate: Math.round(wsRate * 1000) / 10,
      withoutSkillPassRate: Math.round(wosRate * 1000) / 10,
      deltaPassRate: `${wsRate >= wosRate ? '+' : ''}${Math.round((wsRate - wosRate) * 1000) / 10}%`,
      totalTests: testCases.length,
    },
  }
}

function normalizeTestCaseAssertions(testCase: TestCase): Assertion[] {
  if (testCase.assertions?.length) return testCase.assertions
  const text = String(testCase.expect || '').trim()
  return text ? [{ text }] : []
}

function isSkillTestRuntimeErrorOutput(output: string): boolean {
  return /^\[(?:API \d+|异常:|超时|响应解析失败|空输出)\]/.test(String(output || '').trim())
}

// ═══════════════════════════════════════════════
// aggregate_skill_benchmark — 对标官方 Step 4
// ═══════════════════════════════════════════════

function calcStats(values: number[]): BenchmarkStats {
  if (!values.length) return { mean: 0, stddev: 0, min: 0, max: 0 }
  const n = values.length
  const mean = values.reduce((a, b) => a + b, 0) / n
  const variance = n > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0
  return {
    mean: Math.round(mean * 10000) / 10000,
    stddev: Math.round(Math.sqrt(variance) * 10000) / 10000,
    min: Math.min(...values),
    max: Math.max(...values),
  }
}

export function aggregateBenchmark(results: SingleTestResult[], skillName: string): BenchmarkData {
  const evalIds = results.map(r => r.eval_id)
  const runs: BenchmarkRun[] = []

  for (const r of results) {
    for (const run of r.runs) {
      const assertions = run.assertions || []
      const passed = assertions.filter(a => a.passed).length
      const total = assertions.length || 1
      runs.push({
        eval_id: r.eval_id,
        eval_name: r.eval_name,
        configuration: run.configuration,
        run_number: 1,
        result: {
          pass_rate: passed / total,
          passed,
          failed: total - passed,
          total,
          time_seconds: run.timing.total_duration_seconds,
          tokens: run.timing.total_tokens,
          errors: isSkillTestRuntimeErrorOutput(run.output) ? 1 : 0,
        },
        expectations: assertions.map(a => ({
          text: a.text, passed: a.passed ?? false, evidence: a.evidence || '',
        })),
        notes: [],
      })
    }
  }

  const withRuns = runs.filter(r => r.configuration === 'with_skill')
  const withoutRuns = runs.filter(r => r.configuration === 'without_skill')

  const wsPR = withRuns.map(r => r.result.pass_rate)
  const wosPR = withoutRuns.map(r => r.result.pass_rate)
  const wsTime = withRuns.map(r => r.result.time_seconds)
  const wosTime = withoutRuns.map(r => r.result.time_seconds)
  const wsTokens = withRuns.map(r => r.result.tokens)
  const wosTokens = withoutRuns.map(r => r.result.tokens)

  const wsStatsPR = calcStats(wsPR)
  const wosStatsPR = calcStats(wosPR)
  const wsStatsTime = calcStats(wsTime)
  const wosStatsTime = calcStats(wosTime)
  const wsStatsTokens = calcStats(wsTokens)
  const wosStatsTokens = calcStats(wosTokens)

  const notes: string[] = []
  for (const r of results) {
    for (const run of r.runs) {
      for (const a of run.assertions || []) {
        const allPass = results.every(res =>
          res.runs.every(rn => (rn.assertions || []).find(x => x.text === a.text)?.passed)
        )
        if (allPass && a.passed) {
          const exists = notes.find(n => n.includes(a.text.slice(0, 30)))
          if (!exists) notes.push(`断言 "${a.text.slice(0, 50)}" 在所有配置均通过 — 可能不区分Skill价值`)
        }
      }
    }
  }
  if (wsStatsPR.stddev > 0.3) {
    notes.push(`with_skill 通过率标准差 ${(wsStatsPR.stddev * 100).toFixed(0)}% — 可能有不稳定用例`)
  }

  return {
    metadata: {
      skill_name: skillName,
      timestamp: new Date().toISOString(),
      evals_run: evalIds,
      runs_per_configuration: 1,
    },
    runs,
    run_summary: {
      with_skill: {
        pass_rate: wsStatsPR,
        time_seconds: wsStatsTime,
        tokens: wsStatsTokens,
      },
      without_skill: {
        pass_rate: wosStatsPR,
        time_seconds: wosStatsTime,
        tokens: wosStatsTokens,
      },
      delta: {
        pass_rate: `${wsStatsPR.mean >= wosStatsPR.mean ? '+' : ''}${Math.round((wsStatsPR.mean - wosStatsPR.mean) * 10000) / 100}%`,
        time_seconds: `${(wsStatsTime.mean - wosStatsTime.mean) >= 0 ? '+' : ''}${Math.round((wsStatsTime.mean - wosStatsTime.mean) * 10) / 10}`,
        tokens: `${(wsStatsTokens.mean - wosStatsTokens.mean) >= 0 ? '+' : ''}${Math.round(wsStatsTokens.mean - wosStatsTokens.mean)}`,
      },
    },
    notes,
  }
}

// ═══════════════════════════════════════════════
// open_eval_viewer — 对标官方 generate_review.py
// ═══════════════════════════════════════════════

export function generateEvalViewerHtml(
  skillName: string,
  results: SingleTestResult[],
  benchmark: BenchmarkData | null,
  previousFeedback?: Record<string, string>
): string {
  const encoded = JSON.stringify({
    skill_name: skillName,
    runs: results.flatMap(r => [
      {
        id: `eval-${r.eval_id}-with_skill`,
        prompt: r.prompt,
        eval_id: r.eval_id,
        outputs: [{
          name: 'output.md', type: 'text',
          content: r.runs.find(x => x.configuration === 'with_skill')?.output || '',
        }],
        grading: (() => {
          const a = r.runs.find(x => x.configuration === 'with_skill')?.assertions || []
          if (!a.length) return null
          const passed = a.filter(x => x.passed).length
          return { summary: { passed, failed: a.length - passed, total: a.length, pass_rate: passed / a.length }, expectations: a }
        })(),
      },
      {
        id: `eval-${r.eval_id}-without_skill`,
        prompt: r.prompt,
        eval_id: r.eval_id,
        outputs: [{
          name: 'output.md', type: 'text',
          content: r.runs.find(x => x.configuration === 'without_skill')?.output || '',
        }],
        grading: (() => {
          const a = r.runs.find(x => x.configuration === 'without_skill')?.assertions || []
          if (!a.length) return null
          const passed = a.filter(x => x.passed).length
          return { summary: { passed, failed: a.length - passed, total: a.length, pass_rate: passed / a.length }, expectations: a }
        })(),
      },
    ]),
    previous_feedback: previousFeedback || {},
    previous_outputs: {},
    benchmark: benchmark || undefined,
  })

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Skill测试结果 — ${skillName}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#faf9f5;color:#141413;padding:1.5rem}
h1{font-size:1.25rem;margin-bottom:0.5rem}
.meta{color:#999;font-size:0.8rem;margin-bottom:1.5rem}
.tabs{display:flex;gap:0;margin-bottom:1rem;border-bottom:2px solid #e8e6dc}
.tab{padding:0.5rem 1.25rem;cursor:pointer;font-weight:500;font-size:0.85rem;color:#999;border-bottom:2px solid transparent;margin-bottom:-2px}
.tab.active{color:#d97757;border-bottom-color:#d97757}
.panel{display:none}
.panel.active{display:block}
.card{background:#fff;border:1px solid #e8e6dc;border-radius:8px;padding:1rem;margin-bottom:1rem}
.card h3{font-size:0.9rem;margin-bottom:0.5rem;display:flex;align-items:center;gap:0.5rem}
.badge{font-size:0.65rem;padding:0.15rem 0.5rem;border-radius:999px;font-weight:600;text-transform:uppercase}
.badge-with{background:rgba(33,150,243,0.12);color:#1976d2}
.badge-without{background:rgba(255,193,7,0.15);color:#f57f17}
pre{background:#f5f5f0;padding:0.75rem;border-radius:6px;font-size:0.75rem;line-height:1.5;white-space:pre-wrap;max-height:300px;overflow-y:auto;font-family:'SF Mono',monospace}
.assertion{margin:0.25rem 0;font-size:0.8rem}
.assertion .pass{color:#22c55e;font-weight:600}
.assertion .fail{color:#ef4444;font-weight:600}
.assertion .evidence{color:#999;font-size:0.7rem;margin-left:1.5rem}
.benchmark-table{border-collapse:collapse;width:100%;font-size:0.8rem;margin:1rem 0}
.benchmark-table th{background:#141413;color:#faf9f5;padding:0.5rem;text-align:left}
.benchmark-table td{padding:0.5rem;border:1px solid #e8e6dc}
.delta-positive{color:#22c55e;font-weight:600}
.delta-negative{color:#ef4444;font-weight:600}
.notes{background:#fef3c7;padding:0.75rem;border-radius:6px;font-size:0.8rem;margin-top:1rem}
.nav{display:flex;justify-content:space-between;margin-top:1rem;gap:0.5rem}
.nav button{padding:0.5rem 1rem;border:1px solid #e8e6dc;border-radius:6px;background:#fff;cursor:pointer;font-size:0.85rem}
.nav button:hover{background:#f5f5f0}
.nav button:disabled{opacity:0.4;cursor:not-allowed}
textarea{width:100%;min-height:60px;padding:0.5rem;border:1px solid #e8e6dc;border-radius:6px;font-size:0.85rem;margin-top:0.5rem;font-family:inherit;resize:vertical}
</style></head><body>
<div id="app"></div>
<script>
const DATA = ${encoded};
let currentIdx = 0;
let feedback = {};
let tab = 'outputs';

function render() {
  const runs = DATA.runs;
  const r = runs[currentIdx];
  const isWith = r.id.includes('with_skill');
  const configLabel = isWith ? 'WITH skill' : 'WITHOUT skill';
  const badgeClass = isWith ? 'badge-with' : 'badge-without';

  let html = '<h1>Skill测试: ' + DATA.skill_name + '</h1>';
  html += '<div class="meta">共 ' + runs.length + ' 个结果 | ' + new Date().toLocaleString() + '</div>';

  if (DATA.benchmark) {
    html += '<div class="tabs"><div class="tab' + (tab==='outputs'?' active':'') + '" onclick="switchTab(\'outputs\')">Outputs</div><div class="tab' + (tab===\'benchmark\'?\' active\':\'\') + '" onclick="switchTab(\'benchmark\')">Benchmark</div></div>';
  }

  if (tab === 'outputs') {
    html += '<div class="card"><h3><span class="badge ' + badgeClass + '">' + configLabel + '</span> 测试 #' + r.eval_id + '</h3>';
    html += '<p style="color:#999;font-size:0.8rem;margin-bottom:0.5rem">' + escapeHtml(r.prompt) + '</p>';
    if (r.outputs && r.outputs[0]) {
      html += '<pre>' + escapeHtml(r.outputs[0].content.slice(0, 2000)) + '</pre>';
    }
    if (r.grading && r.grading.expectations) {
      html += '<div style="margin-top:0.75rem"><strong style="font-size:0.8rem">断言评分 (' + r.grading.summary.passed + '/' + r.grading.summary.total + ')</strong>';
      r.grading.expectations.forEach(function(a) {
        html += '<div class="assertion"><span class="' + (a.passed?'pass':'fail') + '">' + (a.passed?'\u2713':'\u2717') + '</span> ' + escapeHtml(a.text);
        if (a.evidence) html += '<div class="evidence">' + escapeHtml(a.evidence) + '</div>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '<textarea placeholder="反馈..." onchange="saveFeedback(' + currentIdx + ',this.value)">' + (feedback[currentIdx]||'') + '</textarea>';
    html += '</div>';
    html += '<div class="nav"><button ' + (currentIdx===0?'disabled':'') + ' onclick="nav(-1)">\u2190 上一个</button><span style="line-height:2">' + (currentIdx+1) + '/' + runs.length + '</span><button ' + (currentIdx>=runs.length-1?'disabled':'') + ' onclick="nav(1)">下一个 \u2192</button></div>';
  } else if (tab === 'benchmark' && DATA.benchmark) {
    var b = DATA.benchmark;
    html += '<div class="card"><h3>Benchmark 摘要</h3>';
    html += '<table class="benchmark-table"><tr><th>指标</th><th>With Skill</th><th>Without Skill</th><th>Delta</th></tr>';
    var ws = b.run_summary.with_skill, wos = b.run_summary.without_skill, d = b.run_summary.delta;
    html += '<tr><td>Pass Rate</td><td>' + (ws.pass_rate.mean*100).toFixed(0) + '% \u00b1' + (ws.pass_rate.stddev*100).toFixed(0) + '%</td><td>' + (wos.pass_rate.mean*100).toFixed(0) + '% \u00b1' + (wos.pass_rate.stddev*100).toFixed(0) + '%</td><td class="' + (d.pass_rate.startsWith('+')?'delta-positive':'delta-negative') + '">' + d.pass_rate + '</td></tr>';
    html += '<tr><td>Time (s)</td><td>' + ws.time_seconds.mean.toFixed(1) + ' \u00b1' + ws.time_seconds.stddev.toFixed(1) + '</td><td>' + wos.time_seconds.mean.toFixed(1) + ' \u00b1' + wos.time_seconds.stddev.toFixed(1) + '</td><td>' + d.time_seconds + 's</td></tr>';
    html += '<tr><td>Tokens</td><td>' + ws.tokens.mean.toFixed(0) + ' \u00b1' + ws.tokens.stddev.toFixed(0) + '</td><td>' + wos.tokens.mean.toFixed(0) + ' \u00b1' + wos.tokens.stddev.toFixed(0) + '</td><td>' + d.tokens + '</td></tr>';
    html += '</table></div>';
    if (b.notes && b.notes.length) {
      html += '<div class="notes"><strong>分析笔记</strong><ul>' + b.notes.map(function(n){return '<li>'+escapeHtml(n)+'</li>'}).join('') + '</ul></div>';
    }
    html += '<div class="nav"><button onclick="switchTab(\'outputs\')">\u2190 返回 Outputs</button></div>';
  }

  document.getElementById('app').innerHTML = html;
}

function nav(d) { currentIdx = Math.max(0, Math.min(DATA.runs.length-1, currentIdx+d)); render(); }
function switchTab(t) { tab = t; render(); }
function saveFeedback(idx, val) { feedback[idx] = val; }
function escapeHtml(t) { var d=document.createElement('div');d.textContent=t;return d.innerHTML; }
render();
</script></body></html>`
}

// ═══════════════════════════════════════════════
// Tool Definitions（给 LLM 的 Skill Creator lifecycle tools）
// ═══════════════════════════════════════════════

export const VALIDATE_SKILL_TOOL = {
  type: 'function' as const,
  function: {
    name: 'skill_creator_validate',
    description: '按官方 Skill 结构校验草稿：YAML frontmatter、name、description、正文、references/scripts/assets 包路径安全。起草或修改后先调用。',
    parameters: {
      type: 'object',
      properties: {
        test_id: { type: 'string', description: '可选。同一次 Skill Creator 任务的稳定 ID；后续测试、评审和保存请沿用。' },
        skill_md: { type: 'string', description: '完整的 SKILL.md 内容（含 YAML frontmatter）' },
        references: {
          type: 'array',
          description: '可选。Skill 包内 references/scripts/assets 文件列表，用于路径校验。',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
              title: { type: 'string' },
              mimeType: { type: 'string' },
            },
            required: ['path', 'content'],
          },
        },
      },
      required: ['skill_md'],
    },
  },
}

export const RUN_SKILL_TESTS_TOOL = {
  type: 'function' as const,
  function: {
    name: 'run_skill_tests',
    description: '对草稿 SKILL.md 运行测试（with/without baseline + 断言评分），并自动聚合为 Benchmark (mean/stddev/delta + 分析笔记)。一次调用返回完整结果：summary、benchmark、notes。无需再调用其他聚合工具。',
    parameters: {
      type: 'object',
      properties: {
        test_id: { type: 'string', description: '可选。同一次 Skill Creator 任务的稳定 ID；应沿用 validate 返回或本轮自定的 ID。' },
        draft_skill_md: {
          type: 'string',
          description: '当前草稿的完整 SKILL.md 内容（含 YAML frontmatter）',
        },
        skill_name: {
          type: 'string',
          description: 'Skill 名称，用于 benchmark 和评审页标题',
        },
        test_cases: {
          type: 'array',
          description: '测试用例列表，每个用例可附带 assertions 用于自动评分',
          items: {
            type: 'object',
            properties: {
              prompt: { type: 'string', description: '模拟用户输入的测试 prompt' },
              expect: { type: 'string', description: '期望表现描述' },
              assertions: {
                type: 'array',
                description: '可选：具体可验证的断言列表，工具会逐条评分',
                items: {
                  type: 'object',
                  properties: {
                    text: { type: 'string', description: '断言内容，如"输出包含产品名称"' },
                  },
                  required: ['text'],
                },
              },
            },
            required: ['prompt', 'expect'],
          },
        },
      },
      required: ['draft_skill_md', 'test_cases'],
    },
  },
}

export const AGGREGATE_SKILL_BENCHMARK_TOOL = {
  type: 'function' as const,
  function: {
    name: 'skill_creator_aggregate_benchmark',
    description: '把最近一次 run_skill_tests 的 with-skill / without-skill 结果聚合为官方 Benchmark 摘要。run_skill_tests 已自动聚合；需要重新命名或复看统计时调用。',
    parameters: {
      type: 'object',
      properties: {
        test_id: { type: 'string', description: '可选。同一次 Skill Creator 任务的稳定 ID；用于复看指定测试结果。' },
        skill_name: { type: 'string', description: 'Skill 名称' },
      },
      required: ['skill_name'],
    },
  },
}

export const OPEN_EVAL_REVIEW_TOOL = {
  type: 'function' as const,
  function: {
    name: 'skill_creator_open_eval_review',
    description: '生成官方 eval-viewer 风格的测试评审 HTML，供用户查看逐用例输出、断言评分和 Benchmark。用于测试完成后展示评审结果。',
    parameters: {
      type: 'object',
      properties: {
        test_id: { type: 'string', description: '可选。同一次 Skill Creator 任务的稳定 ID；用于打开对应测试结果的评审页。' },
        skill_name: { type: 'string', description: 'Skill 名称' },
      },
      required: ['skill_name'],
    },
  },
}

export const IMPROVE_SKILL_DESCRIPTION_TOOL = {
  type: 'function' as const,
  function: {
    name: 'skill_creator_improve_description',
    description: '对齐官方 description optimizer：根据用户意图、测试反馈和 benchmark 笔记优化 YAML description，提升 Skill 命中准确度。',
    parameters: {
      type: 'object',
      properties: {
        test_id: { type: 'string', description: '可选。同一次 Skill Creator 任务的稳定 ID；用于读取对应 benchmark 笔记。' },
        skill_md: { type: 'string', description: '当前完整 SKILL.md' },
        user_intent: { type: 'string', description: '用户希望这个 Skill 在哪些场景命中' },
        feedback: { type: 'string', description: '用户或测试反馈' },
        benchmark_notes: {
          type: 'array',
          description: 'run_skill_tests / benchmark 返回的分析笔记',
          items: { type: 'string' },
        },
      },
      required: ['skill_md'],
    },
  },
}

export const PACKAGE_SKILL_TOOL = {
  type: 'function' as const,
  function: {
    name: 'skill_creator_package',
    description: '按官方 .skill 包结构做打包预检，生成 manifest 和 asset index。用户确认保存前或需要分发时调用。',
    parameters: {
      type: 'object',
      properties: {
        test_id: { type: 'string', description: '可选。同一次 Skill Creator 任务的稳定 ID；打包前沿用评审任务 ID。' },
        skill_md: { type: 'string', description: '完整的 SKILL.md 内容（含 YAML frontmatter）' },
        references: {
          type: 'array',
          description: '可选。Skill 包内 references/scripts/assets 文件列表。',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
              title: { type: 'string' },
              mimeType: { type: 'string' },
            },
            required: ['path', 'content'],
          },
        },
      },
      required: ['skill_md'],
    },
  },
}

export const SAVE_SKILL_TOOL = {
  type: 'function' as const,
  function: {
    name: 'save_skill',
    description: '保存最终Skill。用户确认满意后调用此工具。素材转Skill可同时传入 references 和 manifest，保存为本地 Skill 包。',
    parameters: {
      type: 'object',
      properties: {
        test_id: { type: 'string', description: '可选。同一次 Skill Creator 任务的稳定 ID；Skill缔造保存时必须沿用已评审任务 ID。' },
        skill_md: { type: 'string', description: '完整的 SKILL.md 内容（含 YAML frontmatter）' },
        references: {
          type: 'array',
          description: '可选。素材转Skill生成的资料文件列表，会保存到本地 Skill 包 references/ 目录。',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '包内相对路径，例如 references/source.md' },
              title: { type: 'string', description: '资料标题' },
              content: { type: 'string', description: '资料文件内容' },
              mimeType: { type: 'string', description: 'MIME 类型，P1 使用 text/markdown' },
            },
            required: ['path', 'content'],
          },
        },
        manifest: {
          type: 'object',
          description: '可选。build_skill_from_text 返回的 manifest 原样传入，用于写入 skill-package.json。',
        },
        target_skill_id: {
          type: 'string',
          description: '可选。修改现有 Skill 时传入目标 Skill ID，保存时覆盖原 Skill；新建 Skill 时不要传。',
        },
      },
      required: ['skill_md'],
    },
  },
}

export const ALL_SKILL_TOOLS = [
  VALIDATE_SKILL_TOOL,
  RUN_SKILL_TESTS_TOOL,
  AGGREGATE_SKILL_BENCHMARK_TOOL,
  OPEN_EVAL_REVIEW_TOOL,
  IMPROVE_SKILL_DESCRIPTION_TOOL,
  PACKAGE_SKILL_TOOL,
  SAVE_SKILL_TOOL,
]

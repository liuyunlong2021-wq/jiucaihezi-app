const OFFICIAL_SKILL_CREATOR_SCRIPTS = new Set([
  'aggregate_benchmark.py',
  'generate_report.py',
  'improve_description.py',
  'package_skill.py',
  'quick_validate.py',
  'run_eval.py',
  'run_loop.py',
  'generate_review.py',
])

const SCRIPT_TIMEOUTS: Record<string, number> = {
  'quick_validate.py': 30000,
  'package_skill.py': 30000,
  'aggregate_benchmark.py': 30000,
  'generate_report.py': 30000,
  'generate_review.py': 30000,
  'improve_description.py': 60000,
  'run_eval.py': 120000,
  'run_loop.py': 180000,
}

export interface SkillCreatorScriptCommandInput {
  scriptName: string
  skillCreatorRoot: string
  args?: Record<string, string | number | boolean | undefined | null>
}

export interface SkillCreatorScriptCommand {
  program: 'python3'
  args: string[]
  timeoutMs: number
}

export function isSkillCreatorScriptName(value: string): boolean {
  return OFFICIAL_SKILL_CREATOR_SCRIPTS.has(String(value || '').trim())
}

export function buildSkillCreatorScriptCommand(input: SkillCreatorScriptCommandInput): SkillCreatorScriptCommand {
  const scriptName = String(input.scriptName || '').trim()
  if (!isSkillCreatorScriptName(scriptName)) {
    throw new Error(`不支持的 Skill Creator 官方脚本: ${scriptName}`)
  }
  const root = normalizeSafePath(input.skillCreatorRoot, 'skillCreatorRoot')
  const args = input.args || {}
  const scriptPath = scriptName === 'generate_review.py'
    ? joinPath(root, 'eval-viewer', scriptName)
    : joinPath(root, 'scripts', scriptName)

  return {
    program: 'python3',
    args: [
      scriptPath,
      ...mapScriptArgs(scriptName, args),
    ],
    timeoutMs: SCRIPT_TIMEOUTS[scriptName] || 30000,
  }
}

function mapScriptArgs(scriptName: string, args: Record<string, string | number | boolean | undefined | null>): string[] {
  if (scriptName === 'quick_validate.py') {
    return [normalizeSafePath(requiredArg(args, 'skill_dir'), 'skill_dir')]
  }
  if (scriptName === 'package_skill.py') {
    const values = [normalizeSafePath(requiredArg(args, 'skill_dir'), 'skill_dir')]
    if (args.output_dir) values.push(normalizeSafePath(String(args.output_dir), 'output_dir'))
    return values
  }
  if (scriptName === 'generate_review.py') {
    return namedArgs(args, ['results', 'benchmark', 'output'])
  }
  if (scriptName === 'aggregate_benchmark.py') {
    return namedArgs(args, ['workspace', 'output'])
  }
  if (scriptName === 'generate_report.py') {
    return namedArgs(args, ['benchmark', 'output'])
  }
  if (scriptName === 'improve_description.py') {
    return namedArgs(args, ['skill', 'eval-results', 'output'])
  }
  if (scriptName === 'run_eval.py') {
    return namedArgs(args, ['skill', 'evals', 'output'])
  }
  if (scriptName === 'run_loop.py') {
    return namedArgs(args, ['skill', 'evals', 'workspace'])
  }
  return []
}

function namedArgs(
  args: Record<string, string | number | boolean | undefined | null>,
  allowed: string[],
): string[] {
  const output: string[] = []
  for (const key of allowed) {
    const value = args[key]
    if (value === undefined || value === null || value === false) continue
    output.push(`--${key}`)
    if (value !== true) output.push(normalizeSafeArgValue(String(value), key))
  }
  return output
}

function requiredArg(args: Record<string, string | number | boolean | undefined | null>, key: string): string {
  const value = args[key]
  if (value === undefined || value === null || value === '') {
    throw new Error(`缺少官方脚本参数: ${key}`)
  }
  return String(value)
}

function normalizeSafePath(value: string, label: string): string {
  const text = normalizeSafeArgValue(value, label)
  if (!text.startsWith('/')) throw new Error(`${label} 必须是绝对路径`)
  if (hasUnsafePathSegment(text)) throw new Error(`${label} 路径不安全`)
  return text.replace(/\/+$/g, '')
}

function normalizeSafeArgValue(value: string, label: string): string {
  const text = String(value || '').trim()
  if (!text || text.includes('\0') || /[;&|`$<>]/.test(text)) {
    throw new Error(`${label} 参数不安全`)
  }
  return text
}

function hasUnsafePathSegment(value: string): boolean {
  return value
    .split('/')
    .some(segment => segment === '.' || segment === '..')
}

function joinPath(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((part, index) => index === 0
      ? part.replace(/\/+$/g, '')
      : part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')
}

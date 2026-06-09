import type { OpenCodeRenderablePart } from './timelineRows'
import { safeOpenCodeJsonSummary } from './timelineRows'

function rawPart(part: OpenCodeRenderablePart): any {
  return part.raw as any
}

function shellState(part: OpenCodeRenderablePart): Record<string, any> {
  const state = rawPart(part)?.state
  return state && typeof state === 'object' ? state : {}
}

function parseJsonObject(text: string | undefined): Record<string, unknown> {
  if (!text) return {}
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function shellInput(part: OpenCodeRenderablePart): Record<string, unknown> {
  const raw = rawPart(part)
  const stateInput = shellState(part).input
  if (stateInput && typeof stateInput === 'object' && !Array.isArray(stateInput)) return stateInput as Record<string, unknown>
  if (raw?.input && typeof raw.input === 'object' && !Array.isArray(raw.input)) return raw.input as Record<string, unknown>
  return parseJsonObject(part.input)
}

function textFromValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return safeOpenCodeJsonSummary(value, 3000)
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function firstDisplayText(values: unknown[]): string {
  for (const value of values) {
    const text = textFromValue(value)
    if (text) return text
  }
  return ''
}

function shellOutputFromContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content.map((item: any) => {
    if (typeof item === 'string') return item
    if (item?.type === 'text') return item.text || ''
    if (item?.type === 'file') return `[file] ${item.name || item.mime || safeOpenCodeJsonSummary(item.source, 200)}`
    return safeOpenCodeJsonSummary(item, 300)
  }).filter(Boolean).join('\n')
}

export function isOpenCodeShellPart(part: OpenCodeRenderablePart): boolean {
  const toolName = String(part.toolName || '').toLowerCase()
  return part.type === 'shell' || (part.type === 'tool' && (toolName === 'bash' || toolName === 'shell'))
}

export function shellDisplayCommand(part: OpenCodeRenderablePart): string {
  const raw = rawPart(part)
  const input = shellInput(part)
  return firstDisplayText([input.command, input.cmd, raw?.command, raw?.cmd]).trim()
}

export function shellDisplayStdout(part: OpenCodeRenderablePart): string {
  const raw = rawPart(part)
  const state = shellState(part)
  const result = state.result && typeof state.result === 'object' ? state.result : {}
  return firstDisplayText([
    raw?.stdout,
    state.stdout,
    (result as any).stdout,
    raw?.output,
    state.output,
    shellOutputFromContent(state.content),
    part.result,
  ])
}

export function shellDisplayStderr(part: OpenCodeRenderablePart): string {
  const raw = rawPart(part)
  const state = shellState(part)
  const result = state.result && typeof state.result === 'object' ? state.result : {}
  return firstDisplayText([
    raw?.stderr,
    state.stderr,
    (result as any).stderr,
    state.error?.stderr,
    state.error?.message,
    state.error,
  ])
}

export function shellDisplayErrorText(part: OpenCodeRenderablePart): string {
  const raw = rawPart(part)
  const state = shellState(part)
  return firstDisplayText([
    state.error?.message,
    raw?.error?.message,
    state.error,
    raw?.error,
    shellDisplayStderr(part),
    'Shell 命令执行失败',
  ])
}

export function shellDisplayExitLabel(part: OpenCodeRenderablePart): string {
  const raw = rawPart(part)
  const state = shellState(part)
  const result = state.result && typeof state.result === 'object' ? state.result : {}
  const code = raw?.exitCode ?? raw?.code ?? state.exitCode ?? state.code ?? (result as any).exitCode ?? (result as any).code
  return code === undefined || code === null || code === '' ? '' : `exit ${code}`
}

export function shellDisplayDurationLabel(part: OpenCodeRenderablePart): string {
  const raw = rawPart(part)
  const state = shellState(part)
  const time = raw?.time || state.time || {}
  const start = Number(time.start || time.created || raw?.time?.created || 0)
  const end = Number(time.end || time.completed || raw?.time?.completed || 0)
  if (!start || !end || end < start) return ''
  const seconds = end - start > 1000 ? (end - start) / 1000 : end - start
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`
}

export function shellDisplaySubtitle(part: OpenCodeRenderablePart): string {
  const command = shellDisplayCommand(part)
  const meta = [shellDisplayExitLabel(part), shellDisplayDurationLabel(part)].filter(Boolean).join(' · ')
  if (part.status === 'pending' || part.status === 'running') return command ? `正在运行：${command}` : 'Shell 命令正在运行'
  if (part.status === 'error' || part.isError) return meta ? `Shell 失败 · ${meta}` : 'Shell 命令执行失败'
  return [command || 'Shell 命令', meta].filter(Boolean).join(' · ')
}

export function shellDisplayDetail(part: OpenCodeRenderablePart): string {
  const raw = rawPart(part)
  if (!isRecord(raw)) return safeOpenCodeJsonSummary(raw || part, 3000)

  const {
    stdout: _stdout,
    stderr: _stderr,
    output: _output,
    content: _content,
    result: rawResult,
    state: rawState,
    ...rawRest
  } = raw
  const detail: Record<string, unknown> = { ...rawRest }

  if (isRecord(rawState)) {
    const {
      stdout: _stateStdout,
      stderr: _stateStderr,
      output: _stateOutput,
      content: _stateContent,
      result: stateResult,
      ...stateRest
    } = rawState
    const nextState: Record<string, unknown> = { ...stateRest }
    if (isRecord(stateResult)) {
      const {
        stdout: _resultStdout,
        stderr: _resultStderr,
        output: _resultOutput,
        content: _resultContent,
        ...resultRest
      } = stateResult
      if (Object.keys(resultRest).length) nextState.result = resultRest
    }
    detail.state = nextState
  }

  if (isRecord(rawResult)) {
    const {
      stdout: _resultStdout,
      stderr: _resultStderr,
      output: _resultOutput,
      content: _resultContent,
      ...resultRest
    } = rawResult
    if (Object.keys(resultRest).length) detail.result = resultRest
  }

  detail.output = {
    stdout: shellDisplayStdout(part) ? '已在终端 stdout 面板显示' : '无 stdout',
    stderr: shellDisplayStderr(part) ? '已在终端 stderr 面板显示' : '无 stderr',
  }

  return safeOpenCodeJsonSummary(detail, 3000)
}

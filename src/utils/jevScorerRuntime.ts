/**
 * 本地 Skill 打分器（@Jev 决策链第一层，`scripts/jev-scorer/serve.py`）。
 *
 * python 环境和 2.1GB 微调模型在 `~/.cache/jiucaihezi/jev-scorer`，不在 app 包里 ——
 * 所以「没装」是正常状态，不是错误：决策链会自动降级到规则层 + 模型层
 * （准确率 95% → 71%）。这里一律不抛错、不弹窗，调用方按返回值自己决定要不要提示。
 */
import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from './tauriEnv'

export const JEV_SCORER_URL = 'http://127.0.0.1:4789'

/** `web` = 网页版没有本地服务这回事，和「没装」分开是为了别在界面上说错话。 */
export type JevScorerState = 'started' | 'already_running' | 'unavailable' | 'web'

export async function ensureJevScorer(): Promise<JevScorerState> {
  if (!isTauriRuntime()) return 'web'
  try {
    return (await invoke<string>('jev_scorer_ensure')) as JevScorerState
  } catch {
    // 起不来跟没装一个待遇：决策链自己会降级，别让调用方去处理异常。
    return 'unavailable'
  }
}

export async function jevScorerReady(timeoutMs = 1500): Promise<boolean> {
  try {
    const response = await fetch(`${JEV_SCORER_URL}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    return response.ok
  } catch {
    return false
  }
}

export function jevScorerStateLabel(state: JevScorerState): string {
  if (state === 'started') return '已启动（模型加载要十几秒，第一轮可能来不及）'
  if (state === 'already_running') return '已在运行'
  if (state === 'web') return '网页版不适用'
  return '未安装，本轮用规则层 + 模型层（约 71%）'
}

/**
 * 决策层公共契约。
 *
 * 只有一件事要做：面对「用户这句话 + 当前可用能力」，给出本轮的 Skill、能力芯片与模型档位。
 * 它没有执行权——只能填芯片，执行永远走 runMemoryChat 的既有链路与权限系统。
 */

/** 可选能力候选。只包含当前已启用、且用户已授权的 Skill 与工具芯片。 */
export interface DecisionCandidate {
  /** Skill 用名称；工具用芯片 id（file / media / av / scene3d / mcp__<server>）。 */
  id: string
  kind: 'skill' | 'tool'
  label: string
  description: string
  /**
   * 候选自己声明的关键词：Skill 用 SKILL.md 的 triggers；MCP 服务用服务名 + 工具名 + 工具说明。
   * 规则 provider 只认这批词（不扫描述），LLM provider 挑的 Skill 也要被它佐证。
   */
  triggers?: string[]
}

export type DecisionModelTier = 'light' | 'medium' | 'strong'

export interface DecisionRequest {
  userRequest: string
  candidates: DecisionCandidate[]
}

export interface DecisionResult {
  skills: string[]
  tools: string[]
  /** null = 不改当前模型。说不准就别动用户的模型选择。 */
  modelTier: DecisionModelTier | null
  /** 决策想要、但不能由决策层代开的能力（目前只有 @文件）。只能在界面上提请用户自己开。 */
  suggestions: string[]
  /** 决策依据，只用于界面说明与排障。 */
  reason: string
  provider: string
  latencyMs: number
}

/** 可替换的决策来源。返回 null 表示「这个 provider 没把握」，交给链上的下一个。 */
export interface DecisionProvider {
  id: string
  decide(request: DecisionRequest): Promise<DecisionResult | null>
}

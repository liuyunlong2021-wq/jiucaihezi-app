export interface DirectRequestConstraints {
  toolsForbidden: boolean
  modelLocked: boolean
}

export function resolveDirectRequestConstraints(text: string): DirectRequestConstraints {
  const value = String(text || '')
  return {
    toolsForbidden:
      /(?:不要|不准|禁止|不得|别)(?:使用|调用)?(?:任何|所有)?工具/.test(value)
      || /(?:不使用|不用)任何工具/.test(value),
    modelLocked:
      /只用当前模型/.test(value)
      || /(?:不要|不准|禁止|不得)切换模型/.test(value),
  }
}

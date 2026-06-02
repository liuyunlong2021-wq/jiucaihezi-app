export type TextDiagnosticCode =
  | 'replacement-char'
  | 'question-mark-run'
  | 'control-char'
  | 'symbol-noise'
  | 'unclosed-fence'
  | 'long-unbroken-text'

export type TextDiagnosticSeverity = 'none' | 'low' | 'medium' | 'high'

export interface TextDiagnosticResult {
  severity: TextDiagnosticSeverity
  codes: TextDiagnosticCode[]
  userMessage?: string
}

const SEVERITY_RANK: Record<TextDiagnosticSeverity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
}

function maxSeverity(current: TextDiagnosticSeverity, next: TextDiagnosticSeverity): TextDiagnosticSeverity {
  return SEVERITY_RANK[next] > SEVERITY_RANK[current] ? next : current
}

function hasControlCharacter(text: string): boolean {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)
}

function hasSuspiciousSymbolNoise(text: string): boolean {
  if (text.length < 24) return false
  const symbols = text.match(/[^\p{L}\p{N}\s，。！？、；：“”‘’（）《》,.!?;:'"()[\]{}<>#*_`~|/@$%&+=-]/gu) || []
  return symbols.length / text.length > 0.18
}

function hasLongUnbrokenText(text: string): boolean {
  return /\S{240,}/.test(text)
}

function hasUnclosedFence(text: string): boolean {
  const fences = text.match(/```/g) || []
  return fences.length % 2 === 1
}

export function diagnoseMessageText(text: string): TextDiagnosticResult {
  const codes: TextDiagnosticCode[] = []
  let severity: TextDiagnosticSeverity = 'none'

  if (text.includes('�')) {
    codes.push('replacement-char')
    severity = maxSeverity(severity, 'high')
  }

  if (/[?？]{3,}/.test(text)) {
    codes.push('question-mark-run')
    severity = maxSeverity(severity, 'medium')
  }

  if (hasControlCharacter(text)) {
    codes.push('control-char')
    severity = maxSeverity(severity, 'medium')
  }

  if (hasSuspiciousSymbolNoise(text)) {
    codes.push('symbol-noise')
    severity = maxSeverity(severity, 'medium')
  }

  if (hasUnclosedFence(text)) {
    codes.push('unclosed-fence')
    severity = maxSeverity(severity, 'low')
  }

  if (hasLongUnbrokenText(text)) {
    codes.push('long-unbroken-text')
    severity = maxSeverity(severity, 'low')
  }

  if (severity === 'none') return { severity, codes }

  return {
    severity,
    codes,
    userMessage: severity === 'high'
      ? '文本可能包含编码异常，已保留原文显示。'
      : '文本可能存在显示异常，已保留原文显示。',
  }
}

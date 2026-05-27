/**
 * mathRenderer.ts — KaTeX 数学公式渲染
 * 支持 $...$ 行内公式和 $$...$$ 块级公式
 * 保护代码块内的 $ 不被误渲染
 */
import katex from 'katex'

// 匹配 fenced code blocks，用于保护模式
const FENCED_CODE_RE = /```[\s\S]*?```/g
const INLINE_CODE_RE = /`[^`\n]+`/g

/**
 * 渲染文本中的数学公式
 * @param text 包含 $...$ / $$...$$ 的 markdown 文本
 * @returns 替换后的 HTML-safe 文本（公式已被 katex HTML 替换）
 */
export function renderMathInText(text: string): string {
  if (!text) return text

  // 1. 保护代码块：临时替换为占位符
  const codeBlocks: string[] = []
  let protected_ = text
    .replace(FENCED_CODE_RE, (match) => {
      codeBlocks.push(match)
      return `\x00CODE${codeBlocks.length - 1}\x00`
    })
    .replace(INLINE_CODE_RE, (match) => {
      codeBlocks.push(match)
      return `\x00CODE${codeBlocks.length - 1}\x00`
    })

  // 2. 渲染 $$...$$ 块级公式
  protected_ = protected_.replace(/\$\$([\s\S]*?)\$\$/g, (_match, formula) => {
    try {
      return katex.renderToString(formula.trim(), {
        displayMode: true,
        throwOnError: false,
        trust: true,
      })
    } catch {
      return _match // 渲染失败保留原文
    }
  })

  // 3. 渲染 $...$ 行内公式（不跨行，不允许首尾空格）
  protected_ = protected_.replace(/\$(?=\S)(.+?)(?<=\S)\$/g, (_match, formula) => {
    // 跳过纯数字/货币符号
    const trimmed = formula.trim()
    if (!trimmed || /^\d+(\.\d+)?$/.test(trimmed)) return _match
    if (/^\d+\s/.test(trimmed)) return _match // 货币+文字: $100 million
    if (trimmed.length < 2) return _match // 太短: 可能不是公式
    try {
      return katex.renderToString(trimmed, {
        displayMode: false,
        throwOnError: false,
        trust: true,
      })
    } catch {
      return _match
    }
  })

  // 4. 还原代码块
  protected_ = protected_.replace(/\x00CODE(\d+)\x00/g, (_match, idx) => {
    const i = parseInt(idx, 10)
    return codeBlocks[i] || ''
  })

  return protected_
}

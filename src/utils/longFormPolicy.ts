const LONG_FORM_PATTERNS = [
  /\d+\s*(万|千)?\s*(字|词|字符|tokens?)/i,
  /(长文|很长|超长|完整报告|深度报告|产品报告|研究报告|白皮书|技术路线|方案|规划|计划书|论文|剧本|小说|SRT|字幕)/i,
  /(继续写|接着写|续写|从断点|中断处)/i,
]

export function isLongFormRequest(text: string): boolean {
  const value = String(text || '').trim()
  if (!value) return false
  return LONG_FORM_PATTERNS.some(pattern => pattern.test(value))
}

export function buildLongFormSystemInstruction(userText: string): string {
  if (!isLongFormRequest(userText)) return ''

  return `

<long_form_generation>
你正在处理长文、报告、方案、脚本、字幕或文件生成类任务，请采用结构化长文生成链路：
1. 先理解用户要的交付物、读者、用途、格式和长度；信息足够时直接开始，不要用反问拖延。
2. 先搭结构，再按结构展开。正文要有清晰目录、章节层级和连续编号。
3. 每一节围绕“目标、依据、步骤、产出、校验”展开，避免重复、跑题和后半段压缩。
4. 不要为了压缩篇幅省略后半部分；如果一次输出到达上限，请在自然段末尾停止，保留可承接的上下文。
5. 用户要求导出 Word、Excel、PPT、PDF、Markdown、SRT 或格式转换时，优先调用可用本地能力生成或处理真实文件。
</long_form_generation>`
}

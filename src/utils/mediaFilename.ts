const LEADING_NOISE = /^(?:(?:请(?:帮我)?|帮我)?(?:生成|创建|制作|绘制)(?:一张|一个|一幅)?|(?:根据|参考|基于)(?:所附|这|以下|上传的?|提供的?)?(?:张)?(?:参考)?(?:图片|图)(?:\s*\d+)?(?:来|进行)?|参考图\s*\d+|简要总结|(?:(?:横向|竖向|方形|宽屏|纵向)\s*)?\d+\s*[:：x×]\s*\d+)[\s,，。:：;；_-]*/i

function semanticStem(summary?: string, prompt?: string, model?: string): string {
  let value = String(summary || prompt || model || 'creation').trim()
  let previous = ''
  while (!summary && value && value !== previous) {
    previous = value
    value = value.replace(LEADING_NOISE, '')
  }
  return Array.from(
    value
      .replace(/[^a-zA-Z0-9\u4e00-\u9fff-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[-_]+|[-_]+$/g, '') || 'creation',
  ).slice(0, 28).join('')
}

export function buildMediaFilename(params: {
  summary?: string
  prompt?: string
  model?: string
  taskId?: string
  extension: string
}): string {
  const task = String(params.taskId || '').replace(/[^a-z0-9]/gi, '')
  const suffix = task.slice(-6) || Math.random().toString(36).slice(2, 8).padEnd(6, '0')
  const extension = params.extension.replace(/^\./, '').replace(/[^a-z0-9]/gi, '') || 'bin'
  return `${semanticStem(params.summary, params.prompt, params.model)}_${suffix}.${extension}`
}

function hasNativeAttachment(messages: readonly unknown[]): boolean {
  return messages.some(message => {
    const content = (message as { content?: unknown })?.content
    return Array.isArray(content) && content.some(part => {
      const type = (part as { type?: string })?.type
      return type === 'image_url' || type === 'file'
    })
  })
}

export function buildDirectAttachmentHttpError(
  status: number,
  messages: readonly unknown[],
): string | null {
  if (!hasNativeAttachment(messages)) return null
  if (status === 413) return '附件超过当前直传上限，请缩小文件后重试；原附件没有被删除。'
  if (status === 400 || status === 415) {
    return '当前模型或渠道不支持该附件协议；原附件没有被删除。'
  }
  if (status === 524) return '渠道处理附件超时，请稍后重试；原附件没有被删除。'
  return null
}

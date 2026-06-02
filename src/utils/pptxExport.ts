/**
 * Phase 3: 更多格式试点 - PPTX 导出骨架
 * 当前为简化实现，后续可使用 pptx 库或后端服务完善
 */

import type { JSONContent } from '@tiptap/core'

export async function createPptxFromTiptap(input: {
  title?: string
  json: JSONContent
}): Promise<Uint8Array> {
  // 临时：生成极简文本内容作为占位
  // 真实实现需要引入 'pptxgenjs' 或类似库，并解析 TipTap JSON 生成幻灯片
  const text = extractTextFromTiptap(input.json)
  const content = `幻灯片标题: ${input.title || '未命名演示'}\n\n${text}\n\n（此为 Phase 3 试点骨架，实际需替换为完整 PPTX 生成逻辑）`

  // 返回文本作为占位（实际应返回 .pptx 二进制）
  return new TextEncoder().encode(content)
}

function extractTextFromTiptap(json: JSONContent): string {
  let text = ''
  const traverse = (node: any) => {
    if (node.text) text += node.text + ' '
    if (node.content) node.content.forEach(traverse)
  }
  traverse(json)
  return text.trim()
}

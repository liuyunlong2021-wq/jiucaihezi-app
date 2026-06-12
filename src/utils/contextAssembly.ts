import { approximateTokenSize } from 'tokenx'

export type ContextAssemblyMode = 'fast' | 'balanced' | 'deep'

export interface ContextAssemblySection {
  name: string
  title: string
  content: string
}

export interface ContextAssemblyPlan {
  mode: ContextAssemblyMode
  sections: Array<{ name: string; tokens: number }>
}

export interface ContextAssemblyResult {
  prompt: string
  plan: ContextAssemblyPlan
}

export function assembleContextPrompt(input: {
  mode: ContextAssemblyMode
  sections: ContextAssemblySection[]
}): ContextAssemblyResult {
  const rendered: string[] = []
  const planSections: ContextAssemblyPlan['sections'] = []

  for (const section of input.sections) {
    const content = String(section.content || '').trim()
    if (!content) continue
    rendered.push(renderSection(section.title, content))
    planSections.push({
      name: section.name,
      tokens: approximateTokenSize(content),
    })
  }

  return {
    prompt: rendered.join('\n\n'),
    plan: {
      mode: input.mode,
      sections: planSections,
    },
  }
}

function renderSection(title: string, content: string): string {
  const safeTitle = String(title || '上下文').trim() || '上下文'
  return [
    `[${safeTitle}开始]`,
    content,
    `[${safeTitle}结束]`,
  ].join('\n')
}

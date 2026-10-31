export type CreationReferenceKind = 'image' | 'video' | 'audio'

const TOKEN_KIND = { '图': 'image', '视频': 'video', '音频': 'audio' } as const

export function isOfficialMediaReferenceQuery(query: string): boolean {
  return /^(?:图|视频|音频)\d*/.test(query)
}

export function trailingMediaSearch(prompt: string): string | null {
  const match = prompt.match(/@([^\s@]*)$/)
  if (!match) return null
  if (isOfficialMediaReferenceQuery(match[1])) return null
  return match[1]
}

export function referencedMediaSlots(prompt: string): Record<CreationReferenceKind, number> {
  const slots: Record<CreationReferenceKind, number> = { image: 0, video: 0, audio: 0 }
  for (const match of prompt.matchAll(/@(图|视频|音频)(\d+)/g)) {
    const slot = Number(match[2])
    if (slot > slots[TOKEN_KIND[match[1] as keyof typeof TOKEN_KIND]]) {
      slots[TOKEN_KIND[match[1] as keyof typeof TOKEN_KIND]] = slot
    }
  }
  return slots
}

export function mediaReferenceToken(kind: CreationReferenceKind, slot: number): string {
  const label = kind === 'image' ? '图' : kind === 'video' ? '视频' : '音频'
  return `@${label}${slot}`
}

export function validateMediaReferenceSlots(
  prompt: string,
  available: Record<CreationReferenceKind, number>,
): string | null {
  const referenced = referencedMediaSlots(prompt)
  for (const kind of ['image', 'video', 'audio'] as const) {
    if (referenced[kind] > available[kind]) {
      return `提示词引用了 ${mediaReferenceToken(kind, referenced[kind])}，但当前只有 ${available[kind]} 个对应参考素材`
    }
  }
  return null
}

export function sortCanvasReferences<T>(
  entries: T[],
  boundsOf: (entry: T) => { x: number; y: number; height?: number },
): T[] {
  return entries
    .map((entry, index) => ({ entry, index, bounds: boundsOf(entry) }))
    .sort((a, b) => {
      const rowTolerance = Math.max(24, Math.min(a.bounds.height || 0, b.bounds.height || 0) / 2)
      const yDistance = a.bounds.y - b.bounds.y
      if (Math.abs(yDistance) > rowTolerance) return yDistance
      return a.bounds.x - b.bounds.x || a.index - b.index
    })
    .map(({ entry }) => entry)
}

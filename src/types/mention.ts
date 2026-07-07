// 100% 照抄 OpenCode prompt-input.tsx L13-21
export type AtOption =
  | { type: 'agent'; name: string; display: string }
  | { type: 'resource'; name: string; uri: string; client: string; display: string; description?: string; mime?: string }
  | { type: 'reference'; name: string; path: string; display: string; description: string }
  | { type: 'file'; path: string; display: string; recent?: boolean }

// 100% 照抄 OpenCode slash-popover.tsx
export interface SlashCommand {
  id: string
  trigger: string
  title: string
  description?: string
  type: 'builtin' | 'custom'
}

import type {
  PermissionRuleset,
  Session,
  SessionMessage,
} from '@opencode-ai/sdk/v2'

import type { ChatMessage } from '@/composables/useChat'

export interface OpenCodeServerHandle {
  running: boolean
  url?: string
  authorization?: string
  pid?: number
  directory?: string
}

export interface OpenCodeModelProjection {
  providerID: string
  modelID: string
}

export interface OpenCodeSessionInput {
  title?: string
  directory?: string
  workspace?: string
  agent?: string
  model?: OpenCodeModelProjection
  permission?: PermissionRuleset
  metadata?: Record<string, unknown>
}

export type OpenCodePromptPart =
  | {
      id?: string
      type: 'text'
      text: string
      synthetic?: boolean
      ignored?: boolean
      time?: { start: number; end?: number }
      metadata?: Record<string, unknown>
    }
  | {
      id?: string
      type: 'file'
      mime: string
      filename?: string
      url: string
      source?: {
        type: 'resource'
        clientName: string
        uri: string
        text: { value: string; start: number; end: number }
      }
    }
  | {
      id?: string
      type: 'agent'
      name: string
      source?: { value: string; start: number; end: number }
    }
  | {
      id?: string
      type: 'subtask'
      prompt: string
      description: string
      agent: string
      model?: OpenCodeModelProjection
      command?: string
    }

export interface OpenCodePromptInput {
  sessionID: string
  directory?: string
  workspace?: string
  text: string
  system?: string
  agent?: string
  model?: OpenCodeModelProjection
  tools?: Record<string, boolean>
  images?: string[]
  files?: Array<{ name: string; content: string }>
  parts?: OpenCodePromptPart[]
}

export interface OpenCodeSessionState {
  session: Session
  messages: ChatMessage[]
}

export type OpenCodeSdkSessionMessage = SessionMessage

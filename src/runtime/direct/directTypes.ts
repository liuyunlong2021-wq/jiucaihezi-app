export interface DirectToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export type DirectApiMessage = Record<string, any>

export interface DirectToolResult {
  content: string
  status?: 'succeeded' | 'failed' | 'cancelled'
  followupMessages?: DirectApiMessage[]
}

export type DirectToolExecutor = (call: DirectToolCall) => Promise<DirectToolResult>

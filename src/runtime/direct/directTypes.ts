export interface DirectToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export type DirectApiMessage = Record<string, any>

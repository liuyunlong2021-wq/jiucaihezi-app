export type OpenCodeP3KeyAction =
  | 'focus-input'
  | 'message-previous'
  | 'message-next'
  | 'toggle-file-tree'
  | 'close-tab'

export interface OpenCodeP3KeyInput {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  isTextInput?: boolean
  isTauriRuntime?: boolean
  hasActiveEditorFile?: boolean
}

export function resolveOpenCodeP3KeyAction(input: OpenCodeP3KeyInput): OpenCodeP3KeyAction | null {
  if (input.isTextInput) return null
  const key = input.key
  const mod = Boolean(input.metaKey || input.ctrlKey)
  if (input.isTauriRuntime && input.ctrlKey && !input.metaKey && !input.altKey && !input.shiftKey && key.toLowerCase() === 'l') {
    return 'focus-input'
  }
  if (mod && input.altKey && !input.shiftKey && (key === '[' || key === ']')) {
    return key === '[' ? 'message-previous' : 'message-next'
  }
  if (mod && !input.altKey && !input.shiftKey && key === '\\') {
    return 'toggle-file-tree'
  }
  if (input.isTauriRuntime && input.hasActiveEditorFile && mod && !input.altKey && !input.shiftKey && key.toLowerCase() === 'w') {
    return 'close-tab'
  }
  return null
}

export function shouldShowTabCloseCommand(activeEditorFileId: string | null | undefined): boolean {
  return Boolean(activeEditorFileId)
}

export function shouldCloseEditorTabForEvent(currentFileId: string | null | undefined, payloadFileId: string | null | undefined): boolean {
  return Boolean(currentFileId && payloadFileId && currentFileId === payloadFileId)
}

export interface SafeEditorTabCloseOptions {
  getCurrentFileId: () => string | null | undefined
  payloadFileId: string | null | undefined
  saveCurrentFile: (closingFileId: string) => Promise<void>
  clearEditor: () => void
}

export async function closeEditorTabSafely(options: SafeEditorTabCloseOptions): Promise<boolean> {
  const closingFileId = options.getCurrentFileId()
  if (!shouldCloseEditorTabForEvent(closingFileId, options.payloadFileId)) return false

  await options.saveCurrentFile(String(closingFileId))

  if (options.getCurrentFileId() !== closingFileId) return false
  options.clearEditor()
  return true
}

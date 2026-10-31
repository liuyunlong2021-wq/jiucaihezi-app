const EXPLICIT_COMFY_MENTION = /(^|\s)@comfyui(?=\s|$)/gi

export function stripExplicitComfyMention(message: string): { explicit: boolean; message: string } {
  let explicit = false
  const stripped = message.replace(EXPLICIT_COMFY_MENTION, prefix => {
    explicit = true
    return prefix.startsWith(' ') ? ' ' : ''
  })
  return { explicit, message: stripped.replace(/\s{2,}/g, ' ').trim() }
}

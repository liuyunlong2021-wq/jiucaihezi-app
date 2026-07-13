export function stripInternalSystemReminders(text: string): string {
  return String(text || '').replace(/\s*<system-reminder>[\s\S]*?<\/system-reminder>\s*/gi, '\n').trim()
}

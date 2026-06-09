import type { AgentWithStatus, AiSettings, ScanDirectory } from '@/types/skillsManage'

export type ScanDirectoryFilterMode = 'all' | 'custom' | 'disabled'

function matchesQuery(values: Array<string | null | undefined>, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return values
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalized))
}

export function filterScanDirectories(
  directories: ScanDirectory[],
  input: { query: string; mode: ScanDirectoryFilterMode },
): ScanDirectory[] {
  return directories.filter((directory) => {
    if (input.mode === 'custom' && directory.is_builtin) return false
    if (input.mode === 'disabled' && directory.is_active) return false
    return matchesQuery([directory.path, directory.label], input.query)
  })
}

export function filterCustomPlatforms(agents: AgentWithStatus[]): AgentWithStatus[] {
  return agents.filter((agent) => !agent.is_builtin)
}

export function normalizeAiSettings(settings: AiSettings): AiSettings {
  return {
    provider: settings.provider.trim(),
    apiKey: settings.apiKey.trim(),
    model: settings.model.trim(),
    apiUrl: settings.apiUrl.trim(),
  }
}

export function formatSecretStatus(value: string | null | undefined): string {
  return value?.trim() ? '已保存，明文不会显示' : '未保存'
}

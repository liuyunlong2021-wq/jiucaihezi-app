import { loadWebSkillCatalog, type WebSkillCatalogEntry } from '@/utils/skillContentResolver'

export interface EcommerceWorkbenchFileField {
  id: string
  type: 'file'
  label: string
  required: true
  accept: ['image/*']
  maxFiles: 1
}

export interface EcommerceWorkbenchManifest {
  version: 1
  surface: 'ecommerce'
  title: string
  description: string
  action: { label: string; prompt: string }
  result: { label: string; heading: string }
  fields: [EcommerceWorkbenchFileField]
}

export interface EcommerceWorkbenchDefinition extends EcommerceWorkbenchManifest {
  skillId: string
  skillName: string
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 160
}

export function parseEcommerceWorkbenchManifest(value: unknown): EcommerceWorkbenchManifest | null {
  if (!value || typeof value !== 'object') return null
  const manifest = value as Record<string, unknown>
  const action = manifest.action as Record<string, unknown> | null
  const result = manifest.result as Record<string, unknown> | null
  const fields = manifest.fields
  if (manifest.version !== 1 || manifest.surface !== 'ecommerce' || !text(manifest.title) || !text(manifest.description)) return null
  if (!action || !text(action.label) || !text(action.prompt) || !Array.isArray(fields) || fields.length !== 1) return null
  if (!result || !text(result.label) || !text(result.heading)) return null

  const field = fields[0] as Record<string, unknown> | null
  if (!field || !text(field.id) || field.type !== 'file' || !text(field.label) || field.required !== true || field.maxFiles !== 1) return null
  if (!Array.isArray(field.accept) || field.accept.length !== 1 || field.accept[0] !== 'image/*') return null

  return {
    version: 1,
    surface: 'ecommerce',
    title: manifest.title.trim(),
    description: manifest.description.trim(),
    action: { label: action.label.trim(), prompt: action.prompt.trim() },
    result: { label: result.label.trim(), heading: result.heading.trim() },
    fields: [{ id: field.id.trim(), type: 'file', label: field.label.trim(), required: true, accept: ['image/*'], maxFiles: 1 }],
  }
}

export function extractEcommerceWorkbenchResult(content: string, heading: string): string {
  const source = String(content || '').trim()
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`(?:^|\\n)#{1,6}\\s*${escapedHeading}\\s*\\n([\\s\\S]*?)(?=\\n#{1,6}\\s|$)`))
  return (match?.[1] || source).trim()
}

function skillAssetUrl(skill: WebSkillCatalogEntry): string {
  const id = skill.id.split('/').map(encodeURIComponent).join('/')
  return `/skills/${id}/workbench.json`
}

export async function loadEcommerceWorkbenchDefinitions(fetcher: typeof fetch = fetch): Promise<EcommerceWorkbenchDefinition[]> {
  const catalog = await loadWebSkillCatalog(fetcher, { refresh: true })
  const candidates = catalog.filter(skill => skill.files.includes('workbench.json'))
  const definitions = await Promise.all(candidates.map(async skill => {
    try {
      const response = await fetcher(skillAssetUrl(skill))
      if (!response.ok) return null
      const manifest = parseEcommerceWorkbenchManifest(await response.json())
      return manifest ? { ...manifest, skillId: skill.id, skillName: skill.name } : null
    } catch {
      return null
    }
  }))
  return definitions.filter((definition): definition is EcommerceWorkbenchDefinition => Boolean(definition))
}

import { catalog as fkCatalog } from '../../../newapi-plugins/fk.plugin.js'

// NewAPI 插件 `catalog` 导出的面板目录（jc-catalog-v1）。内置条目来自打包时的插件，
// 运行时可被可用性服务下发的同渠道目录整体替换。只接已有 App 适配的渠道。
export const CATALOG_CHANNELS = ['fk'] as const
export type CatalogChannel = (typeof CATALOG_CHANNELS)[number]

export interface PluginCatalogModel {
  channel: CatalogChannel
  name: string
  upstream: string
  task: 'video'
  group: string
  ratios: string[]
  resolutions: string[]
  duration: { min?: number; max?: number; values?: number[]; default: number }
  refs: { images: number; videos: number; audios: number }
  promptMax?: number
  billing: 'second' | 'request' | 'token-with-video'
  price: string
}

export interface PluginCatalog {
  schema: 'jc-catalog-v1'
  models: Array<Omit<PluginCatalogModel, 'channel'>>
}

const BILLING = ['second', 'request', 'token-with-video']

function text(value: unknown, max: number, pattern?: RegExp): string | undefined {
  if (typeof value !== 'string' || !value.trim() || value.length > max) return undefined
  return pattern && !pattern.test(value) ? undefined : value
}

function int(value: unknown, min: number, max: number): number | undefined {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max ? value as number : undefined
}

function textList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > 12) return undefined
  const items = value.map(item => text(item, 16))
  return items.every(Boolean) ? items as string[] : undefined
}

function duration(value: unknown): PluginCatalogModel['duration'] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const fallback = int(raw.default, 1, 600)
  if (fallback === undefined) return undefined
  if (raw.values !== undefined) {
    if (!Array.isArray(raw.values) || !raw.values.length || raw.values.length > 30) return undefined
    const values = raw.values.map(item => int(item, 1, 600))
    if (!values.every(item => item !== undefined) || !values.includes(fallback)) return undefined
    return { values: values as number[], default: fallback }
  }
  const min = int(raw.min, 1, 600)
  const max = int(raw.max, 1, 600)
  if (min === undefined || max === undefined || min > max || fallback < min || fallback > max) return undefined
  return { min, max, default: fallback }
}

export function parsePluginCatalogModel(value: unknown): PluginCatalogModel | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const channel = CATALOG_CHANNELS.find(item => item === raw.channel)
  const refs = raw.refs && typeof raw.refs === 'object' ? raw.refs as Record<string, unknown> : {}
  const model = {
    channel,
    name: text(raw.name, 120),
    upstream: text(raw.upstream, 120, /^[\w.:-]+$/),
    group: text(raw.group, 40),
    ratios: textList(raw.ratios),
    resolutions: textList(raw.resolutions),
    duration: duration(raw.duration),
    refs: { images: int(refs.images, 0, 100), videos: int(refs.videos, 0, 100), audios: int(refs.audios, 0, 100) },
    promptMax: raw.promptMax === undefined ? undefined : int(raw.promptMax, 1, 100000),
    billing: BILLING.includes(raw.billing as string) ? raw.billing as PluginCatalogModel['billing'] : undefined,
    price: raw.price === undefined ? '' : text(raw.price, 80),
  }
  if (raw.task !== 'video' || Object.values(model.refs).includes(undefined) || (raw.promptMax !== undefined && !model.promptMax)) return undefined
  if (Object.entries(model).some(([key, item]) => item === undefined && key !== 'promptMax')) return undefined
  return { ...model, task: 'video' } as PluginCatalogModel
}

const BUILT_IN: Record<CatalogChannel, PluginCatalogModel[]> = {
  fk: fkCatalog.models.flatMap(model => parsePluginCatalogModel({ ...model, channel: 'fk' }) || []),
}

const current = new Map<CatalogChannel, PluginCatalogModel[]>(Object.entries(BUILT_IN) as Array<[CatalogChannel, PluginCatalogModel[]]>)

export function builtInCatalogModels(channel: CatalogChannel): PluginCatalogModel[] {
  return BUILT_IN[channel]
}

export function catalogModels(channel: CatalogChannel): PluginCatalogModel[] {
  return current.get(channel) || []
}

export function setCatalogModels(channel: CatalogChannel, models: PluginCatalogModel[]): void {
  current.set(channel, models)
}

// 目录型号的成片都经 NewAPI 宿主 content 代理交付。
export function isCatalogVideoModelName(value: string): boolean {
  const name = String(value || '').trim().toLowerCase()
  return [...current.values()].some(models => models.some(model => model.name.toLowerCase() === name || model.upstream.toLowerCase() === name))
}

import { catalogMediaCapability, replaceCatalogMediaCapabilities } from '@/data/mediaModelCapabilities'
import { catalogVideoSpec, getCreationModelSpec, replaceCatalogVideoSpecs } from './creationModelRegistry'
import {
  CATALOG_CHANNELS,
  builtInCatalogModels,
  catalogModels,
  parsePluginCatalogModel,
  setCatalogModels,
  type CatalogChannel,
  type PluginCatalogModel,
} from './pluginCatalog'

export { parsePluginCatalogModel }

// 可用性服务下发的插件目录：替换同渠道的内置条目，并缓存最近一次结果供离线启动使用。
const STORAGE_KEY = 'jc-creation-plugin-catalog-v1'

interface CatalogStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function defaultStorage(): CatalogStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function install(channel: CatalogChannel, models: PluginCatalogModel[]): boolean {
  const previous = catalogModels(channel)
  if (JSON.stringify(previous) === JSON.stringify(models)) return false
  setCatalogModels(channel, models)
  replaceCatalogVideoSpecs(channel, models.map(catalogVideoSpec))
  replaceCatalogMediaCapabilities(previous, models.map(catalogMediaCapability))
  return true
}

// 名称或 ID 已被非目录模型占用的型号不接收，避免下发数据覆盖其他渠道。
function claimable(model: PluginCatalogModel): boolean {
  const owner = getCreationModelSpec(`newapi/${model.channel}/${model.upstream}`) || safeLookup(model.name)
  return !owner || owner.group !== undefined
}

function safeLookup(name: string) {
  try {
    return getCreationModelSpec(name)
  } catch {
    return { group: undefined }
  }
}

function groupByChannel(items: unknown[]): Map<CatalogChannel, PluginCatalogModel[]> {
  const grouped = new Map<CatalogChannel, PluginCatalogModel[]>()
  for (const item of items) {
    const model = parsePluginCatalogModel(item)
    if (!model || !claimable(model)) continue
    grouped.set(model.channel, [...(grouped.get(model.channel) || []), model])
  }
  return grouped
}

export function applyRemoteCatalog(items: Array<{ spec?: unknown }>, storage: CatalogStorage | null = defaultStorage()): boolean {
  const grouped = groupByChannel(items.map(item => item.spec).filter(Boolean))
  let changed = false
  for (const [channel, models] of grouped) changed = install(channel, models) || changed
  if (grouped.size) {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify([...grouped.values()].flat()))
    } catch {
      // 缓存只是离线兜底，写入失败不影响本次目录。
    }
  }
  return changed
}

// storage 为 null 时回到打包时的内置目录。
export function restoreRemoteCatalog(storage: CatalogStorage | null = defaultStorage()): boolean {
  let cached: unknown[] = []
  try {
    const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) || '[]')
    cached = Array.isArray(parsed) ? parsed : []
  } catch {
    cached = []
  }
  const grouped = groupByChannel(cached)
  let changed = false
  for (const channel of CATALOG_CHANNELS) changed = install(channel, grouped.get(channel) || builtInCatalogModels(channel)) || changed
  return changed
}

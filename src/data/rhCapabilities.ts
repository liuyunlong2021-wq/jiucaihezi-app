/**
 * rhCapabilities.ts — RunningHub 官方端点能力（来自 capabilities.json）
 *
 * 这是前端关于 RH 模型参数（比例/分辨率/时长等）的唯一事实源。
 * 与 rh-adapter/src/models/capabilities.json 保持同步。
 *
 * 使用方式：
 *   import { getRhEndpointCapability } from '@/data/rhCapabilities'
 *   const cap = getRhEndpointCapability('rhart-video-g/text-to-video')
 *   // cap.params → [{ key: 'aspectRatio', options: ['2:3', ...] }, ...]
 */
import capabilitiesData from './rhCapabilities.json'

interface RhEndpointCapability {
  endpoint: string
  name_cn?: string
  name_en?: string
  task?: string
  output_type?: string
  params: RhParam[]
}

interface RhParam {
  key: string
  type: string
  required?: boolean
  default?: unknown
  options?: string[]
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  maxCount?: number
  multiple?: boolean
}

const endpoints = (() => {
  const data = capabilitiesData as any
  const list: RhEndpointCapability[] = Array.isArray(data) ? data : data.endpoints || []
  return list
})()

const byEndpoint = new Map<string, RhEndpointCapability>()
for (const ep of endpoints) {
  if (ep.endpoint) byEndpoint.set(ep.endpoint, ep)
}

/** 根据 RH 端点路径获取官方能力（含 params） */
export function getRhEndpointCapability(endpoint: string): RhEndpointCapability | undefined {
  return byEndpoint.get(endpoint)
}

/** 获取某个参数的选项列表（如 aspectRatio 的比例选项） */
export function getRhParamOptions(endpoint: string, paramKey: string): string[] {
  const cap = byEndpoint.get(endpoint)
  if (!cap) return []
  const param = cap.params.find(p => p.key === paramKey)
  return param?.options || []
}

/** 获取某个参数的数值范围（如 duration 的 min/max） */
export function getRhParamRange(endpoint: string, paramKey: string): { min: number; max: number } | undefined {
  const cap = byEndpoint.get(endpoint)
  if (!cap) return undefined
  const param = cap.params.find(p => p.key === paramKey)
  if (param?.min !== undefined && param?.max !== undefined) {
    return { min: param.min, max: param.max }
  }
  return undefined
}

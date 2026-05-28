/**
 * mediaKeyStore.ts — 媒体生成独立 Key 管理
 *
 * 对标 T8 src/stores/apiKeys.ts
 *
 * Key 结构:
 *   imageKey     → GPT Image 2 + Nano Banana 2K/4K
 *   videoKey     → Veo 3.1 + Grok Video 3
 *   seedanceKey  → Seedance 2.0 (火山引擎 ark)
 *   sunoKey      → Suno 音频生成
 *   rhKey        → RunningHub 工作流
 *
 * 留空 = fallback 到 Gateway 统一 token
 * 存储: Tauri keychain (0600 权限), 内存缓存加速
 */
import { ref } from 'vue'

const PREFIX = 'jc_media_key_'

// 内存缓存
const _cache: Record<string, string> = {}

// Key 定义
export interface MediaKeyDef {
  id: string           // 存储 key
  label: string        // 显示名
  desc: string         // 描述
  baseUrl: string      // 对应 API base
  models: string[]     // 覆盖的模型
}

export const MEDIA_KEYS: MediaKeyDef[] = [
  {
    id: 'imageKey',
    label: '图片生成 Key',
    desc: 'GPT Image 2 / Nano Banana 共用',
    baseUrl: 'https://api.jiucaihezi.studio',
    models: ['gpt-image-2', 'nano-banana-2k', 'nano-banana-4k'],
  },
  {
    id: 'videoKey',
    label: '视频生成 Key',
    desc: 'Veo 3.1 / Grok Video 3 共用',
    baseUrl: 'https://api.jiucaihezi.studio',
    models: ['veo3.1-fast', 'grok-video-3'],
  },
  {
    id: 'seedanceKey',
    label: 'Seedance Key',
    desc: '火山引擎 Seedance 2.0',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: ['seedance-2-0-pro', 'seedance-2-0-fast', 'doubao-seedance-1-0-pro'],
  },
  {
    id: 'sunoKey',
    label: 'Suno Key',
    desc: 'Suno 音频生成',
    baseUrl: 'https://api.jiucaihezi.studio',
    models: ['suno_music', 'suno-custom-song'],
  },
  {
    id: 'rhKey',
    label: 'RunningHub Key',
    desc: 'RunningHub 工作流',
    baseUrl: 'https://www.runninghub.cn',
    models: ['rh-mimic', 'rh-digital-human-fast', 'rh-digital-human', 'rh-voice-clone', 'rh-voice-design'],
  },
]

// ── 读写 ──

function storageKey(id: string): string {
  return `${PREFIX}${id}`
}

async function invokeGet(key: string): Promise<string | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<string | null>('get_media_key', { key })
  } catch { return null }
}

async function invokeSet(key: string, value: string): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('set_media_key', { key, value })
  } catch { /* 浏览器降级: 用 localStorage */ }
}

async function invokeDel(key: string): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('delete_media_key', { key })
  } catch {}
}

// ── 公开 API ──

export async function initMediaKeys(): Promise<void> {
  for (const def of MEDIA_KEYS) {
    const k = storageKey(def.id)
    // 先从 keychain 读
    const v = await invokeGet(k)
    if (v) { _cache[def.id] = v; continue }
    // 降级 localStorage
    if (typeof localStorage !== 'undefined') {
      const ls = localStorage.getItem(k)
      if (ls) { _cache[def.id] = ls; await invokeSet(k, ls) }
    }
  }
}

export function getMediaKey(id: string): string {
  return _cache[id] || ''
}

export async function setMediaKey(id: string, value: string): Promise<void> {
  const clean = value.trim()
  _cache[id] = clean
  const k = storageKey(id)
  // 先写 keychain
  await invokeSet(k, clean)
  // 同步写 localStorage（降级）
  if (typeof localStorage !== 'undefined') {
    if (clean) localStorage.setItem(k, clean)
    else localStorage.removeItem(k)
  }
}

export async function clearMediaKey(id: string): Promise<void> {
  _cache[id] = ''
  const k = storageKey(id)
  await invokeDel(k)
  if (typeof localStorage !== 'undefined') localStorage.removeItem(k)
}

export async function clearAllMediaKeys(): Promise<void> {
  for (const def of MEDIA_KEYS) {
    await clearMediaKey(def.id)
  }
}

/**
 * 根据模型 ID 查找对应的独立 Key 和 baseUrl
 * 返回 null 表示没有配置独立 key → fallback 到 Gateway
 */
export function resolveMediaAuth(model: string): { apiKey: string; apiBase: string } | null {
  const def = MEDIA_KEYS.find(d => d.models.includes(model))
  if (!def) return null
  const key = getMediaKey(def.id)
  if (!key) return null
  return { apiKey: key, apiBase: def.baseUrl }
}

// Vue composable
export function useMediaKeys() {
  const keys = ref<Record<string, string>>({})
  const loading = ref(false)

  async function load() {
    loading.value = true
    await initMediaKeys()
    const map: Record<string, string> = {}
    for (const def of MEDIA_KEYS) map[def.id] = getMediaKey(def.id)
    keys.value = map
    loading.value = false
  }

  async function save(id: string, value: string) {
    await setMediaKey(id, value)
    keys.value = { ...keys.value, [id]: value }
  }

  async function clear(id: string) {
    await clearMediaKey(id)
    keys.value = { ...keys.value, [id]: '' }
  }

  return { keys, loading, load, save, clear, definitions: MEDIA_KEYS }
}

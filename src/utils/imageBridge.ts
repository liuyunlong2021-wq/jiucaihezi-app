/**
 * imageBridge.ts — 图片桥接：用轻量 vision 模型描述图片，让 text-only 模型间接收"读图"
 *
 * 类似 VS Code Copilot Chat 的透明桥接机制：
 *   用户贴图 → 调 vision 模型描述 → 文字注入 user message → text 模型正常回答
 *
 * 缓存：同一张图（同 base64 URL）只描述一次，会话内复用。
 */

import { buildHeaders, type ApiConfig } from './api'

/** 桥接用的 vision 模型：便宜、快、描述质量好 */
const BRIDGE_MODEL = 'claude-haiku-4-5'
const BRIDGE_TIMEOUT_MS = 12_000
const BRIDGE_MAX_TOKENS = 200

/** 图片 URL → 文字描述 缓存（同一会话内复用） */
const imageCache = new Map<string, string>()

export function clearImageCache() {
  imageCache.clear()
}

/**
 * 用 BRIDGE_MODEL 描述一组图片，返回 Map<图片URL, 描述文字>
 * 已缓存的图片不重复调用。
 */
export async function describeImages(
  images: string[],
  config: ApiConfig,
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const result = new Map<string, string>()

  // 先查缓存
  const uncached = images.filter(img => {
    const cached = imageCache.get(img)
    if (cached) { result.set(img, cached); return false }
    return true
  })

  if (uncached.length === 0) return result

  // 并发描述 + 超时保护
  const settled = await Promise.allSettled(
    uncached.map(async (img) => {
      const ctrl = new AbortController()
      const timeout = setTimeout(() => ctrl.abort(), BRIDGE_TIMEOUT_MS)
      const mergedSignal = signal
        ? anySignal([signal, ctrl.signal])
        : ctrl.signal

      try {
        const resp = await fetch(config.apiBase + '/v1/chat/completions', {
          method: 'POST',
          signal: mergedSignal,
          headers: buildHeaders(config),
          body: JSON.stringify({
            model: BRIDGE_MODEL,
            messages: [{
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: img } },
                { type: 'text', text: '用一句中文客观描述这张图片的内容，不要添加评论。' },
              ],
            }],
            max_tokens: BRIDGE_MAX_TOKENS,
            stream: false,
          }),
        })

        if (!resp.ok) {
          const errText = await resp.text().catch(() => '')
          throw new Error(`Bridge API ${resp.status}: ${errText.slice(0, 200)}`)
        }

        const data = await resp.json() as {
          choices?: Array<{ message?: { content?: string } }>
        }
        const desc = data?.choices?.[0]?.message?.content?.trim() || '[图片]'
        imageCache.set(img, desc)
        return { img, desc }
      } finally {
        clearTimeout(timeout)
      }
    }),
  )

  for (const r of settled) {
    if (r.status === 'fulfilled') {
      result.set(r.value.img, r.value.desc)
    }
    // rejected → 图片无描述，buildApiMessages 会用 '[图片]' 占位
  }

  return result
}

/** 简易 AbortSignal 合并（兼容不支持 AbortSignal.any 的环境） */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const ctrl = new AbortController()
  for (const s of signals) {
    if (s.aborted) { ctrl.abort(s.reason); break }
    s.addEventListener('abort', () => ctrl.abort(s.reason), { once: true })
  }
  return ctrl.signal
}

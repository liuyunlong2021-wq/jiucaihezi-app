/**
 * utils/httpClient.ts — Tauri HTTP 桥接工具
 *
 * 核心思路：绕过 @tauri-apps/plugin-http 的 JS fetch() 封装。
 * 该插件内部 `new Request(url).arrayBuffer()` 在 WKWebView 中触发
 * WebKit 资源拦截导致 "Load failed"。
 *
 * 改用自定义 Rust Command（lib.rs 中的 http_request）直接走 reqwest。
 */

import { isTauriRuntime } from './tauriEnv'

interface RustHttpResponse {
  status: number
  headers: Record<string, string>
  body: string
}

function canUseRustFetch(init?: RequestInit): boolean {
  if (!init?.body) return true
  return typeof init.body === 'string'
}

/**
 * 通过 Tauri Rust Command 发 HTTP 请求
 */
async function rustFetch(url: string, init?: RequestInit): Promise<Response> {
  const { invoke } = await import('@tauri-apps/api/core')

  const headers: Record<string, string> = {}
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => { headers[k] = v })
    } else if (Array.isArray(init.headers)) {
      for (const [k, v] of init.headers) { headers[k] = v }
    } else {
      Object.assign(headers, init.headers)
    }
  }

  let body: string | undefined
  if (init?.body) {
    body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body)
  }

  const result = await invoke<RustHttpResponse>('http_request', {
    request: {
      url,
      method: init?.method || 'GET',
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body,
    },
  })

  const respHeaders = new Headers(result.headers)
  return new Response(result.body, {
    status: result.status,
    headers: respHeaders,
  })
}

/**
 * 安全的 fetch — Tauri 环境走 Rust Command，浏览器走原生
 */
export async function safeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (isTauriRuntime()) {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input instanceof Request
          ? input.url
          : String(input)

    if ((url.startsWith('http://') || url.startsWith('https://')) && canUseRustFetch(init)) {
      return rustFetch(url, init)
    }
  }
  return fetch(input, init)
}

/**
 * 用系统默认浏览器打开外部 URL
 */
export async function openExternal(url: string): Promise<void> {
  if (isTauriRuntime()) {
    try {
      const { open } = await import('@tauri-apps/plugin-shell')
      await open(url)
      return
    } catch (e) {
      console.warn('[JC] shell.open 失败:', e)
    }
  }
  window.open(url, '_blank')
}

/**
 * 全局 monkey-patch window.fetch — 所有外部请求走 Rust Command
 */
export async function patchFetch(): Promise<void> {
  if (!isTauriRuntime()) {
    console.warn('[JC] 非 Tauri 环境，跳过 patchFetch')
    return
  }

  const nativeFetch = window.fetch.bind(window)

  window.fetch = function (input: any, init?: any): Promise<Response> {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input instanceof Request
          ? input.url
          : ''

    if ((url.startsWith('http://') || url.startsWith('https://')) && canUseRustFetch(init)) {
      return rustFetch(url, init)
    }
    return nativeFetch(input, init)
  }

  console.log('[JC] 全局 fetch 已劫持 → Rust HTTP Command')
}

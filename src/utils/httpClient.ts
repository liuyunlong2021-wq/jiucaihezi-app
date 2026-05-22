/**
 * utils/httpClient.ts — Tauri HTTP 桥接工具
 *
 * 两条通道：
 *   1. rustFetch — 非流式请求，走 Rust http_request command（一次性返回）
 *   2. rustFetchStream — 流式请求（SSE），走 Rust http_request_stream command
 *      通过 Tauri Channel 逐块推送，JS 用 ReadableStream 包装，实现真正的实时流式输出
 *
 * patchFetch() 全局劫持 window.fetch：
 *   - 检测到 stream:true 的请求 → rustFetchStream
 *   - 其他外部请求 → rustFetch
 *   - 内部请求 → 原生 fetch
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
 * 检测请求是否包含 stream:true（SSE 流式请求）
 */
function isStreamingRequest(init?: RequestInit): boolean {
  if (!init?.body || typeof init.body !== 'string') return false
  try {
    const parsed = JSON.parse(init.body)
    return parsed.stream === true
  } catch {
    return false
  }
}

/**
 * 提取请求头为普通对象
 */
function extractHeaders(init?: RequestInit): Record<string, string> {
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
  return headers
}

/**
 * 非流式请求 — 通过 Tauri Rust Command 发 HTTP
 */
async function rustFetch(url: string, init?: RequestInit): Promise<Response> {
  const { invoke } = await import('@tauri-apps/api/core')

  const headers = extractHeaders(init)
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
 * 流式请求 — 通过 Tauri Channel 实现真正的 SSE 流式传输
 *
 * 流程：
 *   1. 创建 Tauri Channel，注册 onmessage 回调
 *   2. 调用 Rust http_request_stream，传入 channel
 *   3. Rust 端逐块推送 { event: "headers"|"chunk"|"done"|"error" }
 *   4. JS 用 ReadableStream 包装，返回标准 Response 对象
 *   5. useChat.ts 的 SSE 解析器照常调用 res.body.getReader()
 */
async function rustFetchStream(url: string, init?: RequestInit): Promise<Response> {
  const { invoke, Channel } = await import('@tauri-apps/api/core')

  const headers = extractHeaders(init)
  let body: string | undefined
  if (init?.body) {
    body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body)
  }

  return new Promise<Response>((resolve, reject) => {
    const channel = new Channel<{
      event: 'headers' | 'chunk' | 'done' | 'error'
      status?: number
      headers?: Record<string, string>
      data?: string
      message?: string
    }>()

    let controller: ReadableStreamDefaultController<Uint8Array>
    let resolved = false
    const encoder = new TextEncoder()

    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
      },
      cancel() {
        // 用户取消（AbortController.abort）
        // Channel 会被 GC，Rust 端 send 会失败并退出循环
      },
    })

    channel.onmessage = (msg) => {
      switch (msg.event) {
        case 'headers':
          if (!resolved) {
            resolved = true
            const respHeaders = new Headers(msg.headers || {})
            resolve(new Response(stream, {
              status: msg.status || 200,
              headers: respHeaders,
            }))
          }
          break

        case 'chunk':
          if (msg.data) {
            try {
              controller.enqueue(encoder.encode(msg.data))
            } catch {
              // stream 可能已被取消
            }
          }
          break

        case 'done':
          try {
            controller.close()
          } catch {
            // 可能已关闭
          }
          break

        case 'error':
          if (!resolved) {
            resolved = true
            reject(new Error(msg.message || 'Stream error'))
          } else {
            try {
              controller.error(new Error(msg.message || 'Stream error'))
            } catch {
              // 可能已关闭
            }
          }
          break
      }
    }

    invoke('http_request_stream', {
      request: {
        url,
        method: init?.method || 'POST',
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body,
      },
      onChunk: channel,
    }).catch((err) => {
      if (!resolved) {
        resolved = true
        reject(err)
      }
    })
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
      if (isStreamingRequest(init)) {
        return rustFetchStream(url, init)
      }
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
 *
 * 流式请求（body 含 stream:true）→ rustFetchStream（Channel 逐块推送）
 * 非流式请求 → rustFetch（一次性返回）
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
      if (isStreamingRequest(init)) {
        return rustFetchStream(url, init)
      }
      return rustFetch(url, init)
    }
    return nativeFetch(input, init)
  }

  console.log('[JC] 全局 fetch 已劫持 → Rust HTTP Command（支持流式）')
}

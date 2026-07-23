import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'

import { sendWebCloudMessage } from '../web/chatCloud'
import type { ChatMessage } from '../useChat'
import { useAgentStore, type ModelEntry } from '../../stores/agentStore'
import { __resetApiKeyMemoryCacheForTests } from '../../services/newApiClient'

function installStorage(values: Record<string, string> = {}) {
  const store = new Map(Object.entries(values))
  const previousStorage = (globalThis as any).localStorage
  const previousWindow = (globalThis as any).window
  ;(globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  }
  ;(globalThis as any).window = {}
  return () => {
    ;(globalThis as any).localStorage = previousStorage
    ;(globalThis as any).window = previousWindow
  }
}

function createMessages() {
  const messages: ChatMessage[] = [{
    id: 'user-cloud',
    role: 'user',
    content: '分析这个视频',
    timestamp: Date.now(),
  }]
  const assistant: ChatMessage = {
    id: 'assistant-cloud',
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
  }
  return { messages, assistant }
}

function setModels(models: ModelEntry[]) {
  const agentStore = useAgentStore()
  agentStore.availableModels = models
}

const primaryTextModel: ModelEntry = {
  id: 'gpt-5.6-terra',
  label: 'GPT-5.6 Terra',
  providerId: 'jiucaihezi',
  capability: 'text',
  inputModalities: ['text'],
}

const sameProviderGemini: ModelEntry = {
  id: 'gemini-3.5-flash',
  label: 'Gemini 3.5 Flash',
  providerId: 'jiucaihezi',
  capability: 'text',
  inputModalities: ['text', 'image', 'video', 'audio', 'file'],
}

const videoAttachment = {
  id: 'video-cloud',
  name: 'clip.mp4',
  mime: 'video/mp4',
  size: 4,
  kind: 'video' as const,
  value: 'data:video/mp4;base64,AAAA',
}

function skillCatalogResponse(url: string | URL | Request): Response | null {
  return String(url).includes('/skills/index.json')
    ? new Response('[]', { headers: { 'content-type': 'application/json' } })
    : null
}

test('Web creative mode never uploads local-model media to a cloud fallback', async () => {
  const restoreStorage = installStorage({
    jcModel: 'qwen3:8b',
    jcModelProviderId: 'local-ollama',
  })
  const previousFetch = globalThis.fetch
  let fetches = 0
  globalThis.fetch = async () => {
    fetches += 1
    throw new Error('cloud fetch must not run')
  }
  try {
    setActivePinia(createPinia())
    const messages: ChatMessage[] = [{
      id: 'user-local',
      role: 'user',
      content: '分析这个视频',
      timestamp: Date.now(),
    }]
    const assistant: ChatMessage = {
      id: 'assistant-local',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    }

    await assert.rejects(
      () => sendWebCloudMessage({
        modelId: 'qwen3:8b',
        modelProviderId: 'local-ollama',
        modelAttachments: [{
          id: 'video-local',
          name: 'clip.mp4',
          mime: 'video/mp4',
          size: 4,
          kind: 'video',
          value: 'data:video/mp4;base64,AAAA',
        }],
      }, 1, new AbortController(), assistant, () => {}, () => 1, messages),
      /Web 创模式当前不能运行本地模型/,
    )

    assert.equal(fetches, 0)
    assert.equal(messages.at(-1)?.id, 'assistant-local')
    assert.match(String(messages.at(-1)?.content), /不能运行本地模型/)
  } finally {
    globalThis.fetch = previousFetch
    restoreStorage()
  }
})

test('Web cloud config failure stays visible and rejects so attachments are retained', async () => {
  const restoreStorage = installStorage()
  const previousFetch = globalThis.fetch
  __resetApiKeyMemoryCacheForTests('')
  globalThis.fetch = async () => { throw new Error('fetch must not run') }
  try {
    setActivePinia(createPinia())
    setModels([primaryTextModel])
    const { messages, assistant } = createMessages()
    await assert.rejects(
      () => sendWebCloudMessage({
        modelId: primaryTextModel.id,
        modelProviderId: 'jiucaihezi',
        modelAttachments: [videoAttachment],
      }, 1, new AbortController(), assistant, () => {}, () => 1, messages),
      /当前没有可用于模型调用的 API Key/,
    )
    assert.equal(messages.at(-1)?.finishReason, 'web_cloud_login_required')
    assert.match(String(messages.at(-1)?.content), /请先登录/)
  } finally {
    __resetApiKeyMemoryCacheForTests('')
    globalThis.fetch = previousFetch
    restoreStorage()
  }
})

test('Web sends MP4 once to the selected model even when it explicitly declares text-only input', async () => {
  const key = 'sk-cloud-test-12345678901234567890'
  const restoreStorage = installStorage({ jcApiKey: key })
  const previousFetch = globalThis.fetch
  const completionBodies: any[] = []
  __resetApiKeyMemoryCacheForTests(key)
  globalThis.fetch = async (input, init) => {
    const catalog = skillCatalogResponse(input)
    if (catalog) return catalog
    completionBodies.push(JSON.parse(String(init?.body || '{}')))
    return new Response(JSON.stringify({ choices: [{ message: { content: '完成' } }] }), {
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    setActivePinia(createPinia())
    setModels([primaryTextModel, sameProviderGemini])
    const { messages, assistant } = createMessages()
    await sendWebCloudMessage({
      modelId: primaryTextModel.id,
      modelProviderId: 'jiucaihezi',
      modelAttachments: [videoAttachment],
    }, 1, new AbortController(), assistant, () => {}, () => 1, messages)
    assert.equal(completionBodies.length, 1)
    assert.equal(completionBodies[0]?.model, primaryTextModel.id)
    assert.match(JSON.stringify(completionBodies[0]), /data:video\/mp4;base64,AAAA/)
  } finally {
    __resetApiKeyMemoryCacheForTests('')
    globalThis.fetch = previousFetch
    restoreStorage()
  }
})

test('dao sends one empty-tool request with the original attachment and no Skill lookup', async () => {
  const key = 'sk-cloud-test-12345678901234567890'
  const restoreStorage = installStorage({ jcApiKey: key, jcWebSearchEnabled: 'true' })
  const previousFetch = globalThis.fetch
  const requests: Array<{ url: string; body: any }> = []
  __resetApiKeyMemoryCacheForTests(key)
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body || '{}')) })
    return new Response(JSON.stringify({ choices: [{ message: { content: '完成' } }] }), {
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    setActivePinia(createPinia())
    setModels([primaryTextModel])
    const { messages, assistant } = createMessages()
    await sendWebCloudMessage({
      chatMode: 'dao',
      modelId: primaryTextModel.id,
      modelProviderId: 'jiucaihezi',
      modelAttachments: [videoAttachment],
    }, 1, new AbortController(), assistant, () => {}, () => 1, messages)

    assert.equal(requests.length, 1)
    assert.match(requests[0].url, /\/v1\/chat\/completions$/)
    assert.equal(requests[0].body.tools, undefined)
    assert.equal(requests[0].body.max_tokens, undefined)
    assert.equal(requests[0].body.messages.some((message: any) => message.role === 'system'), false)
    const videoPart = requests[0].body.messages
      .flatMap((message: any) => Array.isArray(message.content) ? message.content : [])
      .find((part: any) => part.type === 'video_url')
    assert.deepEqual(videoPart, { type: 'video_url', video_url: 'data:video/mp4;base64,AAAA' })
    assert.equal(requests[0].body.messages
      .flatMap((message: any) => Array.isArray(message.content) ? message.content : [])
      .some((part: any) => part.type === 'file' && part.file?.filename === 'clip.mp4'), false)
  } finally {
    __resetApiKeyMemoryCacheForTests('')
    globalThis.fetch = previousFetch
    restoreStorage()
  }
})

test('Web forwards text-only model attachments to the upstream without suggesting automatic local tools', async () => {
  const key = 'sk-cloud-test-12345678901234567890'
  const restoreStorage = installStorage({ jcApiKey: key })
  const previousFetch = globalThis.fetch
  __resetApiKeyMemoryCacheForTests(key)
  let modelFetches = 0
  try {
    setActivePinia(createPinia())
    setModels([primaryTextModel, sameProviderGemini])
    globalThis.fetch = async input => {
      const catalog = skillCatalogResponse(input)
      if (catalog) return catalog
      modelFetches += 1
      return new Response('', { status: 500 })
    }

    const { messages, assistant } = createMessages()
    await assert.rejects(
      () => sendWebCloudMessage({
        modelId: primaryTextModel.id,
        modelProviderId: 'jiucaihezi',
        modelAttachments: [videoAttachment],
      }, 1, new AbortController(), assistant, () => {}, () => 1, messages),
      /API 500/,
    )
    assert.equal(modelFetches, 1)
    assert.equal(messages.at(-1)?.finishReason, 'web_cloud_http_error')
    assert.doesNotMatch(String(messages.at(-1)?.content), /本地媒体工具|调用现有本地工具/)
  } finally {
    __resetApiKeyMemoryCacheForTests('')
    globalThis.fetch = previousFetch
    restoreStorage()
  }
})

test('Web sends an unknown MIME once to the selected model', async () => {
  const key = 'sk-cloud-test-12345678901234567890'
  const restoreStorage = installStorage({ jcApiKey: key })
  const previousFetch = globalThis.fetch
  let modelFetches = 0
  __resetApiKeyMemoryCacheForTests(key)
  const completionBodies: any[] = []
  globalThis.fetch = async (input, init) => {
    const catalog = skillCatalogResponse(input)
    if (catalog) return catalog
    modelFetches += 1
    completionBodies.push(JSON.parse(String(init?.body || '{}')))
    return new Response(JSON.stringify({ choices: [{ message: { content: '完成' } }] }), {
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    setActivePinia(createPinia())
    setModels([{ ...primaryTextModel, inputModalities: undefined }])
    const { messages, assistant } = createMessages()
    await sendWebCloudMessage({
      modelId: primaryTextModel.id,
      modelProviderId: 'jiucaihezi',
      modelAttachments: [{
        id: 'webm-cloud',
        name: 'clip.webm',
        mime: 'video/webm',
        size: 4,
        kind: 'video',
        value: 'data:video/webm;base64,AAAA',
      }],
    }, 1, new AbortController(), assistant, () => {}, () => 1, messages)
    assert.equal(modelFetches, 1)
    assert.equal(completionBodies[0]?.model, primaryTextModel.id)
    assert.match(JSON.stringify(completionBodies[0]), /data:video\/webm;base64,AAAA/)
  } finally {
    __resetApiKeyMemoryCacheForTests('')
    globalThis.fetch = previousFetch
    restoreStorage()
  }
})
test('Web sends media only to the selected model when its input capability is unknown', async () => {
  const key = 'sk-cloud-test-12345678901234567890'
  const restoreStorage = installStorage({ jcApiKey: key })
  const previousFetch = globalThis.fetch
  __resetApiKeyMemoryCacheForTests(key)
  const completionBodies: any[] = []
  globalThis.fetch = async (input, init) => {
    const catalog = skillCatalogResponse(input)
    if (catalog) return catalog
    const body = JSON.parse(String(init?.body || '{}'))
    completionBodies.push(body)
    return new Response(JSON.stringify({ choices: [{ message: { content: '完成' } }] }), {
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    setActivePinia(createPinia())
    setModels([{ ...primaryTextModel, inputModalities: undefined }, sameProviderGemini])
    const { messages, assistant } = createMessages()
    await sendWebCloudMessage({
      modelId: primaryTextModel.id,
      modelProviderId: 'jiucaihezi',
      modelAttachments: [videoAttachment],
    }, 1, new AbortController(), assistant, () => {}, () => 1, messages)

    assert.equal(completionBodies.length, 1)
    assert.equal(completionBodies[0]?.model, primaryTextModel.id)
    assert.match(JSON.stringify(completionBodies[0]), /data:video\/mp4;base64,AAAA/)
  } finally {
    __resetApiKeyMemoryCacheForTests('')
    globalThis.fetch = previousFetch
    restoreStorage()
  }
})

test('Web keeps a safe JSON upstream error and request ID for attachment failures', async () => {
  const key = 'sk-cloud-secret-12345678901234567890'
  const restoreStorage = installStorage({ jcApiKey: key })
  const previousFetch = globalThis.fetch
  __resetApiKeyMemoryCacheForTests(key)
  globalThis.fetch = async input => {
    const catalog = skillCatalogResponse(input)
    if (catalog) return catalog
    return new Response(JSON.stringify({
      error: { message: `unsupported input ${key} data:video/mp4;base64,AAAA C:\\Users\\alice\\clip.mov` },
    }), {
      status: 500,
      headers: { 'content-type': 'application/json', 'x-request-id': 'web-json-500' },
    })
  }
  try {
    setActivePinia(createPinia())
    setModels([primaryTextModel])
    const { messages, assistant } = createMessages()
    await assert.rejects(() => sendWebCloudMessage({
      modelId: primaryTextModel.id,
      modelProviderId: 'jiucaihezi',
      modelAttachments: [videoAttachment],
    }, 1, new AbortController(), assistant, () => {}, () => 1, messages), error => {
      const message = String((error as Error).message)
      assert.match(message, /API 500/)
      assert.match(message, /unsupported input/)
      assert.match(message, /web-json-500/)
      assert.equal((error as Error).name, 'ChatHttpError')
      assert.doesNotMatch(message, /sk-cloud-secret|base64|AAAA|C:\\Users/i)
      return true
    })
  } finally {
    __resetApiKeyMemoryCacheForTests('')
    globalThis.fetch = previousFetch
    restoreStorage()
  }
})

test('Web appends the attachment timeout action to a safe HTML 524 error', async () => {
  const key = 'sk-cloud-test-12345678901234567890'
  const restoreStorage = installStorage({ jcApiKey: key })
  const previousFetch = globalThis.fetch
  __resetApiKeyMemoryCacheForTests(key)
  globalThis.fetch = async input => {
    const catalog = skillCatalogResponse(input)
    if (catalog) return catalog
    return new Response('<html><body>origin processing timed out /home/alice/clip.mov</body></html>', {
      status: 524,
      headers: { 'content-type': 'text/html', 'cf-ray': 'web-ray-524' },
    })
  }
  try {
    setActivePinia(createPinia())
    setModels([primaryTextModel])
    const { messages, assistant } = createMessages()
    await assert.rejects(() => sendWebCloudMessage({
      modelId: primaryTextModel.id,
      modelProviderId: 'jiucaihezi',
      modelAttachments: [videoAttachment],
    }, 1, new AbortController(), assistant, () => {}, () => 1, messages),
    /API 524.*origin processing timed out.*web-ray-524.*处理附件超时/s)
  } finally {
    __resetApiKeyMemoryCacheForTests('')
    globalThis.fetch = previousFetch
    restoreStorage()
  }
})

test('Web preserves partial content_filter output for an attachment response', async () => {
  const key = 'sk-cloud-test-12345678901234567890'
  const restoreStorage = installStorage({ jcApiKey: key })
  const previousFetch = globalThis.fetch
  __resetApiKeyMemoryCacheForTests(key)
  globalThis.fetch = async input => {
    const catalog = skillCatalogResponse(input)
    if (catalog) return catalog
    return new Response(JSON.stringify({
      choices: [{ message: { content: '部分正文' }, finish_reason: 'content_filter' }],
    }), { headers: { 'content-type': 'application/json' } })
  }
  try {
    setActivePinia(createPinia())
    setModels([primaryTextModel])
    const { messages, assistant } = createMessages()
    await sendWebCloudMessage({
      modelId: primaryTextModel.id,
      modelProviderId: 'jiucaihezi',
      modelAttachments: [videoAttachment],
    }, 1, new AbortController(), assistant, () => {}, () => 1, messages)
    assert.equal(messages.at(-1)?.content, '部分正文\n\n上游以 content_filter 终止。')
    assert.equal(messages.at(-1)?.finishReason, 'content_filter')
  } finally {
    __resetApiKeyMemoryCacheForTests('')
    globalThis.fetch = previousFetch
    restoreStorage()
  }
})

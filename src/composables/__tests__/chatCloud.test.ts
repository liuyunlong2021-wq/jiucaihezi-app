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

test('Web reports missing same-provider Gemini without sending media to another provider', async () => {
  const key = 'sk-cloud-test-12345678901234567890'
  const restoreStorage = installStorage({ jcApiKey: key })
  const previousFetch = globalThis.fetch
  let modelFetches = 0
  __resetApiKeyMemoryCacheForTests(key)
  globalThis.fetch = async input => {
    const catalog = skillCatalogResponse(input)
    if (catalog) return catalog
    modelFetches += 1
    throw new Error('model fetch must not run')
  }
  try {
    setActivePinia(createPinia())
    setModels([
      primaryTextModel,
      { ...sameProviderGemini, providerId: 'another-provider' },
    ])
    const { messages, assistant } = createMessages()
    await assert.rejects(
      () => sendWebCloudMessage({
        modelId: primaryTextModel.id,
        modelProviderId: 'jiucaihezi',
        modelInputModalities: ['text'],
        modelAttachments: [videoAttachment],
        mediaEnhancementEnabled: true,
        confirmMediaSpecialist: async () => 'once',
      }, 1, new AbortController(), assistant, () => {}, () => 1, messages),
      /当前模型和账号不能读取该媒体/,
    )
    assert.equal(modelFetches, 0)
    assert.equal(messages.at(-1)?.finishReason, 'web_cloud_error')
  } finally {
    __resetApiKeyMemoryCacheForTests('')
    globalThis.fetch = previousFetch
    restoreStorage()
  }
})

test('Web keeps specialist rejection and failure visible to the caller', async () => {
  const key = 'sk-cloud-test-12345678901234567890'
  const restoreStorage = installStorage({ jcApiKey: key })
  const previousFetch = globalThis.fetch
  __resetApiKeyMemoryCacheForTests(key)
  try {
    setActivePinia(createPinia())
    setModels([primaryTextModel, sameProviderGemini])
    globalThis.fetch = async input => skillCatalogResponse(input)
      || new Response('', { status: 500 })

    for (const consent of ['reject', 'once'] as const) {
      const { messages, assistant } = createMessages()
      await assert.rejects(
        () => sendWebCloudMessage({
          modelId: primaryTextModel.id,
          modelProviderId: 'jiucaihezi',
          modelInputModalities: ['text'],
          modelAttachments: [videoAttachment],
          mediaEnhancementEnabled: true,
          confirmMediaSpecialist: async () => consent,
        }, 1, new AbortController(), assistant, () => {}, () => 1, messages),
        /当前模型和账号不能读取该媒体/,
      )
      assert.equal(messages.at(-1)?.finishReason, 'web_cloud_error')
    }
  } finally {
    __resetApiKeyMemoryCacheForTests('')
    globalThis.fetch = previousFetch
    restoreStorage()
  }
})

test('cancelling a Web specialist request remains visible and rejects', async () => {
  const key = 'sk-cloud-test-12345678901234567890'
  const restoreStorage = installStorage({ jcApiKey: key })
  const previousFetch = globalThis.fetch
  __resetApiKeyMemoryCacheForTests(key)
  let specialistStarted!: () => void
  const started = new Promise<void>(resolve => { specialistStarted = resolve })
  globalThis.fetch = async (input, init) => {
    const catalog = skillCatalogResponse(input)
    if (catalog) return catalog
    specialistStarted()
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })
  }
  try {
    setActivePinia(createPinia())
    setModels([primaryTextModel, sameProviderGemini])
    const { messages, assistant } = createMessages()
    const controller = new AbortController()
    const sending = sendWebCloudMessage({
      modelId: primaryTextModel.id,
      modelProviderId: 'jiucaihezi',
      modelInputModalities: ['text'],
      modelAttachments: [videoAttachment],
      mediaEnhancementEnabled: true,
      confirmMediaSpecialist: async () => 'once',
    }, 1, controller, assistant, () => {}, () => 1, messages)
    await started
    controller.abort()
    await assert.rejects(sending)
    assert.equal(messages.at(-1)?.finishReason, 'abort')
    assert.match(String(messages.at(-1)?.content), /已停止生成/)
  } finally {
    __resetApiKeyMemoryCacheForTests('')
    globalThis.fetch = previousFetch
    restoreStorage()
  }
})

test('legacy Web images follow authoritative modalities and never reach a text-only primary model', async () => {
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
    if (body.model === 'gemini-3.5-flash') {
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          results: [{
            assetId: 'legacy-image-0',
            summary: '红色图片',
            observations: ['画面为红色'],
            uncertainties: [],
          }],
        }) } }],
      }), { headers: { 'content-type': 'application/json' } })
    }
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
      modelInputModalities: ['text'],
      images: ['data:image/png;base64,RED'],
      mediaEnhancementEnabled: true,
      confirmMediaSpecialist: async () => 'once',
    }, 1, new AbortController(), assistant, () => {}, () => 1, messages)

    assert.equal(completionBodies[0]?.model, 'gemini-3.5-flash')
    assert.match(JSON.stringify(completionBodies[0]), /data:image\/png;base64,RED/)
    assert.equal(completionBodies[1]?.model, primaryTextModel.id)
    assert.equal(JSON.stringify(completionBodies[1]).includes('data:image/png;base64,RED'), false)
  } finally {
    __resetApiKeyMemoryCacheForTests('')
    globalThis.fetch = previousFetch
    restoreStorage()
  }
})

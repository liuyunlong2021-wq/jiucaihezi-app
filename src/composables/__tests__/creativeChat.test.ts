import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { __resetApiKeyMemoryCacheForTests } from '../../services/newApiClient'
import { useCreativeChat } from '../creativeChat'

const source = readFileSync(join(process.cwd(), 'src/composables/creativeChat.ts'), 'utf8')

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

test('creative chat uses the direct runtime and Desktop project tools without OpenCode', () => {
  assert.match(source, /runDirectChatCompletion/)
  assert.match(source, /createDesktopProjectToolExecutor/)
  assert.match(source, /tools:\s*toolsAllowed \? buildCreativeToolDefinitions\(\) : \[\]/)
  assert.match(source, /safeFetch/)
  assert.match(source, /AbortController/)
  assert.doesNotMatch(source, /openCodeSyncStore|ensureOpenCodeServer|createJiucaiOpenCodeClient/)
})

test('creative chat uses the caller-provided effective Skill catalog and forwards text deltas to the UI', () => {
  assert.match(source, /buildWebSkillCatalogPrompt\(input\.skillCatalog \|\| \[\]\)/)
  assert.match(source, /input\.skillCatalog/)
  assert.doesNotMatch(source, /loadWebSkillCatalog/)
  assert.match(source, /input\.mediaPlanPolicy \|\| MEDIA_PLAN_POLICY/)
  assert.match(source, /skillCatalog, terminalInputPolicy\(input\.attachments\)/)
  assert.match(source, /onText:\s*text\s*=>\s*\{\s*roundText = text\s*;?\s*input\.onText\(text\)\s*;?\s*\}/)
  assert.match(source, /\}\)\.then\(result\s*=>\s*\{\s*input\.onText\(resolveDirectCompletionText\(result\.text \|\| roundText, result\.finishReason, '模型没有返回内容。'\)\)/s)
})

test('creative chat asks for approval before each filesystem or terminal tool and returns rejection to the model', () => {
  assert.match(source, /confirmTool\?:\s*\(call:\s*DirectToolCall\)\s*=>\s*boolean\s*\|\s*Promise<boolean>/s)
  assert.match(source, /if\s*\(call\.function\.name\s*!==\s*'skill'\)\s*\{\s*const approved = await input\.confirmTool\?\.\(call\)/s)
  assert.match(source, /用户拒绝了本次工具操作，未执行。请换一种方法继续。/)
  assert.doesNotMatch(source, /confirmTerminal/)
})

test('creative chat passes opaque attachment handles to the Desktop tool executor', () => {
  assert.match(source, /attachments\?:\s*Array<\{\s*name:\s*string;\s*inputPath:\s*string\s*\}>/s)
  assert.match(source, /attachments:\s*input\.attachments/)
})

test('Desktop creative chat routes attachments only to the selected model', () => {
  assert.match(source, /modelAttachments\?:\s*ResolvedDirectAttachment\[\]/)
  assert.match(source, /attachments:\s*input\.modelAttachments/)
  assert.doesNotMatch(source, /modelInputModalities|resolveCurrentModelAttachments/)
  assert.doesNotMatch(source, /mediaSpecialist|specialistModel|availableModels|localMediaPolicy/)
  assert.doesNotMatch(source, /任务需要时请调用现有本地工具/)
})

test('Desktop sends one MP4 file part once with the selected model and current key', async () => {
  const key = 'sk-desktop-test-12345678901234567890'
  const restoreStorage = installStorage({ jcApiKey: key })
  const previousFetch = globalThis.fetch
  const requests: Array<{ url: string; body: any; headers: Record<string, string> }> = []
  __resetApiKeyMemoryCacheForTests(key)
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body || '{}')),
      headers: init?.headers as Record<string, string>,
    })
    return new Response(JSON.stringify({ choices: [{ message: { content: '完成' } }] }), {
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    await useCreativeChat().send({
      projectDir: '/tmp/creative-project',
      modelId: 'gpt-5.6-terra',
      modelProviderId: 'jiucaihezi',
      messages: [{ id: 'user-desktop', role: 'user', content: '分析这个视频', timestamp: Date.now() }],
      modelAttachments: [{
        id: 'video-desktop',
        name: 'clip.mp4',
        mime: 'video/mp4',
        size: 4,
        kind: 'video',
        value: 'data:video/mp4;base64,AAAA',
      }],
      onText: () => {},
    })

    assert.equal(requests.length, 1)
    assert.equal(requests[0]?.url, 'https://api.jiucaihezi.studio/v1/chat/completions')
    assert.equal(requests[0]?.body.model, 'gpt-5.6-terra')
    assert.equal(requests[0]?.headers.Authorization, `Bearer ${key}`)
    const fileParts = requests[0]?.body.messages
      .flatMap((message: any) => Array.isArray(message.content) ? message.content : [])
      .filter((part: any) => part.type === 'file')
    assert.deepEqual(fileParts, [{
      type: 'file',
      file: { filename: 'clip.mp4', file_data: 'data:video/mp4;base64,AAAA' },
    }])
  } finally {
    __resetApiKeyMemoryCacheForTests('')
    globalThis.fetch = previousFetch
    restoreStorage()
  }
})

test('tool capability and explicit user restrictions do not block supported attachments', () => {
  assert.match(source, /const requestConstraints = resolveDirectRequestConstraints/)
  assert.match(source, /const toolsAllowed = input\.modelToolCall !== false && !requestConstraints\.toolsForbidden/)
  assert.match(source, /tools:\s*toolsAllowed \? buildCreativeToolDefinitions\(\) : \[\]/)
  assert.match(source, /attachments:\s*input\.modelAttachments/)
  assert.match(source, /\.\.\.\(request\.tools\?\.length \? \{ tools: request\.tools \} : \{\}\)/)
})

test('creative chat tells the model which attachment tokens are real and keeps text paths literal', () => {
  assert.match(source, /当前没有可用终端附件，禁止使用 \{\{attachment:文件名\}\}。用户消息中的绝对路径直接用于 read 或 terminal。/)
  assert.match(source, /本轮唯一可用的终端附件令牌：/)
  assert.match(source, /用户要求保存到工作区时，必须调用 write 或 edit，并在工具成功后才说明已保存。/)
})

test('creative chat does not impose its own output-token cap', () => {
  assert.doesNotMatch(source, /max_tokens:\s*4096/)
})

test('Desktop serializes and budgets the final request before safeFetch', () => {
  assert.match(source, /sendNewApiRequest\(/)
  assert.match(source, /sendNewApiRequest\([\s\S]*?body => safeFetch\([\s\S]*?body,/)
})

test('Desktop keeps a safe JSON upstream error and request ID for attachment failures', async () => {
  const key = 'sk-desktop-secret-12345678901234567890'
  const restoreStorage = installStorage({ jcApiKey: key })
  const previousFetch = globalThis.fetch
  __resetApiKeyMemoryCacheForTests(key)
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { message: `unsupported input ${key} data:video/mp4;base64,AAAA /Users/alice/clip.mov` },
  }), {
    status: 500,
    headers: { 'content-type': 'application/json', 'request-id': 'desktop-json-500' },
  })
  try {
    await assert.rejects(() => useCreativeChat().send({
      projectDir: '/tmp/creative-project',
      modelId: 'gpt-5.6-terra',
      modelProviderId: 'jiucaihezi',
      messages: [{ id: 'u-error', role: 'user', content: '分析附件', timestamp: Date.now() }],
      modelAttachments: [{
        id: 'video-error', name: 'clip.mp4', mime: 'video/mp4', size: 4, kind: 'video',
        value: 'data:video/mp4;base64,AAAA',
      }],
      onText: () => {},
    }), error => {
      const message = String((error as Error).message)
      assert.match(message, /API 500/)
      assert.match(message, /unsupported input/)
      assert.match(message, /desktop-json-500/)
      assert.equal((error as Error).name, 'ChatHttpError')
      assert.doesNotMatch(message, /sk-desktop-secret|base64|AAAA|\/Users\/alice|更换对话模型/)
      return true
    })
  } finally {
    __resetApiKeyMemoryCacheForTests('')
    globalThis.fetch = previousFetch
    restoreStorage()
  }
})

test('Desktop appends the attachment timeout action to a safe HTML 524 error', async () => {
  const key = 'sk-desktop-test-12345678901234567890'
  const restoreStorage = installStorage({ jcApiKey: key })
  const previousFetch = globalThis.fetch
  __resetApiKeyMemoryCacheForTests(key)
  globalThis.fetch = async () => new Response('<html><body>origin timed out /tmp/clip.mov</body></html>', {
    status: 524,
    headers: { 'content-type': 'text/html', 'cf-ray': 'desktop-ray-524' },
  })
  try {
    await assert.rejects(() => useCreativeChat().send({
      projectDir: '/tmp/creative-project',
      modelId: 'gpt-5.6-terra',
      modelProviderId: 'jiucaihezi',
      messages: [{ id: 'u-timeout', role: 'user', content: '分析附件', timestamp: Date.now() }],
      modelAttachments: [{
        id: 'video-timeout', name: 'clip.mp4', mime: 'video/mp4', size: 4, kind: 'video',
        value: 'data:video/mp4;base64,AAAA',
      }],
      onText: () => {},
    }), /API 524.*origin timed out.*desktop-ray-524.*处理附件超时/s)
  } finally {
    __resetApiKeyMemoryCacheForTests('')
    globalThis.fetch = previousFetch
    restoreStorage()
  }
})

test('Desktop preserves partial content_filter output for an attachment response', async () => {
  const key = 'sk-desktop-test-12345678901234567890'
  const restoreStorage = installStorage({ jcApiKey: key })
  const previousFetch = globalThis.fetch
  const text: string[] = []
  let finishReason = ''
  __resetApiKeyMemoryCacheForTests(key)
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: '部分正文' }, finish_reason: 'content_filter' }],
  }), { headers: { 'content-type': 'application/json' } })
  try {
    await useCreativeChat().send({
      projectDir: '/tmp/creative-project',
      modelId: 'gpt-5.6-terra',
      modelProviderId: 'jiucaihezi',
      messages: [{ id: 'u-filter', role: 'user', content: '分析附件', timestamp: Date.now() }],
      modelAttachments: [{
        id: 'video-filter', name: 'clip.mp4', mime: 'video/mp4', size: 4, kind: 'video',
        value: 'data:video/mp4;base64,AAAA',
      }],
      onText: value => text.push(value),
      onFinishReason: value => { finishReason = value || '' },
    })
    assert.equal(text.at(-1), '部分正文')
    assert.equal(finishReason, 'content_filter')
  } finally {
    __resetApiKeyMemoryCacheForTests('')
    globalThis.fetch = previousFetch
    restoreStorage()
  }
})

test('Desktop pure-text follow-up omits the failed attachment turn from the request body', async () => {
  const key = 'sk-desktop-test-12345678901234567890'
  const restoreStorage = installStorage({ jcApiKey: key })
  const previousFetch = globalThis.fetch
  let requestBody = ''
  __resetApiKeyMemoryCacheForTests(key)
  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body || '')
    return new Response(JSON.stringify({ choices: [{ message: { content: '纯文字成功' }, finish_reason: 'stop' }] }), {
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    await useCreativeChat().send({
      projectDir: '/tmp/creative-project',
      modelId: 'gpt-5.6-terra',
      modelProviderId: 'jiucaihezi',
      messages: [
        { id: 'u-ok', role: 'user', content: '正常历史', timestamp: 1 },
        { id: 'a-ok', role: 'assistant', content: '正常回答', finishReason: 'stop', timestamp: 2 },
        {
          id: 'u-failed', role: 'user', content: '分析旧附件', timestamp: 3,
          files: [{ name: 'old.mov', content: '绝不能进入下一轮的旧附件摘要' }],
        },
        { id: 'a-failed', role: 'assistant', content: '创作模式请求失败：旧错误 UI', finishReason: 'network_error', timestamp: 4 },
        { id: 'u-latest', role: 'user', content: '这次只问纯文字', timestamp: 5 },
      ],
      onText: () => {},
    })
    assert.match(requestBody, /正常历史/)
    assert.match(requestBody, /正常回答/)
    assert.match(requestBody, /这次只问纯文字/)
    assert.doesNotMatch(requestBody, /分析旧附件|旧附件摘要|旧错误 UI/)
  } finally {
    __resetApiKeyMemoryCacheForTests('')
    globalThis.fetch = previousFetch
    restoreStorage()
  }
})

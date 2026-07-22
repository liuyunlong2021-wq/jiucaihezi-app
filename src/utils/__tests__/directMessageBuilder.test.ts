/**
 * directMessageBuilder.test.ts — 直连模式统一消息构建器测试
 */

import assert from 'node:assert/strict'
import { test, describe } from 'node:test'
import { buildDirectMessages } from '../../utils/directMessageBuilder'
import {
  NEW_API_REQUEST_MAX_BYTES,
  NewApiRequestTooLargeError,
  normalizeNewApiAttachment,
  sendNewApiRequest,
  serializeNewApiRequest,
  shouldClearCreativeAttachments,
} from '../../runtime/direct/newApiAttachments'

const user = (id: string, content: string, files?: any[], images?: string[]) =>
  ({ id, role: 'user', content, files, images })
const assistant = (id: string, content: string) =>
  ({ id, role: 'assistant', content })

describe('buildDirectMessages', () => {
  test('vision+openai+有图片 → 最后一条 user 是 multimodal', () => {
    const msgs = [user('u1', '你好'), assistant('a1', '你好！'), user('u2', '看图')]
    const result = buildDirectMessages({
      messages: msgs,
      images: ['data:image/png;base64,xxx'],
      visionModel: true,
      apiFormat: 'openai',
      platform: 'desktop',
    })

    const last = result[result.length - 1]
    assert.equal(last.role, 'user')
    assert.ok(Array.isArray(last.content), '最后一条消息应是 multimodal array')
    const parts = last.content as any[]
    assert.equal(parts[0].type, 'text')
    assert.equal(parts[1].type, 'image_url')
    assert.equal(parts[1].image_url.url, 'data:image/png;base64,xxx')
  })

  test('vision+openai+无图片 → 全部纯文本', () => {
    const msgs = [user('u1', '你好')]
    const result = buildDirectMessages({
      messages: msgs,
      images: [],
      visionModel: true,
      apiFormat: 'openai',
      platform: 'desktop',
    })

    const last = result[result.length - 1]
    assert.equal(typeof last.content, 'string')
  })

  test('vision+ollama+有图片 → 纯文本（图片不进 content）', () => {
    const msgs = [user('u1', '看图')]
    const result = buildDirectMessages({
      messages: msgs,
      images: ['data:image/png;base64,xxx'],
      visionModel: true,
      apiFormat: 'ollama',
      platform: 'desktop',
    })

    const last = result[result.length - 1]
    assert.equal(typeof last.content, 'string', 'Ollama 模式应返回纯文本')
  })

  test('非vision+有图片 → 纯文本 + 不支持提示', () => {
    const msgs = [user('u1', '看图')]
    const result = buildDirectMessages({
      messages: msgs,
      images: ['data:image/png;base64,xxx'],
      visionModel: false,
      apiFormat: 'openai',
      platform: 'desktop',
    })

    const last = result[result.length - 1]
    assert.equal(typeof last.content, 'string')
    assert.ok(
      (last.content as string).includes('不支持视觉'),
      '应提示模型不支持视觉',
    )
  })

  test('文本文件注入到最后一条 user', () => {
    const msgs = [user('u1', '分析这个')]
    const result = buildDirectMessages({
      messages: msgs,
      files: [{ name: 'readme.md', content: '# Hello World' }],
      visionModel: false,
      apiFormat: 'openai',
      platform: 'desktop',
    })

    const last = result[result.length - 1]
    const text = last.content as string
    assert.ok(text.includes('[附件: readme.md]'), '应包含附件标记')
    assert.ok(text.includes('# Hello World'), '应包含文件内容')
  })

  test('原生附件使用生产验证过的 image_url 和 file parts', () => {
    const result = buildDirectMessages({
      messages: [user('u1', '分析附件')],
      attachments: [
        { id: 'image', name: 'red.png', mime: 'image/png', size: 3, kind: 'image', value: 'data:image/png;base64,AAA' },
        { id: 'video', name: 'clip.mp4', mime: 'video/mp4', size: 3, kind: 'video', value: 'data:video/mp4;base64,BBB' },
        { id: 'audio', name: 'voice.wav', mime: 'audio/wav', size: 3, kind: 'audio', value: 'data:audio/wav;base64,CCC' },
        { id: 'file', name: 'brief.pdf', mime: 'application/pdf', size: 3, kind: 'file', value: 'data:application/pdf;base64,DDD' },
      ],
      visionModel: true,
      apiFormat: 'openai',
      platform: 'desktop',
    })

    const parts = result.at(-1)?.content as any[]
    assert.deepEqual(parts, [
      { type: 'text', text: '分析附件' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
      { type: 'file', file: { filename: 'clip.mp4', file_data: 'data:video/mp4;base64,BBB' } },
      { type: 'file', file: { filename: 'voice.wav', file_data: 'data:audio/wav;base64,CCC' } },
      { type: 'file', file: { filename: 'brief.pdf', file_data: 'data:application/pdf;base64,DDD' } },
    ])
    assert.equal(parts.some(part => part.type === 'video_url'), false)
  })

  test('原生附件与旧图片输入合并但不重复发送同一值', () => {
    const result = buildDirectMessages({
      messages: [user('u1', '看附件')],
      images: ['data:image/png;base64,AAA', 'data:image/png;base64,LEGACY'],
      attachments: [
        { id: 'image', name: 'red.png', mime: 'image/png', size: 3, kind: 'image', value: 'data:image/png;base64,AAA' },
      ],
      visionModel: true,
      apiFormat: 'openai',
      platform: 'web',
    })

    const parts = result.at(-1)?.content as any[]
    assert.deepEqual(parts.filter(part => part.type === 'image_url'), [
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,LEGACY' } },
    ])
  })

  test('MOV 浏览器 MIME 在附件元数据和 file_data 头中统一为 video/mov', () => {
    const result = buildDirectMessages({
      messages: [user('u1', '分析 MOV')],
      attachments: [{
        id: 'mov',
        name: 'clip.mov',
        mime: 'video/quicktime',
        size: 3,
        kind: 'video',
        value: 'data:video/quicktime;base64,AAA',
      }],
      visionModel: true,
      apiFormat: 'openai',
      platform: 'desktop',
    })

    const part = (result.at(-1)?.content as any[])[1]
    assert.equal(part.type, 'file')
    assert.equal(part.file.file_data, 'data:video/mov;base64,AAA')
  })

  test('浏览器别名、扩展名和 data URL 头共用 MIME 归一化', () => {
    const cases = [
      { name: 'clip.mov', mime: 'video/quicktime', value: 'data:video/quicktime;base64,AAA', expected: 'video/mov' },
      { name: 'voice.wav', mime: 'audio/x-wav', value: 'data:audio/x-wav;base64,AAA', expected: 'audio/wav' },
      { name: 'photo.jpg', mime: 'image/jpg', value: 'data:image/jpg;base64,AAA', expected: 'image/jpeg' },
      { name: 'clip.mov', mime: 'application/octet-stream', value: 'data:application/octet-stream;base64,AAA', expected: 'video/mov' },
      { name: 'animation.gif', mime: '', value: 'data:;base64,AAA', expected: 'image/gif' },
    ]
    for (const item of cases) {
      const attachment = normalizeNewApiAttachment({
        id: item.name,
        name: item.name,
        mime: item.mime,
        size: 1,
        kind: item.expected.startsWith('image/') ? 'image' : item.expected.startsWith('video/') ? 'video' : 'audio',
        value: item.value,
      })
      assert.equal(attachment.mime, item.expected)
      assert.match(attachment.value, new RegExp(`^data:${item.expected.replace('/', '\\/')};base64,`))
    }
  })

  test('未知 MIME 原样保留并继续构造 file_data', () => {
    const result = buildDirectMessages({
      messages: [user('u1', '分析附件')],
      attachments: [{ id: 'webm', name: 'clip.webm', mime: 'video/webm', size: 1, kind: 'video', value: 'data:video/webm;base64,AAA' }],
      visionModel: true,
      apiFormat: 'openai',
      platform: 'web',
    })
    assert.deepEqual((result.at(-1)?.content as any[])[1], {
      type: 'file',
      file: { filename: 'clip.webm', file_data: 'data:video/webm;base64,AAA' },
    })
  })

  test('generic 声明与冲突 data URL 优先使用已知图片扩展名', () => {
    const result = buildDirectMessages({
      messages: [user('u1', '分析图片')],
      attachments: [{
        id: 'png',
        name: 'photo.png',
        mime: 'application/octet-stream',
        size: 1,
        kind: 'file',
        value: 'data:text/plain;base64,AAA',
      }],
      visionModel: true,
      apiFormat: 'openai',
      platform: 'web',
    })
    assert.deepEqual((result.at(-1)?.content as any[])[1], {
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AAA' },
    })
  })

  test('data URL MIME 归一化保留参数和 payload', () => {
    const attachment = normalizeNewApiAttachment({
      id: 'jpg',
      name: 'photo.jpg',
      mime: 'image/jpg',
      size: 1,
      kind: 'image' as const,
      value: 'data:image/jpg;charset=utf-8;base64,AAA/+=',
    })
    assert.equal(attachment.mime, 'image/jpeg')
    assert.equal(attachment.value, 'data:image/jpeg;charset=utf-8;base64,AAA/+=')
  })

  test('畸形 data URL 在消息构造时明确失败', () => {
    assert.throws(() => buildDirectMessages({
      messages: [user('u1', '分析图片')],
      attachments: [{ id: 'jpg', name: 'photo.jpg', mime: 'image/jpg', size: 1, kind: 'image', value: 'data:image/jpg;base64AAAA' }],
      visionModel: true,
      apiFormat: 'openai',
      platform: 'web',
    }), /附件数据格式无效/)
  })

  test('官方图片 MIME 即使上传分类陈旧也仍使用 image_url', () => {
    const result = buildDirectMessages({
      messages: [user('u1', '分析图片')],
      attachments: [{ id: 'heic', name: 'photo.heic', mime: 'image/heic', size: 1, kind: 'file', value: 'data:image/heic;base64,AAA' }],
      visionModel: true,
      apiFormat: 'openai',
      platform: 'web',
    })
    assert.deepEqual((result.at(-1)?.content as any[])[1], {
      type: 'image_url',
      image_url: { url: 'data:image/heic;base64,AAA' },
    })
  })

  test('最终请求只序列化一次并按完整 JSON 的 UTF-8 字节计数', () => {
    const request = {
      model: 'gemini-3.5-flash',
      messages: [{ role: 'system', content: '中文规则' }, { role: 'user', content: '历史' }],
      tools: [{ type: 'function', function: { name: 'read', description: '工具' } }],
      stream: true,
    }
    const serialized = serializeNewApiRequest(request, 1024)
    assert.equal(serialized, JSON.stringify(request))
    assert.equal(Buffer.byteLength(serialized, 'utf8'), Buffer.byteLength(JSON.stringify(request), 'utf8'))
  })

  test('最终 JSON 字节计数不调用 TextEncoder', () => {
    const original = globalThis.TextEncoder
    ;(globalThis as any).TextEncoder = class {
      encode(): never { throw new Error('TextEncoder must not allocate request-sized bytes') }
    }
    try {
      assert.doesNotThrow(() => serializeNewApiRequest({ text: 'ASCII 中文 😀' }, 1024))
    } finally {
      globalThis.TextEncoder = original
    }
  })

  test('ASCII、中文和 emoji 的 UTF-8 边界与 Buffer.byteLength 一致', () => {
    for (const content of ['ASCII', '中文', '😀', 'A中😀']) {
      const request = { content }
      const expectedBytes = Buffer.byteLength(JSON.stringify(request), 'utf8')
      assert.doesNotThrow(() => serializeNewApiRequest(request, expectedBytes))
      assert.throws(() => serializeNewApiRequest(request, expectedBytes - 1), /最终请求体.*超过.*限制/)
    }
  })

  test('默认最终 JSON 上限等于 NewAPI 的 128 MiB', () => {
    assert.equal(NEW_API_REQUEST_MAX_BYTES, 128 * 1024 * 1024)
  })

  test('预算内最终 JSON 只发送一次', async () => {
    const request = { model: 'current-model', messages: [{ role: 'user', content: '中文' }] }
    const bodies: string[] = []
    await sendNewApiRequest(request, async body => {
      bodies.push(body)
      return new Response()
    }, 1024)
    assert.deepEqual(bodies, [JSON.stringify(request)])
  })

  test('最终 JSON 超限时发送器不调用 fetch', async () => {
    let fetches = 0
    await assert.rejects(
      () => sendNewApiRequest({
        model: 'gemini-3.5-flash',
        messages: [{ role: 'user', content: 'x'.repeat(200) }],
        tools: [{ type: 'function', function: { description: 'y'.repeat(200) } }],
      }, async () => {
        fetches += 1
        return new Response()
      }, 128),
      (error: unknown) => {
        assert.equal(error instanceof NewApiRequestTooLargeError, true)
        assert.match((error as Error).message, /最终请求体.*超过.*限制/)
        return true
      },
    )
    assert.equal(fetches, 0)
  })

  test('创模式仅在正常 stop 或 length 完成后清理附件', () => {
    assert.equal(shouldClearCreativeAttachments('stop'), true)
    assert.equal(shouldClearCreativeAttachments('length'), true)
    assert.equal(shouldClearCreativeAttachments('content_filter'), false)
    assert.equal(shouldClearCreativeAttachments(undefined), true)
  })

  test('system prompt 合并三部分', () => {
    const msgs = [user('u1', 'hi')]
    const result = buildDirectMessages({
      messages: msgs,
      systemPrompt: '你是助手',
      skillSystemPrompt: '<SKILL.md>test</SKILL.md>',
      visionModel: false,
      apiFormat: 'openai',
      platform: 'desktop',
    })

    const sys = result[0]
    assert.equal(sys.role, 'system')
    const text = sys.content as string
    assert.ok(text.includes('你是助手'))
    assert.ok(text.includes('<SKILL.md>'))
    assert.ok(text.includes('直连模式'))
  })

  test('空消息列表返回兜底消息', () => {
    const result = buildDirectMessages({
      messages: [],
      visionModel: false,
      apiFormat: 'openai',
      platform: 'desktop',
    })

    assert.ok(result.length >= 2)
    assert.equal(result[result.length - 1].role, 'user')
    assert.equal(result[result.length - 1].content, '请继续。')
  })

  test('explicit unlimited history keeps the capacity-selected creative history intact', () => {
    const msgs = Array.from({ length: 30 }, (_, index) => user(`u${index}`, `消息 ${index}`))
    const result = buildDirectMessages({
      messages: msgs,
      historyLimit: null,
      visionModel: false,
      apiFormat: 'openai',
      platform: 'desktop',
    })

    assert.equal(result.filter(message => message.role === 'user').length, 30)
  })
})

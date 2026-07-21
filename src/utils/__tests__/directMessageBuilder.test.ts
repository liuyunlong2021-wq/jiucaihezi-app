/**
 * directMessageBuilder.test.ts — 直连模式统一消息构建器测试
 */

import assert from 'node:assert/strict'
import { test, describe } from 'node:test'
import { buildDirectMessages } from '../../utils/directMessageBuilder'

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

/**
 * 示例插件 2: AI 回复格式化（对齐 OpenCode define() 模式）
 *
 * 安装方式: 用户在 PluginPanel 中安装 "回复格式化" 推荐项
 */

import { definePlugin } from '@/plugin'

export default definePlugin({
  id: 'example-reply-formatter',
  name: '回复格式化',
  description: '自动格式化 AI 回复，添加时间戳和模型标记',

  async setup(ctx) {
    let messageCount = 0

    // 钩子: AI 回复后 → 添加元数据
    ctx.chat.onReceiveAfter.hook((payload) => {
      messageCount++
      const model = payload.modelId || 'unknown'
      // 不修改 content，仅打印日志
      console.log(`[回复格式化] #${messageCount} 模型: ${model}, 长度: ${payload.content.length} 字符`)
    })

    // 订阅系统事件
    ctx.event.subscribe('session:created', (_sessionId: unknown) => {
      messageCount = 0
      console.log('[回复格式化] 新会话，计数器已重置')
    })

    console.log('[示例插件] 回复格式化已激活')
  },
})

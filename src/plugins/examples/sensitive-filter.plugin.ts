/**
 * 示例插件 1: 敏感词过滤（对齐 OpenCode define() 模式）
 *
 * 安装方式: 用户在 PluginPanel 中安装 "敏感词过滤" 推荐项
 */

import { definePlugin } from '@/plugin'

export default definePlugin({
  id: 'example-sensitive-filter',
  name: '敏感词过滤',
  description: '自动过滤用户输入中的敏感词，保护对话安全',

  async setup(ctx) {
    const sensitiveWords = ['password', 'secret', 'token', 'api_key', 'key=',
      '密码', '令牌', '密钥',
    ]

    // 钩子: 用户发送消息前 → 过滤敏感词
    ctx.chat.onSendBefore.hook((payload) => {
      let text = payload.text
      let modified = false

      for (const word of sensitiveWords) {
        if (text.toLowerCase().includes(word.toLowerCase())) {
          text = text.replace(new RegExp(word, 'gi'), '***[已过滤]***')
          modified = true
        }
      }

      if (modified) {
        payload.modifyText(text)
        console.log('[敏感词过滤] 已过滤敏感内容')
      }
    })

    console.log('[示例插件] 敏感词过滤已激活')
  },
})

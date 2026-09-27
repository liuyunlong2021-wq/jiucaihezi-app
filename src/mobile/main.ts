import { createApp } from 'vue'
import JcIcon from '@/components/icons/JcIcon.vue'
import MobileController from './MobileController.vue'

// 控制器的样式面比工作台小：只带设计令牌、基础排版、Markdown 与代码高亮
// （对话正文要渲染），不带工作台布局样式。
import '@/styles/design-tokens.css'
import '@/styles/highlight-theme.css'
import '@/styles/markdown.css'
import 'katex/dist/katex.min.css'
import '@/styles/base.css'

// ponytail: 只重复 main.ts 里防闪屏的那几行；控制器不初始化会话、模型、MCP 或 Provider。
try {
  const theme = String(localStorage.getItem('jcTheme') || '').toLowerCase()
  if (theme && theme !== 'light') document.documentElement.setAttribute('data-theme', theme)
} catch {}

const app = createApp(MobileController)
app.component('JcIcon', JcIcon)
app.mount('#app')

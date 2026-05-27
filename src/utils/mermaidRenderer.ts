/**
 * mermaidRenderer.ts — Mermaid 图表渲染（动态加载，避免阻塞启动）
 * 将 ```mermaid 代码块渲染为 SVG 图表
 */

// 懒加载 mermaid（1.5MB），仅在需要时引入
let mermaidModule: typeof import('mermaid').default | null = null

async function getMermaid() {
  if (!mermaidModule) {
    const mod = await import('mermaid')
    mermaidModule = mod.default
  }
  return mermaidModule
}

// 初始化 mermaid（跟随主题）
let mermaidInitialized = false

async function initMermaid() {
  if (mermaidInitialized) return
  const mermaid = await getMermaid()
  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    securityLevel: 'sandbox',
    themeVariables: {
      primaryColor: '#6b8e23',
      primaryTextColor: '#333',
      lineColor: '#999',
      fontSize: '14px',
    },
  })
  mermaidInitialized = true
}

/**
 * 渲染 HTML 中的 mermaid 代码块为 SVG
 * 扫描 <code class="language-mermaid"> 并替换为 SVG 图表
 * @param html 已渲染的 HTML（包含 marked 输出的 mermaid 代码块）
 * @param messageId 消息 ID（用于生成唯一图表 ID）
 * @returns 异步返回替换后的 HTML
 */
export async function renderMermaidBlocks(html: string, messageId: string): Promise<string> {
  if (!html.includes('language-mermaid')) return html

  const mermaid = await getMermaid()
  await initMermaid()

  const container = document.createElement('div')
  container.innerHTML = html

  const mermaidBlocks = container.querySelectorAll('.md-code code.language-mermaid')
  if (mermaidBlocks.length === 0) return html

  let index = 0
  for (const block of mermaidBlocks) {
    const code = block.textContent || ''
    const wrapper = block.closest('.md-code')
    if (!wrapper || !code.trim()) continue

    const id = `mermaid-${messageId}-${index++}`
    try {
      const { svg } = await mermaid.render(id, code.trim())
      const svgDiv = document.createElement('div')
      svgDiv.className = 'mermaid-diagram'
      svgDiv.innerHTML = svg
      wrapper.replaceWith(svgDiv)
    } catch {
      // 渲染失败保留原始代码块
      wrapper.classList.add('mermaid-error')
    }
  }

  return container.innerHTML
}

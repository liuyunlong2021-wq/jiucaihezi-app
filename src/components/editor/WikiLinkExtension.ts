/**
 * WikiLinkExtension.ts
 *
 * 基于 @tiptap/extension-mention 实现 [[双向链接]]
 * 触发方式: 输入 [[ 弹出文件选择浮窗
 * 渲染结果: <span class="wiki-link" data-id="..." data-label="...">[[文件名]]</span>
 */
import { mergeAttributes } from '@tiptap/core'
import Mention from '@tiptap/extension-mention'
import type { SuggestionOptions } from '@tiptap/suggestion'

export interface WikiLinkItem {
  id: string
  label: string
}

// 自定义 WikiLink 节点（继承 Mention 并覆盖渲染）
export const WikiLinkExtension = Mention.extend({
  name: 'wikiLink',

  addAttributes() {
    return {
      id: { default: null },
      label: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-wiki-link]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(
        { 'data-wiki-link': '', class: 'wiki-link' },
        HTMLAttributes,
        { 'data-id': node.attrs.id, 'data-label': node.attrs.label }
      ),
      `[[${node.attrs.label}]]`,
    ]
  },
})

// ──────────────────────────────────────────
// 浮窗 DOM 渲染器（纯 JS，不依赖 Vue 组件）
// ──────────────────────────────────────────
export function createWikiLinkSuggestion(
  getFiles: () => WikiLinkItem[],
  onNavigate?: (id: string, label: string) => void
): Partial<SuggestionOptions> {
  return {
    char: '[[',
    allowSpaces: true,

    // 搜索过滤
    items: ({ query }) => {
      const all = getFiles()
      if (!query) return all.slice(0, 12)
      const q = query.toLowerCase()
      return all.filter(f => f.label.toLowerCase().includes(q)).slice(0, 12)
    },

    // 浮窗渲染
    render: () => {
      let popup: HTMLDivElement | null = null
      let selectedIndex = 0
      let currentItems: WikiLinkItem[] = []
      let currentCommand: ((item: WikiLinkItem) => void) | null = null

      function renderList() {
        if (!popup) return
        popup.innerHTML = ''
        if (currentItems.length === 0) {
          popup.innerHTML = '<div class="wl-empty">无匹配文件</div>'
          return
        }
        currentItems.forEach((item, i) => {
          const el = document.createElement('button')
          el.className = 'wl-item' + (i === selectedIndex ? ' wl-selected' : '')
          el.innerHTML = `<span class="wl-icon">📄</span><span class="wl-label">${item.label}</span>`
          el.addEventListener('mousedown', (e) => {
            e.preventDefault()
            currentCommand?.(item)
          })
          popup!.appendChild(el)
        })
      }

      return {
        onStart(props: any) {
          selectedIndex = 0
          currentItems = props.items
          currentCommand = props.command

          popup = document.createElement('div')
          popup.className = 'wiki-link-popup'
          document.body.appendChild(popup)

          // 定位
          const rect = props.clientRect?.()
          if (rect) {
            popup.style.top = `${rect.bottom + window.scrollY + 4}px`
            popup.style.left = `${rect.left + window.scrollX}px`
          }
          renderList()
        },

        onUpdate(props: any) {
          currentItems = props.items
          currentCommand = props.command
          selectedIndex = 0

          const rect = props.clientRect?.()
          if (rect && popup) {
            popup.style.top = `${rect.bottom + window.scrollY + 4}px`
            popup.style.left = `${rect.left + window.scrollX}px`
          }
          renderList()
        },

        onKeyDown(props: any) {
          const { event } = props
          if (event.key === 'ArrowDown') {
            selectedIndex = (selectedIndex + 1) % Math.max(currentItems.length, 1)
            renderList()
            return true
          }
          if (event.key === 'ArrowUp') {
            selectedIndex = (selectedIndex - 1 + Math.max(currentItems.length, 1)) % Math.max(currentItems.length, 1)
            renderList()
            return true
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            const item = currentItems[selectedIndex]
            if (item) currentCommand?.(item)
            return true
          }
          if (event.key === 'Escape') {
            popup?.remove()
            popup = null
            return true
          }
          return false
        },

        onExit() {
          popup?.remove()
          popup = null
        },
      }
    },
  }
}

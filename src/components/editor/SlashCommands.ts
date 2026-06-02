/**
 * SlashCommands.ts
 *
 * 斜杠命令菜单 ( / 触发 )
 * 基于 @tiptap/suggestion 实现，参考 WikiLinkExtension 的纯 DOM 渲染方式
 * 支持常见块级命令：标题、列表、表格、引用、代码等
 */

import { Extension } from '@tiptap/core'
import { Suggestion, type SuggestionOptions } from '@tiptap/suggestion'

export interface CommandItem {
  title: string
  description?: string
  icon?: string
  command: (props: { editor: any; range: any }) => void
}

const COMMANDS: CommandItem[] = [
  {
    title: 'Heading 1',
    description: '大标题',
    icon: 'H1',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run()
    },
  },
  {
    title: 'Heading 2',
    description: '中标题',
    icon: 'H2',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run()
    },
  },
  {
    title: 'Heading 3',
    description: '小标题',
    icon: 'H3',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run()
    },
  },
  {
    title: 'Bullet List',
    description: '无序列表',
    icon: '•',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run()
    },
  },
  {
    title: 'Ordered List',
    description: '有序列表',
    icon: '1.',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run()
    },
  },
  {
    title: 'Task List',
    description: '任务列表',
    icon: '☑',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run()
    },
  },
  {
    title: 'Table',
    description: '插入 3x3 表格',
    icon: '⊞',
    command: ({ editor, range }) => {
      // 兼容自定义 EditorTable：用 insertContent 插入结构（非官方 insertTable）
      editor.chain().focus().deleteRange(range).insertContent({
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '列1' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '列2' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '列3' }] }] },
            ],
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }] },
            ],
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }] },
            ],
          },
        ],
      }).run()
    },
  },
  {
    title: 'Details',
    description: '可折叠块',
    icon: '▽',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleDetails().run()
    },
  },
  {
    title: 'Table of Contents',
    description: '插入目录',
    icon: 'TOC',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertTableOfContents().run()
    },
  },
  {
    title: 'Blockquote',
    description: '引用块',
    icon: '❝',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run()
    },
  },
  {
    title: 'Code Block',
    description: '代码块',
    icon: '</>',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
    },
  },
  {
    title: 'Horizontal Rule',
    description: '分隔线',
    icon: '—',
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run()
    },
  },
  {
    title: 'Image',
    description: '插入图片',
    icon: '🖼',
    command: ({ editor, range }) => {
      // 触发图片选择（复用现有逻辑）
      editor.chain().focus().deleteRange(range).run()
      // 由于无法直接在这里触发文件选择，提示用户使用工具栏
      // 实际项目可通过 emit 事件让父组件处理
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.onchange = (e: any) => {
        const file = e.target.files?.[0]
        if (file) {
          // 这里简化，实际应复用 insertImageFiles，但 editor 范围外
          const reader = new FileReader()
          reader.onload = (ev) => {
            editor.chain().focus().setImage({ src: ev.target?.result as string }).run()
          }
          reader.readAsDataURL(file)
        }
      }
      input.click()
    },
  },
]

export function createSlashCommandSuggestion(): Partial<SuggestionOptions> {
  return {
    char: '/',
    allowSpaces: true,
    startOfLine: true, // 推荐只在行首触发

    items: ({ query }) => {
      if (!query) return COMMANDS.slice(0, 10)
      const q = query.toLowerCase()
      return COMMANDS.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          (item.description && item.description.toLowerCase().includes(q))
      ).slice(0, 10)
    },

    render: () => {
      let popup: HTMLDivElement | null = null
      let selectedIndex = 0
      let currentItems: CommandItem[] = []
      let currentCommand: ((item: CommandItem) => void) | null = null

      function renderList() {
        if (!popup) return
        popup.innerHTML = ''
        if (currentItems.length === 0) {
          popup.innerHTML = '<div class="sc-empty">无匹配命令</div>'
          return
        }
        currentItems.forEach((item, i) => {
          const el = document.createElement('button')
          el.className = 'sc-item' + (i === selectedIndex ? ' sc-selected' : '')
          el.innerHTML = `
            <span class="sc-icon">${item.icon || '•'}</span>
            <div class="sc-text">
              <span class="sc-title">${item.title}</span>
              ${item.description ? `<span class="sc-desc">${item.description}</span>` : ''}
            </div>
          `
          el.addEventListener('mousedown', (e) => {
            e.preventDefault()
            currentCommand?.(item)
          })
          popup!.appendChild(el)
        })
      }

      function updateSelection() {
        if (!popup) return
        Array.from(popup.children).forEach((child, i) => {
          if (i === selectedIndex) {
            child.classList.add('sc-selected')
          } else {
            child.classList.remove('sc-selected')
          }
        })
      }

      return {
        onStart: (props: any) => {
          selectedIndex = 0
          currentItems = props.items
          currentCommand = props.command

          popup = document.createElement('div')
          popup.className = 'slash-command-menu'
          document.body.appendChild(popup)

          const { view } = props.editor
          const { left, bottom } = view.coordsAtPos(props.range.from)
          popup.style.position = 'absolute'
          popup.style.left = `${left}px`
          popup.style.top = `${bottom + 4}px`
          popup.style.zIndex = '1000'

          renderList()

          // click-outside to close (补充无 click-outside 菜单)
          const onOutsideClick = (ev: MouseEvent) => {
            if (popup && !popup.contains(ev.target as Node)) {
              popup.remove()
              popup = null
              document.removeEventListener('mousedown', onOutsideClick)
            }
          }
          // delay to avoid immediate close on the / trigger click itself
          setTimeout(() => document.addEventListener('mousedown', onOutsideClick), 0)

          // keyboard nav
          const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              selectedIndex = (selectedIndex + 1) % currentItems.length
              updateSelection()
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              selectedIndex = (selectedIndex - 1 + currentItems.length) % currentItems.length
              updateSelection()
            } else if (e.key === 'Enter') {
              e.preventDefault()
              currentCommand?.(currentItems[selectedIndex])
              props.editor.commands.focus()
            } else if (e.key === 'Escape') {
              popup?.remove()
              popup = null
              document.removeEventListener('mousedown', onOutsideClick)
            }
          }
          document.addEventListener('keydown', onKeyDown, { once: true })
          ;(popup as any)._cleanup = () => {
            document.removeEventListener('keydown', onKeyDown)
            document.removeEventListener('mousedown', onOutsideClick)
          }
        },

        onUpdate: (props: any) => {
          currentItems = props.items
          currentCommand = props.command
          selectedIndex = 0
          renderList()

          if (popup) {
            const { view } = props.editor
            const { left, bottom } = view.coordsAtPos(props.range.from)
            popup.style.left = `${left}px`
            popup.style.top = `${bottom + 4}px`
          }
        },

        onExit: () => {
          if (popup) {
            ;(popup as any)._cleanup?.()
            // also remove any lingering outside click (in case)
            // (the onOutsideClick removes itself on trigger, but safe)
            popup.remove()
            popup = null
          }
        },

        command: ({ editor, range, props }: any) => {
          props.command({ editor, range })
        },
      }
    },
  }
}

// Slash 命令扩展（使用 Suggestion 插件）
export const SlashCommandsExtension = Extension.create({
  name: 'slashCommands',

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...createSlashCommandSuggestion(),
      }),
    ]
  },
})

export default SlashCommandsExtension
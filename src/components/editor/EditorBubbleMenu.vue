<script setup lang="ts">
/**
 * EditorBubbleMenu — 对标 Tiptap 官方 BubbleMenu
 * 选中文字时显示悬浮格式工具条
 * 参考: https://tiptap.dev/docs/editor/extensions/functionality/bubble-menu
 */
import { BubbleMenu, FloatingMenu } from '@tiptap/vue-3/menus'
import type { Editor } from '@tiptap/vue-3'

defineProps<{
  editor: Editor
}>()

function setLink(editor: Editor) {
  const url = window.prompt('输入链接 URL:')
  if (url) {
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }
}
</script>

<template>
  <!-- BubbleMenu: 选中文字时显示 -->
  <BubbleMenu
    v-if="editor"
    :editor="editor"
    :tippy-options="{ duration: 150, placement: 'top' }"
    class="ebm-bubble"
  >
    <button
      class="ebm-btn"
      :class="{ active: editor.isActive('bold') }"
      @click="editor.chain().focus().toggleBold().run()"
      title="粗体"
    >
      <JcIcon name="format_bold" />
    </button>
    <button
      class="ebm-btn"
      :class="{ active: editor.isActive('italic') }"
      @click="editor.chain().focus().toggleItalic().run()"
      title="斜体"
    >
      <JcIcon name="format_italic" />
    </button>
    <button
      class="ebm-btn"
      :class="{ active: editor.isActive('underline') }"
      @click="editor.chain().focus().toggleUnderline().run()"
      title="下划线"
    >
      <JcIcon name="format_underlined" />
    </button>
    <button
      class="ebm-btn"
      :class="{ active: editor.isActive('strike') }"
      @click="editor.chain().focus().toggleStrike().run()"
      title="删除线"
    >
      <JcIcon name="strikethrough_s" />
    </button>
    <button
      class="ebm-btn"
      :class="{ active: editor.isActive('code') }"
      @click="editor.chain().focus().toggleCode().run()"
      title="行内代码"
    >
      <JcIcon name="code" />
    </button>
    <button
      class="ebm-btn"
      :class="{ active: editor.isActive('superscript') }"
      @click="editor.chain().focus().toggleSuperscript().run()"
      title="上标"
    >x²</button>
    <button
      class="ebm-btn"
      :class="{ active: editor.isActive('subscript') }"
      @click="editor.chain().focus().toggleSubscript().run()"
      title="下标"
    >x₂</button>
    <span class="ebm-divider" />
    <button
      class="ebm-btn"
      :class="{ active: editor.isActive('highlight') }"
      @click="editor.chain().focus().toggleHighlight().run()"
      title="高亮"
    >
      <JcIcon name="draw" />
    </button>
    <button
      class="ebm-btn"
      :class="{ active: editor.isActive('link') }"
      @click="setLink(editor)"
      title="链接"
    >
      <JcIcon name="link" />
    </button>
    <span class="ebm-divider" />
    <button
      class="ebm-btn"
      @click="editor.chain().focus().clearNodes().unsetAllMarks().run()"
      title="清除格式"
    >
      <JcIcon name="format_clear" />
    </button>
  </BubbleMenu>

  <!-- FloatingMenu: 空白段落显示 / 提示 -->
  <FloatingMenu
    v-if="editor"
    :editor="editor"
    :tippy-options="{ duration: 100, placement: 'left' }"
    class="ebm-floating"
  >
    <button
      class="ebm-float-btn"
      @click="editor.chain().focus().toggleHeading({ level: 1 }).run()"
      title="标题1"
    >H1</button>
    <button
      class="ebm-float-btn"
      @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"
      title="标题2"
    >H2</button>
    <button
      class="ebm-float-btn"
      @click="editor.chain().focus().toggleBulletList().run()"
      title="无序列表"
    >
      <JcIcon name="format_list_bulleted" />
    </button>
    <button
      class="ebm-float-btn"
      @click="editor.chain().focus().toggleBlockquote().run()"
      title="引用"
    >
      <JcIcon name="format_quote" />
    </button>
    <button
      class="ebm-float-btn"
      @click="editor.chain().focus().setHorizontalRule().run()"
      title="分割线"
    >
      <JcIcon name="horizontal_rule" />
    </button>
  </FloatingMenu>
</template>

<style scoped>
/* ─── BubbleMenu ─── */
.ebm-bubble {
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 4px 6px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0,0,0,.10), 0 1px 4px rgba(0,0,0,.06);
}

.ebm-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink3);
  font-family: inherit;
  font-size: 11px;
  font-weight: 700;
  transition: all .12s;
}
.ebm-btn:hover {
  background: var(--olive-pale);
  color: var(--olive-dark);
}
.ebm-btn.active {
  background: rgba(107,142,35,.15);
  color: var(--olive-dark);
}
.ebm-btn .mso {
  font-size: 15px;
}

.ebm-divider {
  width: 1px;
  height: 16px;
  background: var(--line);
  margin: 0 2px;
}

/* ─── FloatingMenu ─── */
.ebm-floating {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px 5px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0,0,0,.08);
}

.ebm-float-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  border-radius: 5px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink3);
  font-family: inherit;
  font-size: 10px;
  font-weight: 700;
  transition: all .12s;
}
.ebm-float-btn:hover {
  background: var(--olive-pale);
  color: var(--olive-dark);
}
.ebm-float-btn .mso {
  font-size: 13px;
}
</style>

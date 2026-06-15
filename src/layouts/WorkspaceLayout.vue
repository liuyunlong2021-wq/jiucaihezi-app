<script setup lang="ts">
/**
 * WorkspaceLayout — 主布局壳
 *
 * 正确的 5 列布局:
 * ┌────┬──────────┬──────────┬──────────────┬──────────────────┐
 * │Rail│ FileTree  │ History  │  ChatPanel   │   右侧面板       │
 * │    │(我的Skill) │(对话记录)│ ★始终显示★  │ (Rail 切换内容)   │
 * │    │ 可隐藏    │ 可隐藏   │  不可隐藏    │   可隐藏          │
 * └────┴──────────┴──────────┴──────────────┴──────────────────┘
 */
import { defineAsyncComponent, ref, computed, onBeforeUnmount, onMounted, watch } from 'vue'
import ActivityRail from '@/components/rail/ActivityRail.vue'
import FileTreePanel from '@/components/filetree/FileTreePanel.vue'
import ChatPanel from '@/components/chat/ChatPanel.vue'
import ReviewPanel from '@/components/chat/ReviewPanel.vue'
import SettingsPanel from '@/components/settings/SettingsPanel.vue'
import EditorPanel from '@/components/editor/EditorPanel.vue'
import CreationPanel from '@/components/creation/CreationPanel.vue'
import ToolWarehousePanel from '@/components/tools/ToolWarehousePanel.vue'
import CentralSkillsPanel from '@/components/skills/CentralSkillsPanel.vue'
import { useAgentStore } from '@/stores/agentStore'
import { emitEvent, onEvent } from '@/utils/eventBus'
import { useLocale } from '@/i18n'
import { isTauriRuntime } from '@/utils/tauriEnv'

const agentStore = useAgentStore()
//  removed - use isCloudLoggedIn() or isCloudReady instead
const isMember = computed(() => true)  // All features now available once logged in
const canvasEnabled = ref(true)
const creationEnabled = ref(true)
const lockedPanels = new Set(['tools', 'editor', 'files'])
const TOGGLEABLE_RIGHT_PANELS = new Set(['skills', 'tools', 'editor', 'creation', 'review', 'settings'])
const WEB_UNSUPPORTED_PANELS = new Set(['skills', 'tools', 'files'])
const CanvasWorkspace = defineAsyncComponent(() => import('@/components/canvas/CanvasWorkspace.vue'))
const { t } = useLocale()
const isWebRuntime = computed(() => !isTauriRuntime())

function isPanelAvailable(mode: string) {
  return !isWebRuntime.value || !WEB_UNSUPPORTED_PANELS.has(mode)
}

// ─── 移动端适配 ───
const isMobile = ref(false)
const mobilePanel = ref<'chat' | 'creation' | 'skills' | 'tools' | 'editor' | 'canvas' | 'settings'>('chat')

function checkMobile() {
  isMobile.value = window.innerWidth <= 768
}

// ─── Col 5 当前面板 ───
const workspaceMode = ref<'chat' | 'canvas'>('chat')
const rightPanel = ref<string>('settings')
const showHelpGuide = ref(false)
const helpGuideCards = [
  {
    icon: 'login',
    title: '① 开始使用',
    text: `点击左下角设置 → 一键登录（无需注册，自动创建账号）。
如果没有账号，先在登录页注册，再回到设置绑定。
登录后即可使用全部功能：对话、Skill、创作面板。`,
  },
  {
    icon: 'smart_toy',
    title: '② 选择模型',
    text: `右上角模型菜单选择本轮使用的 AI 模型。
云端推荐：claude-sonnet-4-6（综合能力强）、deepseek-v4（性价比高）。
桌面端支持本地模型（Ollama / MLX），需先在设置中配置。`,
  },
  {
    icon: 'auto_awesome',
    title: '③ Skill 功能清单',
    text: `输入框上方可固定一个 Skill，让 AI 按专业流程工作：

【内容创作】
漫剧剧本生成器 — 漫剧/短剧/网文剧本智能生成
影视解说工坊 — 通用影视解说文案，输出结构化 JSON
短剧解说工坊 — 短剧/爽剧专用解说脚本

【AI 生图】
GPT Image 2 提示词大师 — 162+ 精选模板，覆盖人像/海报/电商/角色/UI/插画等 30+ 类别

【AI 视频】
Grok 视频提示词 — 镜头设计转 Grok 视频生成提示词
Veo 视频提示词 — 镜头设计转 Veo 图生视频提示词
LTX 视频动作 — 镜头设计转 LTX 2.3 动作视频提示词

【Office 办公】
Word 文档 / PDF 文档 / PPT 演示 / Excel 表格 — 一句话生成专业文档`,
  },
  {
    icon: 'image',
    title: '④ 创作面板 — 模型说明',
    text: `点击左侧「创作」进入。右上角提示词按钮可查看参考案例网站。

【图片生成】
GPT Image 2 — 高精度文生图，支持参考图，自动尺寸 ⭐推荐
Nano Banana 4K — 4K 超清生图，支持多种比例 ⭐推荐

【视频生成】
Grok Video 3 — 文生/图生视频，最长 30 秒 ⭐推荐
Seedance 2.0 — 火山引擎视频，支持文生/图生/全能参考
Veo Fast — Google 视频模型，1080P 高清

【音频生成】
Suno v5.5 一句话成歌 — 输入描述，自动作词谱曲
Suno v5.5 自定义成歌 — 自定义歌词 + 风格标签`,
  },
  {
    icon: 'tips_and_updates',
    title: '⑤ 推荐工作流',
    text: `想生成图片/视频？按这个流程最顺畅：

1. 在输入框上方选择「GPT Image 2 提示词大师」或对应视频 Skill
2. 告诉 AI 你想生成什么，让 Skill 输出专业提示词
3. 复制生成的提示词
4. 打开左侧「创作」面板，选择目标模型（如 GPT Image 2）
5. 粘贴提示词，调整参数，点击发送

提示：创作面板右上角的提示词按钮可查看参考案例和提示词模板。`,
  },
  {
    icon: 'edit_note',
    title: '⑥ 文本编辑器',
    text: `左侧第二列的「文本与文件」→ 点击新建或已有文件 →
在右侧编辑区打开，类似 Word 的富文本编辑器。

支持：标题/加粗/斜体/列表/引用/代码块/图片/表格/链接。
文档自动保存到本地，可导出 Markdown 或 HTML。`,
  },
]

// 监听全局面板切换事件（如 MessageBubble 导入编辑区）

// 监听全局面板切换事件（如 MessageBubble 导入编辑区）
const offSwitchPanel = onEvent('switch-panel', (panel: unknown) => {
  if (typeof panel === 'string') {
    if (panel === 'chat') {
      if (isMobile.value) mobilePanel.value = 'chat'
      else rightPanel.value = ''
      workspaceMode.value = 'chat'
      return
    }
    openMemberPanel(panel)
  }
})

const offShowHistoryList = onEvent('show-history-list', () => {
  isFileTreeCollapsed.value = false
})

const offToggleFileTree = onEvent('toggle-file-tree', () => {
  isFileTreeCollapsed.value = !isFileTreeCollapsed.value
})

function showCanvasWorkspace() {
  workspaceMode.value = 'canvas'
  rightPanel.value = ''
}

const offSwitchWorkspaceMode = onEvent('switch-workspace-mode', (mode: unknown) => {
  if (mode === 'canvas') showCanvasWorkspace()
  if (mode === 'chat') workspaceMode.value = 'chat'
})

watch(isMember, (member) => {
  if (member) return
  if (workspaceMode.value === 'canvas') {
    workspaceMode.value = 'chat'
    rightPanel.value = 'settings'
  } else if (lockedPanels.has(rightPanel.value)) {
    rightPanel.value = 'settings'
  } else if (!member && rightPanel.value !== 'settings') {
    rightPanel.value = 'settings'
  }
  if (lockedPanels.has(mobilePanel.value)) mobilePanel.value = 'chat'
}, { immediate: true })

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  offSwitchPanel()
  offShowHistoryList()
  offToggleFileTree()
  offSwitchWorkspaceMode()
  onResizeEnd()
})

// Col 2 / Col 5 隐藏
const isFileTreeCollapsed = ref(false)  // 默认显示
const isFileTreeVisible = computed(() => !isFileTreeCollapsed.value)
const isRightPanelCollapsed = computed(() => !rightPanel.value)

// 宽度
const ACTIVITY_RAIL_WIDTH = 52
const FILETREE_MIN = 220
const FILETREE_MAX = 380
const CHAT_MIN = 420
const RIGHT_MIN = 260
const RIGHT_MAX = 720
const fileTreeWidth = ref(280)  // 足够显示5个tab
const chatWidth = ref(640)
const rightPanelWidth = ref(420)
const hasUserResized = ref(false)
const isResizing = ref(false)
const fileTreeEl = ref<HTMLElement | null>(null)
const chatEl = ref<HTMLElement | null>(null)
const rightPanelEl = ref<HTMLElement | null>(null)

function clamp(value: number, min: number, max: number) {
  const safeMax = Math.max(min, max)
  return Math.max(min, Math.min(safeMax, value))
}

function getAvailableDesktopWidth() {
  return Math.max(0, window.innerWidth - ACTIVITY_RAIL_WIDTH)
}

function applyDefaultDesktopWidths(force = false) {
  if (isMobile.value || (!force && hasUserResized.value)) return

  const available = getAvailableDesktopWidth()
  if (available <= 0) return

  const hasFileTree = isFileTreeVisible.value
  const hasRightPanel = !isRightPanelCollapsed.value
  const fileMin = hasFileTree ? FILETREE_MIN : 0
  const rightMin = hasRightPanel ? RIGHT_MIN : 0
  const fileMax = hasFileTree ? Math.min(FILETREE_MAX, Math.max(fileMin, available - CHAT_MIN - rightMin)) : 0
  const desiredChat = Math.round(available * (hasRightPanel ? 0.48 : 0.72))
  const desiredFile = hasFileTree ? Math.round(available * 0.2) : 0

  const nextFile = hasFileTree ? clamp(desiredFile, fileMin, fileMax) : 0
  let nextChat = clamp(desiredChat, CHAT_MIN, Math.max(CHAT_MIN, available - nextFile - rightMin))
  let nextRight = hasRightPanel ? available - nextFile - nextChat : 0

  if (hasRightPanel) {
    nextRight = clamp(nextRight, RIGHT_MIN, Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, available - nextFile - CHAT_MIN)))
    nextChat = Math.max(CHAT_MIN, available - nextFile - nextRight)
  } else {
    nextChat = Math.max(CHAT_MIN, available - nextFile)
  }

  if (hasFileTree) fileTreeWidth.value = nextFile
  chatWidth.value = nextChat
  if (hasRightPanel) rightPanelWidth.value = nextRight
}

function onWindowResize() {
  checkMobile()
  if (hasUserResized.value) {
    fitDesktopWidthsToViewport()
  } else {
    applyDefaultDesktopWidths()
  }
}

onMounted(() => {
  checkMobile()
  
  applyDefaultDesktopWidths(true)
  window.addEventListener('resize', onWindowResize)
})

watch([isFileTreeCollapsed, isRightPanelCollapsed, isMember], () => {
  applyDefaultDesktopWidths()
})

function fitDesktopWidthsToViewport() {
  if (isMobile.value) return
  const available = getAvailableDesktopWidth()
  if (available <= 0) return

  const hasFileTree = isFileTreeVisible.value
  const hasRightPanel = !isRightPanelCollapsed.value
  const fileW = hasFileTree ? fileTreeWidth.value : 0
  const rightW = hasRightPanel ? rightPanelWidth.value : 0
  const used = fileW + chatWidth.value + rightW
  const gap = available - used
  if (Math.abs(gap) < 2) return

  if (gap > 0) {
    chatWidth.value += gap
    return
  }

  let overflow = -gap
  if (hasRightPanel) {
    const shrinkRight = Math.min(overflow, Math.max(0, rightPanelWidth.value - RIGHT_MIN))
    rightPanelWidth.value -= shrinkRight
    overflow -= shrinkRight
  }
  const shrinkChat = Math.min(overflow, Math.max(0, chatWidth.value - CHAT_MIN))
  chatWidth.value -= shrinkChat
  overflow -= shrinkChat
  if (hasFileTree && overflow > 0) {
    fileTreeWidth.value = Math.max(FILETREE_MIN, fileTreeWidth.value - overflow)
  }
}

function openMemberPanel(mode: string) {
  workspaceMode.value = 'chat'
  if (!isPanelAvailable(mode)) {
    rightPanel.value = 'settings'
    return
  }

  if (!isMember.value && lockedPanels.has(mode)) {
    rightPanel.value = 'settings'
    emitEvent('membership-required', mode)
    return
  }
  rightPanel.value = mode
}

function toggleRightPanel(mode: string) {
  workspaceMode.value = 'chat'
  if (!isPanelAvailable(mode)) {
    rightPanel.value = 'settings'
    return
  }

  if (!isMember.value && lockedPanels.has(mode)) {
    rightPanel.value = 'settings'
    emitEvent('membership-required', mode)
    return
  }
  rightPanel.value = rightPanel.value === mode ? '' : mode
}

function onRailSwitch(mode: string) {
  if (mode === 'help') {
    showHelpGuide.value = true
    localStorage.setItem('jc_help_seen', 'true')
    return
  }
  if (!isMember.value && lockedPanels.has(mode)) {
    workspaceMode.value = 'chat'
    rightPanel.value = 'settings'
    emitEvent('membership-required', mode)
    return
  }
  if (!isPanelAvailable(mode)) {
    workspaceMode.value = 'chat'
    rightPanel.value = 'settings'
    return
  }
  if (mode === 'files') {
    isFileTreeCollapsed.value = !isFileTreeCollapsed.value
    return
  }
  if (mode === 'canvas') {
    showCanvasWorkspace()
    return
  }
  if (TOGGLEABLE_RIGHT_PANELS.has(mode)) {
    toggleRightPanel(mode)
  }
}

// ─── Resize ───
type ResizeTarget = 'filetree-chat' | 'chat-right'
let resizeTarget: ResizeTarget | null = null
let resizeStartX = 0
let resizeStartFileTreeW = 0
let resizeStartChatW = 0
let resizeStartRightW = 0
let rafId: number | null = null
let latestClientX = 0

function resizePair(
  leftStart: number,
  rightStart: number,
  delta: number,
  leftMin: number,
  leftMax: number,
  rightMin: number
) {
  const total = leftStart + rightStart
  const minLeft = Math.min(leftMin, total)
  const maxLeft = Math.max(minLeft, Math.min(leftMax, total - Math.min(rightMin, total)))
  const left = clamp(leftStart + delta, minLeft, maxLeft)
  return { left, right: total - left }
}

function onResizeStart(e: PointerEvent, target: ResizeTarget) {
  e.stopPropagation()
  resizeTarget = target
  resizeStartX = e.clientX
  resizeStartFileTreeW = Math.round(fileTreeEl.value?.getBoundingClientRect().width || fileTreeWidth.value)
  resizeStartChatW = Math.round(chatEl.value?.getBoundingClientRect().width || chatWidth.value)
  resizeStartRightW = Math.round(rightPanelEl.value?.getBoundingClientRect().width || rightPanelWidth.value)
  fileTreeWidth.value = resizeStartFileTreeW
  chatWidth.value = resizeStartChatW
  rightPanelWidth.value = resizeStartRightW
  latestClientX = e.clientX
  hasUserResized.value = true
  isResizing.value = true
  
  const el = e.currentTarget as HTMLElement
  if (el && el.setPointerCapture) el.setPointerCapture(e.pointerId)
  
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', onResizeEnd)
  window.addEventListener('pointercancel', onResizeEnd)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function onResizeMove(e: PointerEvent) {
  e.preventDefault()
  latestClientX = e.clientX
  if (!rafId) {
    rafId = requestAnimationFrame(() => {
      const delta = latestClientX - resizeStartX
      if (resizeTarget === 'filetree-chat') {
        const next = resizePair(resizeStartFileTreeW, resizeStartChatW, delta, FILETREE_MIN, FILETREE_MAX, CHAT_MIN)
        fileTreeWidth.value = next.left
        chatWidth.value = next.right
      } else if (resizeTarget === 'chat-right') {
        const total = resizeStartChatW + resizeStartRightW
        const minChat = Math.max(CHAT_MIN, total - RIGHT_MAX)
        const maxChat = Math.max(minChat, total - RIGHT_MIN)
        const nextChat = clamp(resizeStartChatW + delta, minChat, maxChat)
        chatWidth.value = nextChat
        rightPanelWidth.value = total - nextChat
      }
      rafId = null
    })
  }
}

function onResizeEnd(e?: PointerEvent) {
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeEnd)
  window.removeEventListener('pointercancel', onResizeEnd)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  isResizing.value = false
  resizeTarget = null
  if (rafId) { cancelAnimationFrame(rafId); rafId = null }
}
</script>

<template>
  <!-- ═══ 移动端布局 ═══ -->
  <div v-if="isMobile" class="ws-mobile">
    <!-- 左侧迷你 Rail -->
    <div class="ws-mobile-rail">
      <button :class="{ active: mobilePanel === 'chat' }" @click="mobilePanel = 'chat'">
        <span class="mso">chat</span>
      </button>
      <button v-if="!isWebRuntime" :class="{ active: mobilePanel === 'skills' }" :disabled="!isMember" @click="mobilePanel = 'skills'">
        <span class="mso">{{ isMember ? 'magic_button' : 'lock' }}</span>
      </button>
      <button :class="{ active: mobilePanel === 'creation' }" :disabled="!creationEnabled" @click="mobilePanel = 'creation'">
        <span class="mso">{{ isMember ? 'photo_camera' : 'lock' }}</span>
      </button>
      <button v-if="!isWebRuntime" :class="{ active: mobilePanel === 'tools' }" :disabled="!isMember" @click="mobilePanel = 'tools'">
        <span class="mso">{{ isMember ? 'construction' : 'lock' }}</span>
      </button>
      <button :class="{ active: mobilePanel === 'editor' }" :disabled="!isMember" @click="mobilePanel = 'editor'">
        <span class="mso">{{ isMember ? 'edit_note' : 'lock' }}</span>
      </button>
      <button :class="{ active: mobilePanel === 'canvas' }" :disabled="!canvasEnabled" @click="mobilePanel = 'canvas'">
        <span class="mso">{{ isMember ? 'account_tree' : 'lock' }}</span>
      </button>
      <div class="ws-mobile-rail-spacer"></div>
      <button :class="{ active: mobilePanel === 'settings' }" @click="mobilePanel = 'settings'">
        <span class="mso">settings</span>
      </button>
    </div>

    <!-- 全屏内容区 -->
    <div class="ws-mobile-body">
      <ChatPanel v-if="mobilePanel === 'chat'" />
      <CreationPanel v-else-if="mobilePanel === 'creation' && creationEnabled" />
      <EditorPanel v-else-if="mobilePanel === 'editor' && isMember" />
      <ToolWarehousePanel v-else-if="mobilePanel === 'tools' && isMember && !isWebRuntime" :is-member="isMember" />
      <CentralSkillsPanel v-else-if="mobilePanel === 'skills' && isMember && !isWebRuntime" />
      <div v-else-if="mobilePanel === 'canvas' && canvasEnabled" class="ws-mobile-panel">
        <div class="ws-mobile-canvas-placeholder">
          <span class="mso">account_tree</span>
          <strong>画布建议在桌面宽屏使用</strong>
          <span>请拉宽窗口或在桌面模式下打开画布。</span>
        </div>
      </div>
      <SettingsPanel v-else-if="mobilePanel === 'settings'" />
    </div>

  </div>

  <!-- ═══ 桌面端布局（原有） ═══ -->
  <div v-else class="ws-root" :class="{ 'is-resizing': isResizing }">
    <!-- Col 1: Activity Rail -->
    <ActivityRail :active="workspaceMode === 'canvas' ? 'canvas' : rightPanel" :is-member="isMember" @switch="onRailSwitch" />

    <!-- Col 2: FileTree — 我的Skill（可隐藏） -->
    <div ref="fileTreeEl" class="ws-col ws-filetree" :class="{ collapsed: !isFileTreeVisible }"
         :style="{ width: !isFileTreeVisible ? '0px' : fileTreeWidth + 'px' }">
      <FileTreePanel v-show="isFileTreeVisible" :is-member="isMember" />
      <div v-if="isFileTreeVisible" class="ws-resize-handle" @pointerdown.prevent="onResizeStart($event, 'filetree-chat')" />
    </div>



    <template v-if="workspaceMode === 'canvas'">
      <div class="ws-col ws-canvas">
        <CanvasWorkspace />
      </div>
    </template>

    <template v-else>
      <!-- Col 4: ChatPanel — ★ 始终显示 ★ -->
      <!-- 网页端变更审查时隐藏第四列 -->
      <div
        v-if="!(isWebRuntime && rightPanel === 'review')"
        ref="chatEl" class="ws-col ws-chat" :style="{ flexBasis: chatWidth + 'px' }">
        <ChatPanel />
        <div v-if="!isRightPanelCollapsed" class="ws-resize-handle" @pointerdown.prevent="onResizeStart($event, 'chat-right')" />
      </div>

      <!-- Col 5: 右侧面板 — Rail 切换（可隐藏） -->
      <div ref="rightPanelEl" class="ws-col ws-right" :class="{ collapsed: isRightPanelCollapsed }"
         :style="{ width: isRightPanelCollapsed ? '0px' : rightPanelWidth + 'px' }">
        <div v-if="!isRightPanelCollapsed" class="ws-right-inner">

        <!-- 新 Skill 管理系统 -->
        <CentralSkillsPanel v-if="rightPanel === 'skills' && !isWebRuntime" />


        <!-- 工具仓库 -->
        <ToolWarehousePanel v-else-if="rightPanel === 'tools' && isMember && !isWebRuntime" :is-member="isMember" />

        <!-- 编辑区 -->
        <EditorPanel v-else-if="rightPanel === 'editor' && isMember" />

        <!-- 创作面板 -->
        <CreationPanel v-else-if="rightPanel === 'creation' && creationEnabled" />

        <!-- 变更审查 -->
        <ReviewPanel v-else-if="rightPanel === 'review' && isMember" />

        <!-- 设置 -->
        <SettingsPanel v-else-if="rightPanel === 'settings'" />

        </div>
      </div>
    </template>

    <Teleport to="body">
      <div v-if="showHelpGuide" class="ws-help-overlay" @click.self="showHelpGuide = false">
        <div class="ws-help-dialog">
          <div class="ws-help-head">
            <div>
              <span>{{ t('help.eyebrow') }}</span>
              <h3>{{ t('help.title') }}</h3>
            </div>
            <button class="ws-help-close" :title="t('help.dismiss')" @click="showHelpGuide = false">
              <span class="mso">close</span>
            </button>
          </div>
          <div class="ws-help-grid">
            <div v-for="card in helpGuideCards" :key="card.title" class="ws-help-card">
              <span class="mso">{{ card.icon }}</span>
              <strong>{{ card.title }}</strong>
              <p>{{ card.text }}</p>
            </div>
          </div>
          <div class="ws-help-actions">
            <button class="ws-help-btn ghost" @click="workspaceMode = 'chat'; rightPanel = 'settings'; showHelpGuide = false">
              {{ t('help.openAccount') }}
            </button>
            <button class="ws-help-btn primary" @click="showHelpGuide = false">{{ t('help.dismiss') }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.ws-root {
  display: flex; width: 100vw; height: 100vh; overflow: hidden; background: var(--bg);
}
.ws-root.is-resizing,
.ws-root.is-resizing * {
  cursor: col-resize !important;
  user-select: none !important;
}

/* Generic column */
.ws-col { position: relative; flex-shrink: 0; overflow: hidden; container-type: inline-size; }
.ws-col.collapsed { width: 0 !important; border: none; }

.ws-filetree { border-right: 1px solid var(--border); transition: width .12s ease-out; }
.ws-chat { flex: 1 1 auto; min-width: 420px; border-right: 1px solid var(--border); display: flex; flex-direction: column; }
.ws-canvas { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.ws-right { flex: 0 0 auto; min-width: 0; transition: width .12s ease-out; }
.ws-right.collapsed { flex: 0; }
.ws-right-inner { width: 100%; height: 100%; overflow-y: auto; background: var(--surface); }
.ws-root.is-resizing .ws-filetree,
.ws-root.is-resizing .ws-chat,
.ws-root.is-resizing .ws-right {
  transition: none !important;
}

/* Resize handle */
.ws-resize-handle {
  position: absolute; top: 0; right: -11px; width: 22px; height: 100%;
  cursor: col-resize; z-index: 30; background: transparent; touch-action: none;
}
.ws-resize-handle::after {
  content: ''; position: absolute; top: 0; left: 10px; width: 1px; height: 100%;
  background: transparent; transition: background .12s, box-shadow .12s;
}
.ws-resize-handle:hover::after,
.ws-root.is-resizing .ws-resize-handle::after {
  background: var(--olive);
  box-shadow: 0 0 0 2px rgba(107, 142, 35, 0.12);
}

/* Placeholder */
.ws-placeholder {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; width: 100%; height: 100%; color: var(--ink3); background: var(--surface);
}
.ws-placeholder p { font-size: 14px; font-weight: 600; }
.ws-hint { font-size: 12px !important; font-weight: 400 !important; color: var(--ink3); }

.ws-mobile-canvas-placeholder {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  color: var(--ink3);
  text-align: center;
}
.ws-mobile-canvas-placeholder .mso { font-size: 32px; color: var(--olive-dark); }
.ws-mobile-canvas-placeholder strong { color: var(--ink1); font-size: 15px; }
.ws-mobile-canvas-placeholder span:last-child { font-size: 12px; line-height: 1.6; }

/* ─── 对话 Skill — 两区布局 ─── */
.ws-warehouse { display: flex; flex-direction: column; height: 100%; }
.ws-warehouse-head {
  padding: 12px 16px; border-bottom: 1px solid var(--line);
  display: flex; align-items: center; gap: 10px;
}
.ws-warehouse-head h3 { font-size: 15px; font-weight: 700; color: var(--ink1); margin: 0; flex-shrink: 0; }
.ws-wh-search-mini {
  flex: 1; display: flex; align-items: center; gap: 4px;
  padding: 4px 8px; border-radius: 6px; border: 1px solid var(--line); background: var(--bg);
}
.ws-wh-search-input {
  flex: 1; border: none; background: none; outline: none;
  font-size: 12px; color: var(--ink1); font-family: inherit;
}
.ws-wh-sort-btn {
  display: flex; align-items: center; gap: 2px;
  padding: 4px 8px; border: 1px solid var(--line); border-radius: 6px;
  background: var(--paper); color: var(--ink2); cursor: pointer;
  font-size: 11px; font-weight: 600; font-family: inherit; flex-shrink: 0;
}
.ws-wh-sort-btn:hover { border-color: var(--olive); color: var(--olive); }
.ws-wh-scroll { flex: 1; overflow-y: auto; padding: 8px 12px 20px; }
.ws-wh-section { margin-bottom: 20px; }
.ws-wh-section-title {
  font-size: 12px; font-weight: 700; color: var(--ink1);
  letter-spacing: 0.04em; padding: 8px 0;
  display: flex; align-items: center; gap: 8px;
  border-bottom: 2px solid var(--line); margin-bottom: 10px;
}
.ws-wh-preset-toggle {
  width: 32px; height: 18px; border-radius: 9px;
  background: var(--line); cursor: pointer; position: relative;
  transition: background .25s; margin-left: auto;
}
.ws-wh-preset-toggle.on { background: var(--olive); }
.ws-wh-preset-toggle-dot {
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--paper); position: absolute; top: 2px; left: 2px;
  transition: transform .25s;
}
.ws-wh-preset-toggle.on .ws-wh-preset-toggle-dot { transform: translateX(14px); }
.ws-wh-preset-hint { font-size: 10px; color: var(--ink3); margin-bottom: 8px; }
.ws-wh-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.ws-wh-card2 {
  padding: 12px 14px; border-radius: 10px;
  border: 2px solid rgba(0,0,0,.12); background: var(--paper);
  display: flex; flex-direction: column; gap: 4px;
  cursor: pointer; transition: all .15s;
  box-shadow: 0 1px 3px rgba(0,0,0,.04);
}
.ws-wh-card2:hover { border-color: var(--olive); box-shadow: 0 4px 12px rgba(0,0,0,.08); transform: translateY(-1px); }
.ws-wh-card2.active { border-color: var(--olive); background: rgba(107,142,35,.06); }
.ws-wh-card2-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.ws-wh-card2-name { font-size: 14px; font-weight: 700; color: var(--ink1); flex: 1; }
.ws-wh-card2-count {
  font-size: 11px; color: var(--olive); font-weight: 700;
  background: rgba(107,142,35,.1); padding: 1px 6px; border-radius: 4px;
}
.ws-wh-card2-menu {
  width: 24px; height: 24px; border: none; border-radius: 4px;
  background: transparent; color: var(--ink3); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.ws-wh-card2-menu:hover { background: var(--surface-alt); color: var(--ink1); }
.ws-wh-card2-desc {
  font-size: 12px; color: var(--ink2); line-height: 1.5; margin-bottom: 4px;
}
.ws-wh-card2-tags { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 6px; }
.ws-wh-tag {
  font-size: 10px; padding: 1px 6px; border-radius: 4px;
  background: rgba(213,199,135,.12); color: var(--olive-dark); font-weight: 600;
}
.ws-wh-card2-action {
  width: 100%; padding: 6px 0; border: 1px dashed var(--line); border-radius: 6px;
  background: transparent; color: var(--ink3); font-size: 11px; font-weight: 600;
  cursor: pointer; font-family: inherit; display: flex; align-items: center;
  justify-content: center; gap: 4px; transition: all .12s;
}
.ws-wh-card2-action.add-my:hover { border-color: var(--olive); color: var(--olive); background: rgba(107,142,35,.04); }
.ws-wh-card2-action.move-out:hover { border-color: #ff9800; color: #ff9800; background: rgba(255,152,0,.04); }
.ws-wh-empty2 { text-align: center; padding: 20px; font-size: 12px; color: var(--ink3); }
.ws-wh-card2-cat {
  font-size: 10px; padding: 1px 6px; border-radius: 4px;
  background: rgba(107,142,35,.1); color: var(--olive); font-weight: 600;
}

/* 分类筛选条 */
.ws-wh-categories {
  display: flex; flex-wrap: wrap; gap: 4px;
  padding: 6px 12px; border-bottom: 1px solid var(--line);
}
.ws-wh-cat-btn {
  display: inline-flex; align-items: center; gap: 2px;
  padding: 3px 8px; border-radius: 12px; border: 1px solid var(--line);
  background: transparent; color: var(--ink3); font-size: 11px;
  font-weight: 600; cursor: pointer; font-family: inherit; transition: all .12s;
  white-space: nowrap;
}
.ws-wh-cat-btn:hover { border-color: var(--olive); color: var(--olive); }
.ws-wh-cat-btn.active { background: var(--olive); border-color: var(--olive); color: #fff; }

/* 悬停预览气泡 */
.ws-wh-preview {
  position: absolute; bottom: 8px; left: 12px; right: 12px;
  padding: 12px; border-radius: 10px;
  background: var(--paper); border: 1px solid var(--border);
  box-shadow: 0 8px 24px rgba(0,0,0,.15);
  z-index: 100; animation: ws-preview-in .12s ease;
  pointer-events: none;
}
@keyframes ws-preview-in { from { opacity:0; transform:translateY(4px) } to { opacity:1; transform:none } }
.ws-wh-preview-name { font-size: 13px; font-weight: 700; color: var(--ink1); margin-bottom: 6px; }
.ws-wh-preview-content {
  font-size: 11px; color: var(--ink2); line-height: 1.5;
  white-space: pre-wrap; max-height: 120px; overflow: hidden;
}
.ws-wh-preview-triggers { font-size: 10px; color: var(--ink3); margin-top: 6px; }

/* 卡片三点菜单 */
.ws-card-menu-overlay { position: fixed; inset: 0; z-index: 9999; background: transparent; }
.ws-card-menu {
  position: fixed; min-width: 180px; padding: 8px;
  background: var(--paper, #fffdf6); border: 1px solid var(--border, var(--line));
  color: var(--ink1);
  border-radius: 12px; box-shadow: 0 18px 44px rgba(24,36,22,.28);
  z-index: 10000;
}
.ws-card-menu-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 10px 14px; border: none; border-radius: 8px;
  background: transparent; color: var(--ink1); font-size: 13px;
  cursor: pointer; font-family: inherit; text-align: left;
  font-weight: 500;
}
.ws-card-menu-item:hover { background: var(--surface); }
.ws-card-menu-item .mso { font-size: 18px; color: var(--olive); }

/* 帮助 / 教程中心 */
.ws-help-overlay {
  position: fixed;
  inset: 0;
  z-index: 10020;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(35, 31, 20, 0.38);
  backdrop-filter: blur(6px);
  box-sizing: border-box;
}
.ws-help-dialog {
  width: min(1080px, calc(100vw - 48px));
  max-height: calc(100dvh - 48px);
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(185, 171, 110, 0.34);
  border-radius: 18px;
  background:
    radial-gradient(circle at 12% 0%, rgba(213, 199, 135, 0.22), transparent 34%),
    linear-gradient(145deg, var(--paper), var(--surface));
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.26);
  overflow: hidden;
}
.ws-help-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 24px 26px 16px;
  flex: 0 0 auto;
}
.ws-help-head span {
  color: var(--olive-dark);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.12em;
}
.ws-help-head h3 {
  margin: 5px 0 0;
  color: var(--ink);
  font-size: 24px;
  line-height: 1.15;
  letter-spacing: 0;
}
.ws-help-close {
  width: 34px;
  height: 34px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.42);
  color: var(--ink2);
  cursor: pointer;
}
.ws-help-close .mso { font-size: 18px; color: inherit; }
.ws-help-grid {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(3, minmax(220px, 1fr));
  grid-auto-rows: minmax(260px, auto);
  align-items: stretch;
  align-content: start;
  gap: 12px;
  padding: 0 26px 20px;
}
.ws-help-card {
  min-height: 260px;
  box-sizing: border-box;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.35);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.ws-help-card .mso {
  display: inline-flex;
  margin-bottom: 10px;
  color: var(--olive);
  font-size: 24px;
  flex: 0 0 auto;
}
.ws-help-card strong {
  display: block;
  color: var(--ink);
  font-size: 15px;
  font-weight: 900;
  flex: 0 0 auto;
}
.ws-help-card p {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  margin: 7px 0 0;
  padding-right: 4px;
  color: var(--ink2);
  font-size: 12px;
  line-height: 1.65;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.ws-help-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 26px 24px;
  border-top: 1px solid var(--border2);
  flex: 0 0 auto;
}
.ws-help-btn {
  min-width: 118px;
  height: 38px;
  border-radius: 999px;
  padding: 0 18px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 900;
  cursor: pointer;
  border: 1px solid var(--border);
}
.ws-help-btn.ghost { background: transparent; color: var(--ink2); }
.ws-help-btn.primary { background: var(--olive); color: #fff; border-color: var(--olive); }

@media (max-width: 640px) {
  .ws-help-overlay { padding: 16px; align-items: stretch; }
  .ws-help-dialog { width: min(440px, 94vw); }
  .ws-help-head { padding: 20px 18px 14px; }
  .ws-help-head h3 { font-size: 20px; }
  .ws-help-grid { grid-template-columns: 1fr; grid-auto-rows: minmax(240px, auto); padding: 0 18px 18px; }
  .ws-help-card { min-height: 240px; }
  .ws-help-actions { padding: 14px 18px 20px; flex-direction: column-reverse; }
  .ws-help-btn { width: 100%; }
}

@media (max-width: 900px) {
  .ws-help-grid { grid-template-columns: repeat(2, minmax(220px, 1fr)); }
}

/* ═══ 移动端样式 ═══ */
.ws-mobile {
  display: flex; width: 100vw; height: 100vh; height: 100dvh;
  overflow: hidden; background: var(--bg);
}

/* 左侧迷你 Rail — 44px 宽 */
.ws-mobile-rail {
  width: 44px; flex-shrink: 0;
  display: flex; flex-direction: column; align-items: center;
  padding: 8px 0; gap: 4px;
  background: var(--surface-alt); border-right: 1px solid var(--border);
}
.ws-mobile-rail button {
  width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  border: none; background: none; border-radius: 8px;
  color: var(--ink3); cursor: pointer; transition: all .15s;
}
.ws-mobile-rail button .mso { font-size: 20px; }
.ws-mobile-rail button:hover,
.ws-mobile-rail button.active {
  background: rgba(213,199,135,.15); color: var(--olive-dark);
}
.ws-mobile-rail button:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}
.ws-mobile-rail button:disabled:hover {
  background: none;
  color: var(--ink3);
}
.ws-mobile-rail-spacer { flex: 1; }

/* 内容区 — 严格约束：flex子元素不允许溢出 */
.ws-mobile-body {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column;
  overflow: hidden;
  /* 关键：显式高度，让子元素 height:100% 生效 */
  height: 100vh; height: 100dvh;
  max-height: 100vh; max-height: 100dvh;
}
.ws-mobile-panel {
  flex: 1; min-height: 0; overflow-y: auto; background: var(--surface);
}
</style>

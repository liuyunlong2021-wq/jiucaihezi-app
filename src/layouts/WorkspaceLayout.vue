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
import { marked } from 'marked'
import ActivityRail from '@/components/rail/ActivityRail.vue'
import FileTreePanel from '@/components/filetree/FileTreePanel.vue'
import ChatPanel from '@/components/chat/ChatPanel.vue'
import ContextUsagePanel from '@/components/chat/ContextUsagePanel.vue'
import ReviewPanel from '@/components/chat/ReviewPanel.vue'
import SettingsPanel from '@/components/settings/SettingsPanel.vue'
import EditorPanel from '@/components/editor/EditorPanel.vue'
import CreationPanel from '@/components/creation/CreationPanel.vue'
import ToolWarehousePanel from '@/components/tools/ToolWarehousePanel.vue'
import PluginPanel from '@/components/plugins/PluginPanel.vue'
import CentralSkillsPanel from '@/components/skills/CentralSkillsPanel.vue'
import WebSkillPanel from '@/components/skills/WebSkillPanel.vue'
import { useAgentStore } from '@/stores/agentStore'
import { emitEvent, onEvent } from '@/utils/eventBus'
import { useLocale } from '@/i18n'
import { isTauriRuntime } from '@/utils/tauriEnv'
import { isStorageDegraded } from '@/utils/idb'
import { useChat } from '@/composables/useChat'

const agentStore = useAgentStore()
//  removed - use isCloudLoggedIn() or isCloudReady instead
const isMember = computed(() => true)  // All features now available once logged in
const creationEnabled = ref(true)
const lockedPanels = new Set(['tools', 'editor', 'files'])
const TOGGLEABLE_RIGHT_PANELS = new Set(['skills', 'tools', 'editor', 'creation', 'review', 'settings'])
const WEB_UNSUPPORTED_PANELS = new Set(['tools', 'files', 'review', 'context'])
const { t } = useLocale()
const isWebRuntime = computed(() => !isTauriRuntime())
const { messages, openCodeContextUsage } = useChat()
const contextMessagesForPanel = computed(() =>
  messages.value.map(m => ({ id: m.id, role: m.role, timestamp: m.timestamp }))
)

// P0-2: 存储降级警告 — 监听 jc-app-ready 事件后检测
const storageDegraded = ref(false)
const storageDegradedDismissed = ref(false)
function checkStorageDegraded() {
  // 优先读 window flag（main.ts initBackend 设置），其次读 isStorageDegraded()
  const winFlag = (window as any).__JC_STORAGE_DEGRADED__
  storageDegraded.value = winFlag === true || (winFlag === undefined && isStorageDegraded())
}
onMounted(() => {
  // 立即检测一次（可能在事件之前已降级）
  // 用 setTimeout 给 initBackend 一小段启动时间
  setTimeout(checkStorageDegraded, 2000)
  window.addEventListener('jc-app-ready', checkStorageDegraded, { once: true })
})
onBeforeUnmount(() => {
  window.removeEventListener('jc-app-ready', checkStorageDegraded)
})

function isPanelAvailable(mode: string) {
  return !isWebRuntime.value || !WEB_UNSUPPORTED_PANELS.has(mode)
}

// ─── 移动端适配 ───
const isMobile = ref(false)
const mobilePanel = ref<'chat' | 'history' | 'creation' | 'settings'>('chat')

function checkMobile() {
  isMobile.value = window.innerWidth <= 768
}

// ─── Col 5 当前面板 ───
const workspaceMode = ref<'chat' | 'canvas'>('chat') // 画布已移除，固定 chat
const rightPanel = ref<string>('settings')
const showHelpGuide = ref(false)
const helpGuideHtml = ref('')
const helpGuideLoading = ref(false)

async function openHelpGuide() {
  if (helpGuideHtml.value) { showHelpGuide.value = true; return }
  helpGuideLoading.value = true
  try {
    const resp = await fetch('/help/guide.md')
    const md = await resp.text()
    // 修正图片路径：相对路径 → 绝对路径
    const fixed = md.replace(/\(images\//g, '(/help/images/')
    helpGuideHtml.value = await marked.parse(fixed)
    showHelpGuide.value = true
  } catch {
    helpGuideHtml.value = '<p>帮助文档加载失败，请稍后重试。</p>'
    showHelpGuide.value = true
  } finally {
    helpGuideLoading.value = false
  }
}

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

const offSwitchWorkspaceMode = onEvent('switch-workspace-mode', (mode: unknown) => {
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
const isFileTreeCollapsed = ref(false)
const isFileTreeVisible = computed(() => !isFileTreeCollapsed.value)
const isRightPanelCollapsed = computed(() => !rightPanel.value)

// 宽度 — Chat 自动填充剩余空间 (flex:1)
const ACTIVITY_RAIL_WIDTH = 52
const FILETREE_MIN = 220
const FILETREE_MAX = 380
const RIGHT_MIN = 260
const RIGHT_MAX = 9999  // ponytail: 不设上限，用户爱拉多大拉多大
const fileTreeWidth = ref(280)
const rightPanelWidth = ref(420)
const hasUserResized = ref(false)
const isResizing = ref(false)
const fileTreeEl = ref<HTMLElement | null>(null)

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
  const desiredFile = hasFileTree ? Math.round(available * 0.2) : 0
  const desiredRight = hasRightPanel ? Math.min(RIGHT_MAX, Math.round(available * 0.33)) : 0
  if (hasFileTree) fileTreeWidth.value = clamp(desiredFile, FILETREE_MIN, FILETREE_MAX)
  if (hasRightPanel) rightPanelWidth.value = clamp(desiredRight, RIGHT_MIN, RIGHT_MAX)
}

function onWindowResize() {
  checkMobile()
  if (!hasUserResized.value) applyDefaultDesktopWidths()
}

onMounted(() => {
  checkMobile()
  applyDefaultDesktopWidths(true)
  window.addEventListener('resize', onWindowResize)
})

watch([isFileTreeCollapsed, isRightPanelCollapsed, isMember], () => {
  applyDefaultDesktopWidths()
})

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
    openHelpGuide()
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
  if (TOGGLEABLE_RIGHT_PANELS.has(mode)) {
    toggleRightPanel(mode)
  }
}

// ─── Resize ───
type ResizeTarget = 'filetree-chat' | 'chat-right' | 'right-edge'
let resizeTarget: ResizeTarget | null = null
let resizeStartX = 0
let resizeStartFileTreeW = 0
let resizeStartRightW = 0
let rafId: number | null = null
let latestClientX = 0

function onResizeStart(e: PointerEvent, target: ResizeTarget) {
  e.stopPropagation()
  resizeTarget = target
  resizeStartX = e.clientX
  resizeStartFileTreeW = fileTreeWidth.value
  resizeStartRightW = rightPanelWidth.value
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
        fileTreeWidth.value = clamp(resizeStartFileTreeW + delta, FILETREE_MIN, FILETREE_MAX)
      } else if (resizeTarget === 'chat-right' || resizeTarget === 'right-edge') {
        rightPanelWidth.value = clamp(resizeStartRightW - delta, RIGHT_MIN, RIGHT_MAX)
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
    <!-- P0-2: 存储降级警告 banner（移动端） -->
    <div v-if="storageDegraded && !storageDegradedDismissed" class="ws-degraded-banner ws-degraded-banner-mobile">
      <JcIcon name="warning" />
      <span>⚠️ 本地存储未就绪，数据可能无法保存。</span>
      <button class="ws-degraded-dismiss" @click="storageDegradedDismissed = true">
        <JcIcon name="close" />
      </button>
    </div>
    <!-- 左侧迷你 Rail：创作 / 对话⇄记录 / 用户中心 -->
    <div class="ws-mobile-rail">
      <button :class="{ active: mobilePanel === 'creation' }" :disabled="!creationEnabled" @click="mobilePanel = 'creation'" title="创作面板">
        <JcIcon :name="isMember ? 'photo_camera' : 'lock'" />
      </button>
      <div class="ws-mobile-rail-spacer"></div>
      <!-- 对话⇄记录 切换：聊天时显示历史图标，其他状态显示聊天图标 -->
      <button
        :class="{ active: mobilePanel === 'chat' || mobilePanel === 'history' }"
        @click="mobilePanel = (mobilePanel === 'history' ? 'chat' : 'history')"
        :title="mobilePanel === 'history' ? '返回对话' : '对话记录'"
      >
        <JcIcon :name="mobilePanel === 'history' ? 'chat' : 'history'" />
      </button>
      <button :class="{ active: mobilePanel === 'settings' }" @click="mobilePanel = 'settings'" title="用户中心">
        <JcIcon name="account_circle" />
      </button>
    </div>

    <!-- 全屏内容区 -->
    <div class="ws-mobile-body">
      <ChatPanel v-if="mobilePanel === 'chat'" />
      <FileTreePanel v-else-if="mobilePanel === 'history'" :is-member="isMember" />
      <CreationPanel v-else-if="mobilePanel === 'creation' && creationEnabled" />
      <SettingsPanel v-else-if="mobilePanel === 'settings'" />
    </div>

  </div>

  <!-- ═══ 桌面端布局（原有） ═══ -->
  <div v-else class="ws-root" :class="{ 'is-resizing': isResizing }">
    <!-- ponytail: titlebar drag region（配合 titleBarStyle: overlay，让窗口可拖动） -->
    <div data-tauri-drag-region class="ws-titlebar-drag"></div>
    <!-- P0-2: 存储降级警告 banner -->
    <div v-if="storageDegraded && !storageDegradedDismissed" class="ws-degraded-banner">
      <JcIcon name="warning" />
      <span>⚠️ 本地存储未就绪，数据可能无法保存。建议重启 APP 或清空 ~/.jiucaihezi/data 后重试。</span>
      <button class="ws-degraded-dismiss" @click="storageDegradedDismissed = true">
        <JcIcon name="close" />
      </button>
    </div>

    <!-- Col 1: Activity Rail -->
    <ActivityRail :active="workspaceMode === 'canvas' ? 'canvas' : rightPanel" :is-member="isMember" @switch="onRailSwitch" />

    <!-- Col 2: FileTree — 我的Skill（可隐藏） -->
    <div ref="fileTreeEl" class="ws-col ws-filetree" :class="{ collapsed: !isFileTreeVisible }"
         :style="{ width: !isFileTreeVisible ? '0px' : fileTreeWidth + 'px' }">
      <FileTreePanel v-show="isFileTreeVisible" :is-member="isMember" />
      <div v-if="isFileTreeVisible" class="ws-resize-handle" @pointerdown.prevent="onResizeStart($event, 'filetree-chat')" />
    </div>

    <!-- Col 3: ChatPanel — 始终显示，自动填充 -->
    <div ref="chatEl" class="ws-col ws-chat">
        <ChatPanel />
        <div v-if="!isRightPanelCollapsed" class="ws-resize-handle" @pointerdown.prevent="onResizeStart($event, 'chat-right')" />
      </div>

      <!-- Col 4: 右侧面板 — Rail 切换（可隐藏） -->
      <div ref="rightPanelEl" class="ws-col ws-right" :class="{ collapsed: isRightPanelCollapsed }"
         :style="{ width: isRightPanelCollapsed ? '0px' : rightPanelWidth + 'px' }">
        <div v-if="!isRightPanelCollapsed" class="ws-right-inner">

        <!-- 面板折叠按钮 -->
        <button class="ws-right-collapse" title="折叠面板" @click="rightPanel = ''">
          <JcIcon name="chevron_right" />
        </button>

        <!-- 新 Skill 管理系统 -->
        <CentralSkillsPanel v-if="rightPanel === 'skills' && !isWebRuntime" />
        <WebSkillPanel v-if="rightPanel === 'skills' && isWebRuntime" />


        <!-- 工具仓库 -->
        <ToolWarehousePanel v-else-if="rightPanel === 'tools' && isMember && !isWebRuntime" :is-member="isMember" />

        <!-- 插件系统 -->
        <PluginPanel v-else-if="rightPanel === 'plugins'" />

        <!-- 编辑区 -->
        <EditorPanel v-else-if="rightPanel === 'editor' && isMember" />

        <!-- 创作面板 -->
        <CreationPanel v-else-if="rightPanel === 'creation' && creationEnabled" />

        <!-- 变更审查 -->
        <ReviewPanel v-else-if="rightPanel === 'review' && isMember && !isWebRuntime" />

        <!-- 上下文用量（仅桌面端） -->
        <ContextUsagePanel
          v-else-if="rightPanel === 'context' && !isWebRuntime"
          :usage="openCodeContextUsage"
          :messages="contextMessagesForPanel"
          @close="rightPanel = ''"
        />

        <!-- 设置 -->
        <SettingsPanel v-else-if="rightPanel === 'settings'" />

        </div>
        <!-- 右边缘拖拽手柄：独立调整右侧面板宽度 -->
        <div v-if="!isRightPanelCollapsed" class="ws-resize-handle ws-resize-right" @pointerdown.prevent="onResizeStart($event, 'right-edge')" />
      </div>

    <Teleport to="body">
      <div v-if="showHelpGuide" class="ws-help-overlay" @click.self="showHelpGuide = false">
        <div class="ws-help-dialog">
          <div class="ws-help-head">
            <div>
              <span>新手教程</span>
              <h3>韭菜盒子使用指南</h3>
            </div>
            <button class="ws-help-close" title="关闭" @click="showHelpGuide = false">
              <JcIcon name="close" />
            </button>
          </div>
          <div v-if="helpGuideLoading" class="ws-help-loading">
            <JcIcon name="sync" /> 加载中...
          </div>
          <div v-else class="ws-help-body" v-html="helpGuideHtml" />
          <div class="ws-help-actions">
            <button class="ws-help-btn primary" @click="showHelpGuide = false">关闭</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* P0-2: 存储降级警告 banner */
.ws-degraded-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: #fff3cd;
  border-bottom: 2px solid #ffc107;
  color: #664d03;
  font-size: 13px;
  line-height: 1.5;
}
.ws-degraded-banner-mobile {
  /* 移动端非 fixed，避免覆盖导航 */
  position: relative;
  flex-shrink: 0;
}
.ws-degraded-dismiss {
  margin-left: auto;
  background: none;
  border: none;
  cursor: pointer;
  color: #664d03;
  opacity: 0.6;
  padding: 4px;
}
.ws-degraded-dismiss:hover { opacity: 1; }

.ws-root {
  display: flex; width: 100vw; height: 100vh; overflow: hidden; background: var(--bg);
  padding-top: 28px; /* ponytail: titleBarStyle overlay — 给红黄绿按钮留空间 */
}
.ws-titlebar-drag {
  position: fixed; top: 0; left: 0; right: 0; height: 28px; z-index: 10000;
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
.ws-chat { flex: 1 1 auto; min-width: 220px; border-right: 1px solid var(--border); display: flex; flex-direction: column; }
.ws-creation-stage { flex: 1 1 auto; min-width: 0; overflow: hidden; }
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
/* 右侧面板右边缘手柄：向左拖拽，手柄在面板左边缘 */
.ws-resize-right { right: auto; left: -11px; }

/* 右侧面板折叠按钮 */
.ws-right-collapse {
  position: absolute; top: 8px; left: 6px; z-index: 20;
  width: 24px; height: 24px; border: 1px solid transparent; border-radius: 6px;
  background: transparent; color: var(--ink3); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity .15s;
}
.ws-right:hover .ws-right-collapse { opacity: 0.6; }
.ws-right-collapse:hover { opacity: 1 !important; background: var(--olive-pale); color: var(--olive-dark); }

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
.ws-help-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0 26px 20px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--ink);
}
.ws-help-body :deep(h2) { margin: 24px 0 12px; font-size: 20px; color: var(--ink); border-bottom: 1px solid var(--border); padding-bottom: 8px; }
.ws-help-body :deep(h3) { margin: 18px 0 8px; font-size: 16px; }
.ws-help-body :deep(p) { margin: 0 0 10px; }
.ws-help-body :deep(ul), .ws-help-body :deep(ol) { margin: 0 0 10px; padding-left: 20px; }
.ws-help-body :deep(li) { margin-bottom: 4px; }
.ws-help-body :deep(code) { background: var(--bg); padding: 2px 6px; border-radius: 4px; font-size: 13px; }
.ws-help-body :deep(pre) { background: var(--bg); padding: 12px 16px; border-radius: 8px; overflow-x: auto; margin: 0 0 12px; }
.ws-help-body :deep(pre code) { background: none; padding: 0; }
.ws-help-body :deep(table) { width: 100%; border-collapse: collapse; margin: 0 0 12px; }
.ws-help-body :deep(th), .ws-help-body :deep(td) { border: 1px solid var(--border); padding: 8px 12px; text-align: left; }
.ws-help-body :deep(th) { background: var(--bg); font-weight: 600; }
.ws-help-body :deep(a) { color: var(--olive-dark); }
.ws-help-body :deep(blockquote) { border-left: 3px solid var(--olive); padding-left: 12px; margin: 0 0 10px; color: var(--ink2); }
.ws-help-body :deep(hr) { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
.ws-help-body :deep(img) { max-width: 100%; border-radius: 8px; margin: 8px 0; }
.ws-help-loading { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 40px; color: var(--ink2); font-size: 14px; }
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
  width: 36px; height: 36px; font-size: 20px;
  display: flex; align-items: center; justify-content: center;
  border: none; background: none; border-radius: 8px;
  color: var(--ink3); cursor: pointer; transition: all .15s;
}
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
  animation: wsMobileSlideIn 0.15s ease;
}
@keyframes wsMobileSlideIn {
  from { opacity: 0; transform: translateX(8px); }
  to { opacity: 1; transform: translateX(0); }
}
</style>

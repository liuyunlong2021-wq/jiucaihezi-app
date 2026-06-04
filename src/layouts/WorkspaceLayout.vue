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
import SettingsPanel from '@/components/settings/SettingsPanel.vue'
import BrainPanel from '@/components/brain/BrainPanel.vue'
import VaultWizard from '@/components/vault/VaultWizard.vue'
import EditorPanel from '@/components/editor/EditorPanel.vue'
import CreationPanel from '@/components/creation/CreationPanel.vue'
import ToolWarehousePanel from '@/components/tools/ToolWarehousePanel.vue'
import { useAgentStore } from '@/stores/agentStore'
import { useVaultStore } from '@/stores/vaultStore'
import { emitEvent, onEvent } from '@/utils/eventBus'
import { useLocale } from '@/i18n'
import type { SkillConfig } from '@/types/skill'
import { SKILL_CATEGORIES } from '@/types/skill'
import { VAULT_TEMPLATES } from '@/data/vaultTemplates'
import type { VaultTemplate } from '@/data/vaultTemplates'
import type { Vault } from '@/stores/vaultStore'
import { confirmAction } from '@/utils/confirmAction'
import { SKILL_WAREHOUSE_MENU_ITEMS, type SkillWarehouseMenuAction } from '@/utils/skillWarehouseMenu'

const agentStore = useAgentStore()
const vaultStoreWH = useVaultStore()
//  removed - use isCloudLoggedIn() or isCloudReady instead
const isMember = computed(() => true)  // All features now available once logged in
const canvasEnabled = ref(true)
const creationEnabled = ref(true)
const lockedPanels = new Set(['agents', 'vaultCreate', 'vaultWarehouse', 'tools', 'editor', 'files'])
const TOGGLEABLE_RIGHT_PANELS = new Set(['agents', 'vaultCreate', 'vaultWarehouse', 'tools', 'editor', 'creation', 'settings'])
const CanvasWorkspace = defineAsyncComponent(() => import('@/components/canvas/CanvasWorkspace.vue'))
const { t } = useLocale()

// ─── 移动端适配 ───
const isMobile = ref(false)
const mobilePanel = ref<'chat' | 'creation' | 'agents' | 'tools' | 'brain' | 'editor' | 'canvas' | 'settings'>('chat')

function selectSkillCreatorAgent() {
  agentStore.selectAgent('preset_skill-creator')
  if (isMobile.value) mobilePanel.value = 'chat'
  else rightPanel.value = ''
}

function checkMobile() {
  isMobile.value = window.innerWidth <= 768
}

// ─── Col 5 当前面板 ───
const workspaceMode = ref<'chat' | 'canvas'>('chat')
const rightPanel = ref<string>('settings')
const showHelpGuide = ref(false)
const helpGuideCards = [
  {
    icon: 'chat',
    title: '开始对话',
    text: `对话框顶部可以选择模型
Claude是诸葛亮，又帅又能打
Opus最好也最贵适合做复杂的;
Sonnet平衡基本都能干
haiku便宜适合简单任务
GPT是司马懿，持续而稳定
GPT5.5和5.4一个价,都能处理复杂任务
Gemini是周瑜，媳妇儿好看
pro:说话好听
flash:便宜`,
  },
  {
    icon: 'deployed_code_account',
    title: 'Skills',
    text: `Skill就是skills/agent
就是以固定规则做事的方法
第一列的第一个按钮可以创建自己的Skill
第一列的第二个按钮可以查看你创建的Skill和内置的Skill
对话框可以在Skill选择中选择你要使用的Skill（选择器的Skill和Skill仓库中的我的Skill同步）
第二列的Skill可以查看Skill的skill.md文件`,
  },
  {
    icon: 'psychology',
    title: '知识库',
    text: `知识库就是标准答案，用途就是让大模型知道你的标准答案
第一列的第三个按钮可以创建自己的知识库（一定要用MD文档，省钱）
第一列的第四个按钮可以查看你创建的知识库和内置的知识库
对话框可以在知识库选择中选择你要使用的知识库（选择器的知识库和知识库仓库中的我的知识库同步）
第二列的知识库可以查看知识库的Wiki结构`,
  },
  {
    icon: 'account_tree',
    title: '画布',
    text: `画布支持 30+ 节点类型串联执行
文本、图像、视频、音频生成 + RunningHub + Seedance
循环器、素材集、文本分割、首尾帧等流程节点
拖拽连线、批量运行、一键执行全部节点`,
  },
  {
    icon: 'construction',
    title: '工具',
    text: `工具仓库保留桌面端可用的本地和云端工具
本地 Ollama、文件、画布、编辑区和 Office 导出都在桌面端继续可用
魔法联网、知识库整理和创作能力会逐步统一到工具入口`,
  },
  {
    icon: 'account_circle',
    title: '账户和韭菜花',
    text: `在设置里填入 API Key 即可使用云端所有模型
充值、签到、邀请新用户等功能请前往韭菜盒子网页端
新手建议选用「自动分组」，所有模型都能用
追求稳定的推荐「川普特供」分组`,
  },
]

// 监听全局面板切换事件（如 MessageBubble 导入编辑区）
const offSwitchPanel = onEvent('switch-panel', (panel: unknown) => {
  if (typeof panel === 'string') {
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

  if (!isMember.value && lockedPanels.has(mode)) {
    rightPanel.value = 'settings'
    emitEvent('membership-required', mode)
    return
  }
  rightPanel.value = mode
}

function toggleRightPanel(mode: string) {
  workspaceMode.value = 'chat'

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
// 「Skill缔造」→ 选中 skill-creator Skill，不打开独立面板
  if (mode === 'create') {
    selectSkillCreatorAgent()
    return
  }
  if (!isMember.value && lockedPanels.has(mode)) {
    workspaceMode.value = 'chat'
    rightPanel.value = 'settings'
    emitEvent('membership-required', mode)
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

// ─── Skill仓库：搜索 + 分组 + 分类筛选 + 预览 + 右键菜单 ───
const agentFilter = ref('')
const categoryFilter = ref<string>('') // 空 = 全部
const hoveredSkill = ref<SkillConfig | null>(null) // 悬停预览

// 仓库面板：我的Skill + 内置Skill（带搜索过滤和排序）
// 用 tick 触发响应式更新（localStorage 不是响应式的）
const warehouseTick = ref(0)
function refreshWarehouse() { warehouseTick.value++ }

function filterSkillsByQueryAndCategory(skills: SkillConfig[]): SkillConfig[] {
  const q = agentFilter.value.toLowerCase()
  const cat = categoryFilter.value
  let result = skills
  if (q) result = result.filter(a =>
    a.name.toLowerCase().includes(q) ||
    (a.oneLineDesc || a.description || '').toLowerCase().includes(q) ||
    (a.triggers || []).some(t => t.toLowerCase().includes(q))
  )
  if (cat) result = result.filter(a => (a.category || 'other') === cat)
  return result
}

const sortedMySkills = computed(() => {
  void warehouseTick.value
  return agentStore.sortSkills(filterSkillsByQueryAndCategory(agentStore.getMySkills()))
})

const sortedPresetSkills = computed(() => {
  void warehouseTick.value
  return agentStore.sortSkills(filterSkillsByQueryAndCategory(agentStore.getPresetSkills()))
})

// 卡片三点菜单
const cardMenu = ref({ show: false, x: 0, y: 0, skill: null as SkillConfig | null, zone: '' as 'my' | 'preset' | '' })

function menuPoint(e: MouseEvent, width = 220, height = 220): { x: number; y: number } {
  const padding = 12
  return {
    x: Math.min(e.clientX, Math.max(padding, window.innerWidth - width - padding)),
    y: Math.min(e.clientY, Math.max(padding, window.innerHeight - height - padding)),
  }
}

function openCardMenu(e: MouseEvent, skill: SkillConfig, zone: 'my' | 'preset') {
  e.stopPropagation()
  const point = menuPoint(e)
  cardMenu.value = { show: true, x: point.x, y: point.y, skill, zone }
}

function editCardField(field: 'name' | 'triggers') {
  const skill = cardMenu.value.skill
  cardMenu.value.show = false
  if (!skill) return
  const labels: Record<string, string> = { name: 'Skill名字', triggers: 'Skill命中关键词（逗号分隔）' }
  const current = field === 'triggers' ? (skill.triggers || []).join(', ') : (skill.name || '')
  const newVal = prompt(labels[field], current)
  if (newVal === null) return
  if (field === 'triggers') {
    agentStore.updateSkill(skill.id, { triggers: newVal.split(/[,，]/).map(s => s.trim()).filter(Boolean) })
  } else {
    agentStore.updateSkill(skill.id, { name: newVal.trim() })
  }
}

function modifySkillWithCreator(skill: SkillConfig) {
  cardMenu.value.show = false
  agentStore.selectAgent('preset_skill-creator')
  emitEvent('skill-modify-requested', {
    id: skill.id,
    name: skill.name,
    skillContent: skill.skillContent || '',
  })
  workspaceMode.value = 'chat'
  if (isMobile.value) mobilePanel.value = 'chat'
  else rightPanel.value = ''
}

function handleSkillWarehouseMenu(action: SkillWarehouseMenuAction) {
  const skill = cardMenu.value.skill
  if (!skill) {
    cardMenu.value.show = false
    return
  }
  if (action === 'rename') editCardField('name')
  if (action === 'modify') modifySkillWithCreator(skill)
  if (action === 'editTriggers') editCardField('triggers')
}

function startChatWithAgent(agentId: string) {
  agentStore.selectAgent(agentId)
  rightPanel.value = ''
}

// ─── 知识库仓库 ───
const vaultFilter = ref('')
const vaultCardMenu = ref({ show: false, x: 0, y: 0, vault: null as Vault | null })

const sortedMyVaults = computed(() => {
  const q = vaultFilter.value.toLowerCase()
  let list = vaultStoreWH.vaults.filter(v => v.status === 'active')
  if (q) list = list.filter(v =>
    v.name.toLowerCase().includes(q) ||
    (v.oneLineDesc || v.description || '').toLowerCase().includes(q) ||
    (v.keywords || []).some(k => k.toLowerCase().includes(q))
  )
  return list
})

const availableTemplates = computed(() => {
  const existing = new Set(vaultStoreWH.vaults.map(v => v.template).filter(Boolean))
  return VAULT_TEMPLATES.filter(t => !existing.has(t.id))
})

function selectVaultFromWarehouse(vaultId: string) {
  vaultStoreWH.setActiveVault(vaultId)
  rightPanel.value = ''
}

function openVaultCardMenu(e: MouseEvent, vault: Vault) {
  e.stopPropagation()
  const point = menuPoint(e)
  vaultCardMenu.value = { show: true, x: point.x, y: point.y, vault }
}

function editVaultField(field: 'name' | 'keywords' | 'oneLineDesc') {
  const vault = vaultCardMenu.value.vault
  vaultCardMenu.value.show = false
  if (!vault) return
  const labels: Record<string, string> = { name: '知识库名称', keywords: '关键词（逗号分隔）', oneLineDesc: '一句话介绍' }
  const current = field === 'keywords' ? (vault.keywords || []).join(', ') : (vault[field] || '')
  const newVal = prompt(labels[field], current)
  if (newVal === null) return
  if (field === 'keywords') {
    vaultStoreWH.updateVault(vault.id, { keywords: newVal.split(/[,，]/).map(s => s.trim()).filter(Boolean) })
  } else {
    vaultStoreWH.updateVault(vault.id, { [field]: newVal.trim() })
  }
}

async function deleteVaultFromWarehouse() {
  const vault = vaultCardMenu.value.vault
  vaultCardMenu.value.show = false
  if (!vault) return
  if (!await confirmAction(`确定删除知识库「${vault.name}」？此操作不可撤销。`)) return
  await vaultStoreWH.deleteVault(vault.id)
}

async function addTemplateVault(tpl: VaultTemplate) {
  await vaultStoreWH.createVault(tpl.name, tpl.type, {
    description: tpl.oneLineDesc,
    oneLineDesc: tpl.oneLineDesc,
    keywords: [...tpl.keywords],
    template: tpl.id,
    icon: tpl.icon,
    claudeMd: tpl.claudeMd,
    rawFolders: [...tpl.rawFolders],
    wikiFolders: [...tpl.wikiFolders],
  })
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
      <button :disabled="!isMember" @click="selectSkillCreatorAgent()">
        <span class="mso">{{ isMember ? 'build_circle' : 'lock' }}</span>
      </button>
      <button :class="{ active: mobilePanel === 'agents' }" :disabled="!isMember" @click="mobilePanel = 'agents'">
        <span class="mso">{{ isMember ? 'deployed_code_account' : 'lock' }}</span>
      </button>
      <button :class="{ active: mobilePanel === 'creation' }" :disabled="!creationEnabled" @click="mobilePanel = 'creation'">
        <span class="mso">{{ isMember ? 'photo_camera' : 'lock' }}</span>
      </button>
      <button :class="{ active: mobilePanel === 'tools' }" :disabled="!isMember" @click="mobilePanel = 'tools'">
        <span class="mso">{{ isMember ? 'construction' : 'lock' }}</span>
      </button>
      <button :class="{ active: mobilePanel === 'brain' }" :disabled="!isMember" @click="mobilePanel = 'brain'">
        <span class="mso">{{ isMember ? 'psychology' : 'lock' }}</span>
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
      <BrainPanel v-else-if="mobilePanel === 'brain' && isMember" :is-member="isMember" />
      <EditorPanel v-else-if="mobilePanel === 'editor' && isMember" />
      <ToolWarehousePanel v-else-if="mobilePanel === 'tools' && isMember" :is-member="isMember" />
      <div v-else-if="mobilePanel === 'canvas' && canvasEnabled" class="ws-mobile-panel">
        <div class="ws-mobile-canvas-placeholder">
          <span class="mso">account_tree</span>
          <strong>画布建议在桌面宽屏使用</strong>
          <span>请拉宽窗口或在桌面模式下打开画布。</span>
        </div>
      </div>
      <div v-else-if="mobilePanel === 'agents' && isMember" class="ws-mobile-panel">
        <div class="ws-warehouse">
          <div class="ws-warehouse-head">
            <h3>Skill仓库</h3>
            <div class="ws-wh-search-mini">
              <span class="mso" style="font-size:14px;color:var(--ink3)">search</span>
              <input v-model="agentFilter" type="text" placeholder="搜索..." class="ws-wh-search-input" />
            </div>
          </div>
          <div class="ws-wh-scroll">
            <div class="ws-wh-section">
              <div class="ws-wh-section-title">我的Skill</div>
              <div class="ws-wh-list">
                <div v-for="a in sortedMySkills" :key="a.id" class="ws-wh-card2"
                     :class="{ active: agentStore.currentAgent?.id === a.id }"
                     @click="startChatWithAgent(a.id); mobilePanel = 'chat'">
                  <div class="ws-wh-card2-head">
                    <span class="ws-wh-card2-name">{{ a.name }}</span>
                    <span class="ws-wh-card2-count">{{ agentStore.getCallCount(a.id) || '' }}</span>
                  </div>
                  <div v-if="a.oneLineDesc || a.description" class="ws-wh-card2-desc">{{ a.oneLineDesc || a.description }}</div>
                </div>
                <div v-if="sortedMySkills.length === 0" class="ws-wh-empty2">暂无Skill</div>
              </div>
            </div>
            <div class="ws-wh-section">
              <div class="ws-wh-section-title">内置Skill</div>
              <div class="ws-wh-list">
                <div v-for="a in sortedPresetSkills" :key="a.id" class="ws-wh-card2"
                     @click="startChatWithAgent(a.id); mobilePanel = 'chat'">
                  <div class="ws-wh-card2-head">
                    <span class="ws-wh-card2-name">{{ a.name }}</span>
                  </div>
                  <div v-if="a.oneLineDesc || a.description" class="ws-wh-card2-desc">{{ a.oneLineDesc || a.description }}</div>
                </div>
              </div>
            </div>
          </div>
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
      <div ref="chatEl" class="ws-col ws-chat" :style="{ flexBasis: chatWidth + 'px' }">
        <ChatPanel />
        <div v-if="!isRightPanelCollapsed" class="ws-resize-handle" @pointerdown.prevent="onResizeStart($event, 'chat-right')" />
      </div>

      <!-- Col 5: 右侧面板 — Rail 切换（可隐藏） -->
      <div ref="rightPanelEl" class="ws-col ws-right" :class="{ collapsed: isRightPanelCollapsed }"
         :style="{ width: isRightPanelCollapsed ? '0px' : rightPanelWidth + 'px' }">
        <div v-if="!isRightPanelCollapsed" class="ws-right-inner">

        <!-- Skill仓库 — 两区布局 + 分类筛选 + 悬停预览 -->
        <div v-if="rightPanel === 'agents' && isMember" class="ws-warehouse">
          <div class="ws-warehouse-head">
            <h3>Skill仓库</h3>
            <div class="ws-wh-search-mini">
              <span class="mso" style="font-size:14px;color:var(--ink3)">search</span>
              <input v-model="agentFilter" type="text" placeholder="搜索..." class="ws-wh-search-input" />
            </div>
            <button class="ws-wh-sort-btn" @click="agentStore.setSortMode(agentStore.sortMode === 'callCount' ? 'name' : 'callCount')">
              <span class="mso" style="font-size:14px">sort</span>
              <span>{{ agentStore.sortMode === 'callCount' ? '次数' : '名称' }}</span>
            </button>
          </div>
          <!-- 分类筛选条 -->
          <div class="ws-wh-categories">
            <button class="ws-wh-cat-btn" :class="{ active: !categoryFilter }" @click="categoryFilter = ''">全部</button>
            <button v-for="cat in SKILL_CATEGORIES" :key="cat.id"
              class="ws-wh-cat-btn" :class="{ active: categoryFilter === cat.id }"
              @click="categoryFilter = categoryFilter === cat.id ? '' : cat.id">
              <span class="mso" style="font-size:12px">{{ cat.icon }}</span>
              {{ cat.name }}
            </button>
          </div>

          <div class="ws-wh-scroll">
            <!-- 我的Skill区 -->
            <div class="ws-wh-section">
              <div class="ws-wh-section-title">我的Skill</div>
              <div class="ws-wh-list">
                <div v-for="a in sortedMySkills" :key="a.id" class="ws-wh-card2"
                     :class="{ active: agentStore.currentAgent?.id === a.id }"
                     @click="startChatWithAgent(a.id)"
                     @mouseenter="hoveredSkill = a" @mouseleave="hoveredSkill = null">
                  <div class="ws-wh-card2-head">
                    <span class="ws-wh-card2-name">{{ a.name }}</span>
                    <span v-if="a.category" class="ws-wh-card2-cat">{{ SKILL_CATEGORIES.find(c => c.id === a.category)?.name }}</span>
                    <span class="ws-wh-card2-count">{{ agentStore.getCallCount(a.id) || '' }}</span>
                    <button class="ws-wh-card2-menu" @click.stop="openCardMenu($event, a, 'my')">
                      <span class="mso">more_horiz</span>
                    </button>
                  </div>
                  <div v-if="a.oneLineDesc || a.description" class="ws-wh-card2-desc">{{ a.oneLineDesc || a.description }}</div>
                  <div class="ws-wh-card2-tags" v-if="a.triggers?.length">
                    <span v-for="t in a.triggers.slice(0, 4)" :key="t" class="ws-wh-tag">{{ t }}</span>
                  </div>
                  <button class="ws-wh-card2-action move-out" @click.stop="agentStore.moveToPreset(a.id); refreshWarehouse()">
                    <span class="mso" style="font-size:13px">arrow_downward</span> 放入内置Skill
                  </button>
                </div>
                <div v-if="sortedMySkills.length === 0" class="ws-wh-empty2">从下方内置Skill中添加</div>
              </div>
            </div>

            <!-- 内置Skill区 -->
            <div class="ws-wh-section">
              <div class="ws-wh-section-title">
                <span>内置Skill</span>
                <div class="ws-wh-preset-toggle" :class="{ on: agentStore.presetEnabled }" @click="agentStore.togglePresetEnabled()">
                  <div class="ws-wh-preset-toggle-dot"></div>
                </div>
              </div>
              <div class="ws-wh-preset-hint">{{ agentStore.presetEnabled ? '内置Skill可加入我的Skill' : '内置Skill暂不推荐' }}</div>
              <div class="ws-wh-list">
                <div v-for="a in sortedPresetSkills" :key="a.id" class="ws-wh-card2"
                     :class="{ active: agentStore.currentAgent?.id === a.id }"
                     @click="startChatWithAgent(a.id)"
                     @mouseenter="hoveredSkill = a" @mouseleave="hoveredSkill = null">
                  <div class="ws-wh-card2-head">
                    <span class="ws-wh-card2-name">{{ a.name }}</span>
                    <span v-if="a.category" class="ws-wh-card2-cat">{{ SKILL_CATEGORIES.find(c => c.id === a.category)?.name }}</span>
                    <span class="ws-wh-card2-count">{{ agentStore.getCallCount(a.id) || '' }}</span>
                    <button class="ws-wh-card2-menu" @click.stop="openCardMenu($event, a, 'preset')">
                      <span class="mso">more_horiz</span>
                    </button>
                  </div>
                  <div v-if="a.oneLineDesc || a.description" class="ws-wh-card2-desc">{{ a.oneLineDesc || a.description }}</div>
                  <div class="ws-wh-card2-tags" v-if="a.triggers?.length">
                    <span v-for="t in a.triggers.slice(0, 4)" :key="t" class="ws-wh-tag">{{ t }}</span>
                  </div>
                  <button class="ws-wh-card2-action add-my" @click.stop="agentStore.moveToMy(a.id); refreshWarehouse()">
                    <span class="mso" style="font-size:13px">arrow_upward</span> 添加到我的Skill
                  </button>
                </div>
                <div v-if="sortedPresetSkills.length === 0" class="ws-wh-empty2">所有Skill已添加到我的Skill</div>
              </div>
            </div>
          </div>

          <!-- 卡片三点菜单 -->
          <Teleport to="body">
            <div v-if="cardMenu.show" class="ws-card-menu-overlay" @click="cardMenu.show = false">
              <div class="ws-card-menu" :style="{ top: cardMenu.y + 'px', left: cardMenu.x + 'px' }">
                <button
                  v-for="item in SKILL_WAREHOUSE_MENU_ITEMS"
                  :key="item.action"
                  class="ws-card-menu-item"
                  @click="handleSkillWarehouseMenu(item.action)"
                >
                  <span class="mso">{{ item.icon }}</span> {{ item.label }}
                </button>
              </div>
            </div>
          </Teleport>

          <!-- 悬停预览气泡 -->
          <div v-if="hoveredSkill" class="ws-wh-preview">
            <div class="ws-wh-preview-name">{{ hoveredSkill.name }}</div>
            <div class="ws-wh-preview-content">{{ hoveredSkill.skillContent?.slice(0, 300) }}{{ (hoveredSkill.skillContent?.length || 0) > 300 ? '...' : '' }}</div>
            <div v-if="hoveredSkill.triggers?.length" class="ws-wh-preview-triggers">
              触发词: {{ hoveredSkill.triggers.slice(0, 6).join(', ') }}
            </div>
          </div>
        </div>



        <!-- 工具仓库 -->
        <ToolWarehousePanel v-else-if="rightPanel === 'tools' && isMember" :is-member="isMember" />

        <!-- 长脑子 -->
        <BrainPanel v-else-if="rightPanel === 'brain' && isMember" :is-member="isMember" @close="rightPanel = ''" />
        <VaultWizard v-else-if="rightPanel === 'vaultCreate' && isMember" />

        <!-- 知识库仓库 — 两区布局（镜像Skill仓库） -->
        <div v-else-if="rightPanel === 'vaultWarehouse' && isMember" class="ws-warehouse">
          <div class="ws-warehouse-head">
            <h3>知识库仓库</h3>
            <div class="ws-wh-search-mini">
              <span class="mso" style="font-size:14px;color:var(--ink3)">search</span>
              <input v-model="vaultFilter" type="text" placeholder="搜索..." class="ws-wh-search-input" />
            </div>
          </div>

          <div class="ws-wh-scroll">
            <!-- 我的知识库区 -->
            <div class="ws-wh-section">
              <div class="ws-wh-section-title">我的知识库</div>
              <div class="ws-wh-list">
                <div v-for="v in sortedMyVaults" :key="v.id" class="ws-wh-card2"
                     :class="{ active: vaultStoreWH.activeVaultId === v.id }"
                     @click="selectVaultFromWarehouse(v.id)">
                  <div class="ws-wh-card2-head">
                    <span class="ws-wh-card2-name">
                      <span v-if="v.icon" class="mso" style="font-size:14px;margin-right:4px">{{ v.icon }}</span>
                      {{ v.name }}
                    </span>
                    <span class="ws-wh-card2-count">{{ v.callCount || '' }}</span>
                    <button class="ws-wh-card2-menu" @click.stop="openVaultCardMenu($event, v)">
                      <span class="mso">more_horiz</span>
                    </button>
                  </div>
                  <div class="ws-wh-card2-desc">{{ v.oneLineDesc || v.description || v.type }}</div>
                  <div class="ws-wh-card2-tags" v-if="v.keywords?.length">
                    <span v-for="k in v.keywords.slice(0, 4)" :key="k" class="ws-wh-tag">{{ k }}</span>
                  </div>
                </div>
                <div v-if="sortedMyVaults.length === 0" class="ws-wh-empty2">
                  还没有知识库，点击左侧「创建知识库」或从下方模板添加
                </div>
              </div>
            </div>

            <!-- 内置知识库模板区 -->
            <div class="ws-wh-section" v-if="availableTemplates.length > 0">
              <div class="ws-wh-section-title">内置模板</div>
              <div class="ws-wh-list">
                <div v-for="tpl in availableTemplates" :key="tpl.id" class="ws-wh-card2">
                  <div class="ws-wh-card2-head">
                    <span class="ws-wh-card2-name">
                      <span class="mso" style="font-size:14px;margin-right:4px">{{ tpl.icon }}</span>
                      {{ tpl.name }}
                    </span>
                  </div>
                  <div class="ws-wh-card2-desc">{{ tpl.oneLineDesc }}</div>
                  <div class="ws-wh-card2-tags">
                    <span v-for="k in tpl.keywords.slice(0, 4)" :key="k" class="ws-wh-tag">{{ k }}</span>
                  </div>
                  <button class="ws-wh-card2-action add-my" @click.stop="addTemplateVault(tpl)">
                    <span class="mso" style="font-size:13px">add</span> 添加到我的知识库
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- 知识库卡片三点菜单 -->
          <Teleport to="body">
            <div v-if="vaultCardMenu.show" class="ws-card-menu-overlay" @click="vaultCardMenu.show = false">
              <div class="ws-card-menu" :style="{ top: vaultCardMenu.y + 'px', left: vaultCardMenu.x + 'px' }">
                <button class="ws-card-menu-item" @click="editVaultField('name')">
                  <span class="mso">edit</span> 修改知识库名
                </button>
                <button class="ws-card-menu-item" @click="editVaultField('keywords')">
                  <span class="mso">label</span> 修改关键词
                </button>
                <button class="ws-card-menu-item" @click="editVaultField('oneLineDesc')">
                  <span class="mso">short_text</span> 修改一句话介绍
                </button>
                <button class="ws-card-menu-item" style="color:#dc2626" @click="deleteVaultFromWarehouse">
                  <span class="mso">delete</span> 删除知识库
                </button>
              </div>
            </div>
          </Teleport>
        </div>

        <!-- 编辑区 -->
        <EditorPanel v-else-if="rightPanel === 'editor' && isMember" />

        <!-- 创作面板 -->
        <CreationPanel v-else-if="rightPanel === 'creation' && creationEnabled" />

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

/* ─── Skill仓库 — 两区布局 ─── */
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

/* 新手帮助 */
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
  grid-auto-rows: 240px;
  align-items: stretch;
  align-content: start;
  gap: 12px;
  padding: 0 26px 20px;
}
.ws-help-card {
  min-height: 0;
  height: 240px;
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
  .ws-help-grid { grid-template-columns: 1fr; grid-auto-rows: 220px; padding: 0 18px 18px; }
  .ws-help-card { height: 220px; }
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

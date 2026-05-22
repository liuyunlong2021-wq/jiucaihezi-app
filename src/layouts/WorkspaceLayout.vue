<script setup lang="ts">
/**
 * WorkspaceLayout — 主布局壳
 *
 * 正确的 5 列布局:
 * ┌────┬──────────┬──────────┬──────────────┬──────────────────┐
 * │Rail│ FileTree  │ History  │  ChatPanel   │   右侧面板       │
 * │    │(我的搭子) │(对话记录)│ ★始终显示★  │ (Rail 切换内容)   │
 * │    │ 可隐藏    │ 可隐藏   │  不可隐藏    │   可隐藏          │
 * └────┴──────────┴──────────┴──────────────┴──────────────────┘
 */
import { ref, computed, onBeforeUnmount, onMounted, watch } from 'vue'
import ActivityRail from '@/components/rail/ActivityRail.vue'
import FileTreePanel from '@/components/filetree/FileTreePanel.vue'
import ChatPanel from '@/components/chat/ChatPanel.vue'
import SettingsPanel from '@/components/settings/SettingsPanel.vue'
import AgentEditDialog from '@/components/agents/AgentEditDialog.vue'
import AgentWizard from '@/components/agents/AgentWizard.vue'
import BrainPanel from '@/components/brain/BrainPanel.vue'
import VaultWizard from '@/components/vault/VaultWizard.vue'
import EvolutionDiff from '@/components/agents/EvolutionDiff.vue'
import EditorPanel from '@/components/editor/EditorPanel.vue'
import CreationPanel from '@/components/creation/CreationPanel.vue'
import ToolWarehousePanel from '@/components/tools/ToolWarehousePanel.vue'
import { useAgentStore } from '@/stores/agentStore'
import { useVaultStore } from '@/stores/vaultStore'
import { onEvent } from '@/utils/eventBus'
import type { SkillConfig, SkillCategory } from '@/types/skill'
import { SKILL_CATEGORIES } from '@/types/skill'
import { VAULT_TEMPLATES } from '@/data/vaultTemplates'
import type { VaultTemplate } from '@/data/vaultTemplates'
import type { Vault } from '@/stores/vaultStore'
import { feedbackSkillFromVault } from '@/composables/useSkillFeedback'

const agentStore = useAgentStore()
const vaultStoreWH = useVaultStore()

// ─── 移动端适配 ───
const isMobile = ref(false)
const mobilePanel = ref<'chat' | 'creation' | 'agents' | 'tools' | 'brain' | 'editor' | 'settings'>('chat')

function checkMobile() {
  isMobile.value = window.innerWidth <= 768
}

// ─── Col 5 当前面板 ───
const rightPanel = ref<string>('creation')
const showAgentEditor = ref(false)
const showEvolution = ref(false)
const evolutionSkill = ref<SkillConfig | null>(null)

// 监听全局面板切换事件（如 MessageBubble 导入编辑区）
const offSwitchPanel = onEvent('switch-panel', (panel: unknown) => {
  if (typeof panel === 'string') {
    rightPanel.value = panel
  }
})

const offShowHistoryList = onEvent('show-history-list', () => {
  isFileTreeCollapsed.value = false
})

const offToggleFileTree = onEvent('toggle-file-tree', () => {
  isFileTreeCollapsed.value = !isFileTreeCollapsed.value
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  offSwitchPanel()
  offShowHistoryList()
  offToggleFileTree()
  onResizeEnd()
})

// Col 2 / Col 5 隐藏
const isFileTreeCollapsed = ref(false)  // 默认显示
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

  const hasFileTree = !isFileTreeCollapsed.value
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

watch([isFileTreeCollapsed, isRightPanelCollapsed], () => {
  applyDefaultDesktopWidths()
})

function fitDesktopWidthsToViewport() {
  if (isMobile.value) return
  const available = getAvailableDesktopWidth()
  if (available <= 0) return

  const hasFileTree = !isFileTreeCollapsed.value
  const hasRightPanel = !isRightPanelCollapsed.value
  const fileW = hasFileTree ? fileTreeWidth.value : 0
  const rightW = hasRightPanel ? rightPanelWidth.value : 0
  const used = fileW + chatWidth.value + rightW
  const gap = available - used
  if (Math.abs(gap) < 2) return

  if (gap > 0) {
    if (hasRightPanel) {
      rightPanelWidth.value += gap
    } else {
      chatWidth.value += gap
    }
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

function openEvolution(skill: SkillConfig) {
  evolutionSkill.value = skill
  showEvolution.value = true
}

function onRailSwitch(mode: string) {
  if (mode === 'files') {
    isFileTreeCollapsed.value = !isFileTreeCollapsed.value
    return
  }
  if (rightPanel.value === mode) {
    rightPanel.value = ''
  } else {
    rightPanel.value = mode
  }
}

// ─── 搭子仓库：搜索 + 分组 + 分类筛选 + 预览 + 右键菜单 ───
const agentFilter = ref('')
const categoryFilter = ref<string>('') // 空 = 全部
const presetCollapsed = ref(false)
const customCollapsed = ref(false)
const editAgent = ref<SkillConfig | null>(null)
const hoveredSkill = ref<SkillConfig | null>(null) // 悬停预览

// 分组 + 过滤
const filteredPresets = computed(() => {
  const q = agentFilter.value.toLowerCase()
  return agentStore.PRESETS.filter(a =>
    !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
  )
})
const filteredCustom = computed(() => {
  const q = agentFilter.value.toLowerCase()
  return agentStore.agents
    .filter(a => !agentStore.PRESETS.some(p => p.id === a.id))
    .filter(a => !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q))
})

// 新仓库面板：我的搭子 + 内置搭子（带搜索过滤和排序）
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

function openCardMenu(e: MouseEvent, skill: SkillConfig, zone: 'my' | 'preset') {
  e.stopPropagation()
  cardMenu.value = { show: true, x: e.clientX, y: e.clientY, skill, zone }
}

function editCardField(field: 'name' | 'triggers' | 'oneLineDesc') {
  const skill = cardMenu.value.skill
  cardMenu.value.show = false
  if (!skill) return
  const labels: Record<string, string> = { name: '搭子名', triggers: '命中关键词（逗号分隔）', oneLineDesc: '一句话介绍' }
  const current = field === 'triggers' ? (skill.triggers || []).join(', ') : (skill[field] || '')
  const newVal = prompt(labels[field], current)
  if (newVal === null) return
  if (field === 'triggers') {
    agentStore.updateSkill(skill.id, { triggers: newVal.split(/[,，]/).map(s => s.trim()).filter(Boolean) })
  } else {
    agentStore.updateSkill(skill.id, { [field]: newVal.trim() })
  }
}

function startChatWithAgent(agentId: string) {
  agentStore.selectAgent(agentId)
  if (agentStore.superpowerEnabled) agentStore.toggleSuperpower()
  rightPanel.value = ''
}

// ─── 用知识库反哺搭子 ───
const feedbackLoading = ref(false)
const feedbackResult = ref<{ skillName: string; changeSummary: string; newContent: string; skillId: string } | null>(null)

async function runSkillFeedback() {
  const skill = cardMenu.value.skill
  cardMenu.value.show = false
  if (!skill) return
  const vaultId = vaultStoreWH.activeVaultId
  if (!vaultId) {
    alert('请先绑定知识库')
    return
  }
  feedbackLoading.value = true
  try {
    const result = await feedbackSkillFromVault(skill, vaultId)
    if (result.suggestions.length === 0) {
      alert('知识库中没有可用于反哺的内容')
      feedbackLoading.value = false
      return
    }
    feedbackResult.value = {
      skillName: skill.name,
      changeSummary: result.changeSummary,
      newContent: result.newSkillContent,
      skillId: skill.id,
    }
  } catch (e: any) {
    alert('反哺失败: ' + (e?.message || '请重试'))
  }
  feedbackLoading.value = false
}

function applyFeedback() {
  if (!feedbackResult.value) return
  agentStore.updateSkill(feedbackResult.value.skillId, {
    skillContent: feedbackResult.value.newContent,
    version: (agentStore.agents.find(a => a.id === feedbackResult.value!.skillId)?.version || 1) + 1,
  })
  feedbackResult.value = null
}

function dismissFeedback() {
  feedbackResult.value = null
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
  vaultCardMenu.value = { show: true, x: e.clientX, y: e.clientY, vault }
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

function deleteVaultFromWarehouse() {
  const vault = vaultCardMenu.value.vault
  vaultCardMenu.value.show = false
  if (!vault) return
  if (!confirm(`确定删除知识库「${vault.name}」？此操作不可撤销。`)) return
  vaultStoreWH.deleteVault(vault.id)
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

// ─── 右键菜单 ───
const contextMenu = ref({ show: false, x: 0, y: 0, agent: null as SkillConfig | null, isPreset: false })

function openContextMenu(e: MouseEvent, a: any) {
  const skill = agentStore.agents.find(s => s.id === a.id)
  contextMenu.value = {
    show: true,
    x: e.clientX,
    y: e.clientY,
    agent: skill || null,
    isPreset: agentStore.PRESETS.some(p => p.id === a.id),
  }
}
function editContextAgent() {
  editAgent.value = contextMenu.value.agent
  contextMenu.value.show = false
  showAgentEditor.value = true
}
function aiRewriteContextAgent() {
  editAgent.value = contextMenu.value.agent
  contextMenu.value.show = false
  showAgentEditor.value = true
  // AgentEditDialog 会自动进入编辑模式
}
function exportContextAgent() {
  const a = contextMenu.value.agent
  contextMenu.value.show = false
  if (!a) return
  const blob = new Blob([JSON.stringify(a, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${a.name}.skill.json`
  link.click()
  URL.revokeObjectURL(url)
}
function deleteContextAgent() {
  const a = contextMenu.value.agent
  contextMenu.value.show = false
  if (!a) return
  if (!confirm(`确定删除搭子「${a.name}」？`)) return
  agentStore.deleteAgent(a.id)
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
  resizeStartFileTreeW = fileTreeWidth.value
  resizeStartChatW = chatWidth.value
  resizeStartRightW = rightPanelWidth.value
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
      <button :class="{ active: mobilePanel === 'creation' }" @click="mobilePanel = 'creation'">
        <span class="mso">photo_camera</span>
      </button>
      <button :class="{ active: mobilePanel === 'agents' }" @click="mobilePanel = 'agents'">
        <span class="mso">deployed_code_account</span>
      </button>
      <button :class="{ active: mobilePanel === 'tools' }" @click="mobilePanel = 'tools'">
        <span class="mso">construction</span>
      </button>
      <button :class="{ active: mobilePanel === 'brain' }" @click="mobilePanel = 'brain'">
        <span class="mso">psychology</span>
      </button>
      <button :class="{ active: mobilePanel === 'editor' }" @click="mobilePanel = 'editor'">
        <span class="mso">edit_note</span>
      </button>
      <div class="ws-mobile-rail-spacer"></div>
      <button :class="{ active: mobilePanel === 'settings' }" @click="mobilePanel = 'settings'">
        <span class="mso">settings</span>
      </button>
    </div>

    <!-- 全屏内容区 -->
    <div class="ws-mobile-body">
      <ChatPanel v-if="mobilePanel === 'chat'" />
      <CreationPanel v-else-if="mobilePanel === 'creation'" />
      <BrainPanel v-else-if="mobilePanel === 'brain'" />
      <EditorPanel v-else-if="mobilePanel === 'editor'" />
      <ToolWarehousePanel v-else-if="mobilePanel === 'tools'" />
      <div v-else-if="mobilePanel === 'agents'" class="ws-mobile-panel">
        <div class="ws-warehouse">
          <div class="ws-warehouse-head">
            <h3>搭子仓库</h3>
            <div class="ws-wh-search-mini">
              <span class="mso" style="font-size:14px;color:var(--ink3)">search</span>
              <input v-model="agentFilter" type="text" placeholder="搜索..." class="ws-wh-search-input" />
            </div>
          </div>
          <div class="ws-wh-scroll">
            <div class="ws-wh-section">
              <div class="ws-wh-section-title">我的搭子</div>
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
                <div v-if="sortedMySkills.length === 0" class="ws-wh-empty2">暂无搭子</div>
              </div>
            </div>
            <div class="ws-wh-section">
              <div class="ws-wh-section-title">内置搭子</div>
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

    <!-- Dialogs (mobile) -->
    <AgentEditDialog :visible="showAgentEditor" :editAgent="editAgent" @close="showAgentEditor = false; editAgent = null" />
  </div>

  <!-- ═══ 桌面端布局（原有） ═══ -->
  <div v-else class="ws-root" :class="{ 'is-resizing': isResizing }">
    <!-- Col 1: Activity Rail -->
    <ActivityRail :active="rightPanel" @switch="onRailSwitch" />

    <!-- Col 2: FileTree — 我的搭子（可隐藏） -->
    <div class="ws-col ws-filetree" :class="{ collapsed: isFileTreeCollapsed }"
         :style="{ width: isFileTreeCollapsed ? '0px' : fileTreeWidth + 'px' }">
      <FileTreePanel v-show="!isFileTreeCollapsed" />
      <div class="ws-resize-handle" @pointerdown.prevent="onResizeStart($event, 'filetree-chat')" />
    </div>



    <!-- Col 4: ChatPanel — ★ 始终显示 ★ -->
    <div class="ws-col ws-chat" :style="{ width: chatWidth + 'px' }">
      <ChatPanel />
      <div v-if="!isRightPanelCollapsed" class="ws-resize-handle" @pointerdown.prevent="onResizeStart($event, 'chat-right')" />
    </div>

    <!-- Col 5: 右侧面板 — Rail 切换（可隐藏） -->
    <div class="ws-col ws-right" :class="{ collapsed: isRightPanelCollapsed }"
         :style="{ width: isRightPanelCollapsed ? '0px' : rightPanelWidth + 'px' }">
      <div v-if="!isRightPanelCollapsed" class="ws-right-inner">

        <!-- 创建搭子 → Col 5 -->
        <AgentWizard v-if="rightPanel === 'create'" @close="rightPanel = ''" />

        <!-- 搭子仓库 — 两区布局 + 分类筛选 + 悬停预览 -->
        <div v-else-if="rightPanel === 'agents'" class="ws-warehouse">
          <div class="ws-warehouse-head">
            <h3>搭子仓库</h3>
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
            <!-- 我的搭子区 -->
            <div class="ws-wh-section">
              <div class="ws-wh-section-title">我的搭子</div>
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
                    <span class="mso" style="font-size:13px">arrow_downward</span> 放入内置搭子
                  </button>
                </div>
                <div v-if="sortedMySkills.length === 0" class="ws-wh-empty2">从下方内置搭子中添加</div>
              </div>
            </div>

            <!-- 内置搭子区 -->
            <div class="ws-wh-section">
              <div class="ws-wh-section-title">
                <span>内置搭子</span>
                <div class="ws-wh-preset-toggle" :class="{ on: agentStore.presetEnabled }" @click="agentStore.togglePresetEnabled()">
                  <div class="ws-wh-preset-toggle-dot"></div>
                </div>
              </div>
              <div class="ws-wh-preset-hint">{{ agentStore.presetEnabled ? '参与自动搭子路由' : '不参与自动路由' }}</div>
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
                    <span class="mso" style="font-size:13px">arrow_upward</span> 添加到我的搭子
                  </button>
                </div>
                <div v-if="sortedPresetSkills.length === 0" class="ws-wh-empty2">所有搭子已添加到我的搭子</div>
              </div>
            </div>
          </div>

          <!-- 卡片三点菜单 -->
          <Teleport to="body">
            <div v-if="cardMenu.show" class="ws-card-menu-overlay" @click="cardMenu.show = false">
              <div class="ws-card-menu" :style="{ top: cardMenu.y + 'px', left: cardMenu.x + 'px' }">
                <button class="ws-card-menu-item" @click="editCardField('name')">
                  <span class="mso">edit</span> 修改搭子名
                </button>
                <button class="ws-card-menu-item" @click="editCardField('triggers')">
                  <span class="mso">label</span> 修改命中关键词
                </button>
                <button class="ws-card-menu-item" @click="editCardField('oneLineDesc')">
                  <span class="mso">short_text</span> 修改一句话介绍
                </button>
                <div style="height:1px;background:var(--line);margin:4px 0"></div>
                <button class="ws-card-menu-item" @click="runSkillFeedback" :disabled="feedbackLoading">
                  <span class="mso">upgrade</span> {{ feedbackLoading ? '反哺中...' : '用知识库反哺搭子' }}
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

          <!-- 反哺结果确认弹窗 -->
          <Teleport to="body">
            <div v-if="feedbackResult" class="ws-feedback-overlay" @click.self="dismissFeedback">
              <div class="ws-feedback-dialog">
                <h4>反哺结果：{{ feedbackResult.skillName }}</h4>
                <p class="ws-feedback-summary">{{ feedbackResult.changeSummary }}</p>
                <div class="ws-feedback-actions">
                  <button class="ws-feedback-btn apply" @click="applyFeedback">采用升级</button>
                  <button class="ws-feedback-btn" @click="dismissFeedback">放弃</button>
                </div>
              </div>
            </div>
          </Teleport>
        </div>



        <!-- 工具仓库 -->
        <ToolWarehousePanel v-else-if="rightPanel === 'tools'" />

        <!-- 长脑子 -->
        <BrainPanel v-else-if="rightPanel === 'brain'" @close="rightPanel = ''" />
        <VaultWizard v-else-if="rightPanel === 'vaultCreate'" />

        <!-- 知识库仓库 — 两区布局（镜像搭子仓库） -->
        <div v-else-if="rightPanel === 'vaultWarehouse'" class="ws-warehouse">
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
        <EditorPanel v-else-if="rightPanel === 'editor'" />

        <!-- 创作面板 -->
        <CreationPanel v-else-if="rightPanel === 'creation'" />

        <!-- 设置 -->
        <SettingsPanel v-else-if="rightPanel === 'settings'" />

      </div>
    </div>

    <!-- 右键菜单（Teleport 到 body，不打断 v-if 链） -->
    <Teleport to="body">
      <div v-if="contextMenu.show" class="ws-ctx-overlay" @click="contextMenu.show = false">
        <div class="ws-ctx-menu" :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }">
          <button class="ws-ctx-item" @click="editContextAgent">
            <span class="mso">edit</span> 编辑
          </button>
          <button class="ws-ctx-item" @click="aiRewriteContextAgent">
            <span class="mso">auto_fix</span> AI 重写
          </button>
          <button class="ws-ctx-item" @click="exportContextAgent">
            <span class="mso">download</span> 导出 JSON
          </button>
          <button v-if="!contextMenu.isPreset" class="ws-ctx-item ws-ctx-danger" @click="deleteContextAgent">
            <span class="mso">delete</span> 删除
          </button>
        </div>
      </div>
    </Teleport>

    <!-- Dialogs -->
    <AgentEditDialog :visible="showAgentEditor" :editAgent="editAgent" @close="showAgentEditor = false; editAgent = null" />
    <Teleport to="body">
      <div v-if="showEvolution && evolutionSkill" class="ws-evo-overlay" @click.self="showEvolution = false">
        <div class="ws-evo-dialog">
          <EvolutionDiff :skill="evolutionSkill" @close="showEvolution = false" />
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
.ws-chat { min-width: 420px; border-right: 1px solid var(--border); display: flex; flex-direction: column; }
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

/* ─── 搭子仓库 — 两区布局 ─── */
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
.ws-card-menu-overlay { position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,.2); }
.ws-card-menu {
  position: fixed; min-width: 180px; padding: 8px;
  background: var(--paper); border: 1px solid var(--border);
  border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.3);
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

/* ─── 右键菜单 ─── */
.ws-ctx-overlay { position: fixed; inset: 0; z-index: 9999; }
.ws-ctx-menu {
  position: fixed; min-width: 150px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 4px; box-shadow: 0 8px 24px rgba(0,0,0,.15);
}
.ws-ctx-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 8px 12px; border: none; border-radius: 6px;
  background: none; font-size: 13px; color: var(--ink1);
  cursor: pointer; font-family: inherit; transition: background .1s;
}
.ws-ctx-item .mso { font-size: 16px; color: var(--ink3); }
.ws-ctx-item:hover { background: var(--bg); }
.ws-ctx-danger { color: #c0392b; }
.ws-ctx-danger .mso { color: #c0392b; }

/* Evolution overlay */
.ws-evo-overlay {
  position: fixed; inset: 0; z-index: 9998;
  background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center;
}
.ws-evo-dialog {
  width: 700px; max-width: 95vw; max-height: 85vh;
  border-radius: 16px; overflow: hidden; background: var(--paper);
  box-shadow: 0 8px 40px rgba(0,0,0,.2);
}

/* 反哺结果弹窗 */
.ws-feedback-overlay {
  position: fixed; inset: 0; z-index: 9998;
  background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center;
}
.ws-feedback-dialog {
  width: 400px; max-width: 90vw; padding: 24px;
  border-radius: 16px; background: var(--paper);
  box-shadow: 0 8px 40px rgba(0,0,0,.2);
}
.ws-feedback-dialog h4 { font-size: 16px; font-weight: 700; color: var(--ink); margin: 0 0 8px; }
.ws-feedback-summary { font-size: 13px; color: var(--ink2); line-height: 1.6; margin: 0 0 16px; }
.ws-feedback-actions { display: flex; gap: 8px; }
.ws-feedback-btn {
  flex: 1; padding: 10px; border-radius: 10px; font-size: 13px; font-weight: 700;
  cursor: pointer; font-family: inherit; border: 1px solid var(--line);
  background: var(--surface-alt); color: var(--ink2); transition: all .15s;
}
.ws-feedback-btn.apply { background: var(--olive); color: #fff; border-color: var(--olive); }
.ws-feedback-btn.apply:hover { filter: brightness(1.1); }

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

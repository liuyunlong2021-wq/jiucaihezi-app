<script setup lang="ts">
/**
 * BrainPanel.vue — 长脑子面板（简化版）
 * 两个核心按钮：整理 + 反哺
 */
import { ref } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import { useVaultStore } from '@/stores/vaultStore'
import { useFileStore } from '@/composables/useFileStore'
import { useVaultCompiler } from '@/composables/useVaultCompiler'
import { resolveApiConfig, buildHeaders } from '@/utils/api'
import { emitEvent } from '@/utils/eventBus'
import { getAll } from '@/utils/idb'
import { collectVaultConversations } from '@/utils/vaultOrganize'
import { isPendingWikiCandidate } from '@/utils/vaultCandidate'

const props = withDefaults(defineProps<{ isMember?: boolean }>(), { isMember: true })
const emit = defineEmits<{ (e: 'close'): void }>()
const store = useAgentStore()
const vaultStore = useVaultStore()
const fileStore = useFileStore()
const { compileVault } = useVaultCompiler()

function requireMemberAction(): boolean {
  if (props.isMember) return true
  error.value = '请登录后使用此功能'
  progress.value = ''
  return false
}

// ─── 添加资料 ───
const showAddMaterial = ref(false)
const materialText = ref('')
const materialName = ref('')
const addingMaterial = ref(false)

async function addTextMaterial() {
  if (!requireMemberAction()) return
  const text = materialText.value.trim()
  if (!text) return
  const vaultId = vaultStore.activeVaultId
  if (!vaultId) { error.value = '请先绑定知识库'; return }

  addingMaterial.value = true
  try {
    const rawFolder = await fileStore.findVaultRootFolder(vaultId, 'raw')
    const name = materialName.value.trim() || `资料_${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`

    await fileStore.addFile({
      category: 'knowledge',
      name,
      content: text,
      mimeType: 'text/plain',
      size: new TextEncoder().encode(text).length,
      vaultId,
      folderId: rawFolder?.id,
      kind: 'raw',
      metadata: { vaultFolder: 'raw', manualAdd: true },
    })

    // 更新 vault stats
    const vault = vaultStore.vaults.find(v => v.id === vaultId)
    if (vault?.stats) vault.stats.rawCount++
    await vaultStore.save()

    materialText.value = ''
    materialName.value = ''
    progress.value = `已添加资料「${name}」到知识库`
    showAddMaterial.value = false
  } catch (e: any) {
    error.value = e.message || '添加失败'
  } finally {
    addingMaterial.value = false
  }
}

async function handleFileUpload(event: Event) {
  if (!requireMemberAction()) return
  const input = event.target as HTMLInputElement
  const files = input.files
  if (!files || files.length === 0) return

  const vaultId = vaultStore.activeVaultId
  if (!vaultId) { error.value = '请先绑定知识库'; return }

  addingMaterial.value = true
  let count = 0
  try {
    const rawFolder = await fileStore.findVaultRootFolder(vaultId, 'raw')

    for (const file of Array.from(files)) {
      const text = await file.text()
      if (!text.trim()) continue

      await fileStore.addFile({
        category: 'knowledge',
        name: file.name.replace(/\.(txt|md|markdown|text)$/i, ''),
        content: text,
        mimeType: file.type || 'text/plain',
        size: file.size,
        vaultId,
        folderId: rawFolder?.id,
        kind: 'raw',
        metadata: { vaultFolder: 'raw', manualAdd: true, originalName: file.name },
      })
      count++
    }

    const vault = vaultStore.vaults.find(v => v.id === vaultId)
    if (vault?.stats) vault.stats.rawCount += count
    await vaultStore.save()

    progress.value = `已上传 ${count} 个文件到知识库`
    showAddMaterial.value = false
  } catch (e: any) {
    error.value = e.message || '上传失败'
  } finally {
    addingMaterial.value = false
    input.value = ''
  }
}

type Phase = 'idle' | 'organizing' | 'compiling' | 'feedback' | 'done'
const phase = ref<Phase>('idle')
const progress = ref('')
const error = ref('')

// 反哺建议
interface Suggestion {
  skillId: string
  skillName: string
  vaultId: string
  vaultName: string
  type: string
  content: string
  reason: string
  selected: boolean
}
const suggestions = ref<Suggestion[]>([])
const allSelected = ref(false)

const isBusy = () => phase.value === 'organizing' || phase.value === 'compiling' || phase.value === 'feedback'

// ─── 知识图谱可视化 ───
const graphHtml = ref('')
const showGraph = ref(false)

async function buildKnowledgeGraph() {
  if (!requireMemberAction()) return
  progress.value = '构建知识图谱...'
  error.value = ''
  try {
    await vaultStore.loadAll()
    const vaultId = vaultStore.activeVaultId
    if (!vaultId) { progress.value = '请先绑定知识库'; return }

    const knowledge = (await fileStore.loadByCategory('knowledge', vaultId))
      .filter(k => !isPendingWikiCandidate(k))
    const entities = knowledge.filter(k => k.kind === 'entity' || k.metadata?.type === 'entity')
    const relations = knowledge.filter(k => k.kind === 'relation' || k.metadata?.type === 'relation')
    const pages = knowledge.filter(k => k.kind === 'page' || k.kind === 'raw')

    // Build vis.js graph data
    const nodeMap = new Map<string, { id: string; label: string; group: string }>()
    const edges: Array<{ from: string; to: string; label: string }> = []

    // Add pages as nodes
    for (const p of pages) {
      const id = p.id || p.name
      nodeMap.set(id, { id, label: p.name?.slice(0, 30) || '未命名', group: p.kind || 'page' })
    }

    // Add entities as nodes
    for (const e of entities) {
      const id = e.id || e.name
      nodeMap.set(id, { id, label: e.name?.slice(0, 30) || '实体', group: e.topic || 'entity' })
    }

    // Add relations as edges
    for (const r of relations) {
      const meta = (r.metadata || {}) as Record<string, string>
      const from = meta.source || meta.from || r.name?.split('→')[0]?.trim()
      const to = meta.target || meta.to || r.name?.split('→')[1]?.trim()
      const label = meta.relation || r.content?.slice(0, 20) || ''
      if (from && to) {
        // Ensure nodes exist
        if (!nodeMap.has(from)) nodeMap.set(from, { id: from, label: from.slice(0, 30), group: 'auto' })
        if (!nodeMap.has(to)) nodeMap.set(to, { id: to, label: to.slice(0, 30), group: 'auto' })
        edges.push({ from, to, label })
      }
    }

    // If no entities/relations, build from pages co-occurrence
    if (edges.length === 0 && pages.length > 1) {
      // Create edges between pages with shared topics
      const topicMap = new Map<string, string[]>()
      for (const p of pages) {
        const topic = p.topic || 'general'
        if (!topicMap.has(topic)) topicMap.set(topic, [])
        topicMap.get(topic)!.push(p.id || p.name)
      }
      for (const [, ids] of topicMap) {
        for (let i = 0; i < ids.length - 1 && i < 5; i++) {
          edges.push({ from: ids[i], to: ids[i + 1], label: '相关' })
        }
      }
    }

    if (nodeMap.size === 0) {
      progress.value = '知识库为空，请先整理'
      return
    }

    const nodes = Array.from(nodeMap.values())
    const colors = ['#6B8E23', '#2196f3', '#e91e63', '#ff9800', '#9c27b0', '#009688', '#795548', '#607d8b']
    const groupSet = [...new Set(nodes.map(n => n.group))]

    const nodePositions = nodes.map((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(nodes.length, 1)
      const radius = Math.min(320, Math.max(120, 42 * nodes.length))
      return {
        ...node,
        x: Math.round(450 + Math.cos(angle) * radius),
        y: Math.round(320 + Math.sin(angle) * radius),
        color: colors[groupSet.indexOf(node.group) % colors.length],
      }
    })
    const positionMap = new Map(nodePositions.map(node => [node.id, node]))
    const escapeHtml = (value: string) => String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
    const edgeSvg = edges.map(edge => {
      const from = positionMap.get(edge.from)
      const to = positionMap.get(edge.to)
      if (!from || !to) return ''
      const mx = Math.round((from.x + to.x) / 2)
      const my = Math.round((from.y + to.y) / 2)
      return '<line x1="' + from.x + '" y1="' + from.y + '" x2="' + to.x + '" y2="' + to.y + '" stroke="#9aa0a6" stroke-width="1.5" marker-end="url(#arrow)"/><text x="' + mx + '" y="' + (my - 4) + '" text-anchor="middle" font-size="11" fill="#667085">' + escapeHtml(edge.label || '相关') + '</text>'
    }).join('\n')
    const nodeSvg = nodePositions.map(node => (
      '<g><circle cx="' + node.x + '" cy="' + node.y + '" r="18" fill="' + node.color + '33" stroke="' + node.color + '" stroke-width="2"/>' +
      '<text x="' + node.x + '" y="' + (node.y + 34) + '" text-anchor="middle" font-size="12" fill="#1f2937">' + escapeHtml(node.label) + '</text>' +
      '<title>' + escapeHtml(node.label + ' · ' + node.group) + '</title></g>'
    )).join('\n')

    graphHtml.value = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>知识图谱 — ' + escapeHtml(vaultStore.activeVault?.name || '') + '</title>' +
      '<style>body{margin:0;font-family:Inter,system-ui,sans-serif;background:#f8fafc;color:#1f2937}#info{position:fixed;top:12px;left:12px;background:rgba(255,255,255,.95);padding:12px 16px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.1);font-size:13px;z-index:10}#info h3{margin:0 0 4px;font-size:15px;color:#333}#info p{margin:2px 0;color:#666;font-size:12px}svg{width:100vw;height:100vh;display:block}</style></head><body>' +
      '<div id="info"><h3>' + escapeHtml(vaultStore.activeVault?.name || '知识图谱') + '</h3><p>' + nodes.length + ' 个节点 · ' + edges.length + ' 条关系 · 本地 SVG</p></div>' +
      '<svg viewBox="0 0 900 640" role="img" aria-label="知识图谱"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#9aa0a6"/></marker></defs>' + edgeSvg + nodeSvg + '</svg>' +
      '</body></html>'

    showGraph.value = true
    progress.value = `知识图谱已生成：${nodes.length} 个节点，${edges.length} 条关系`
  } catch (e: any) {
    error.value = e.message || '构建图谱失败'
  }
}

function openGraphInNewTab() {
  const blob = new Blob([graphHtml.value], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
}

function closeGraph() {
  showGraph.value = false
}

// ─── 整理并编译：当前 Vault 对话 → raw → wiki/graph ───
async function runOrganizeAndCompile() {
  if (!requireMemberAction()) return
  phase.value = 'organizing'
  progress.value = '扫描对话记录...'
  error.value = ''

  try {
    await vaultStore.loadAll()
    const activeVaultId = vaultStore.activeVaultId
    if (!activeVaultId) {
      progress.value = '请先在对话顶部绑定知识库'
      phase.value = 'done'
      return
    }
    const activeVaultName = vaultStore.activeVault?.name || '当前知识库'

    // messages store 中每条记录是 { id: sessionId, items: ChatMessage[] }
    const conversations = await getAll('conversations') as Array<{ id: string; agentId?: string; vaultId?: string | null; title?: string }>
    const records = await getAll('messages') as Array<{ id: string; items: Array<{ id?: string; role: string; content: string; agentId?: string; agentName?: string }> }>
    if (!records || records.length === 0) {
      progress.value = '没有对话记录'
      phase.value = 'done'
      return
    }

    const { groups, skippedSessionIds } = collectVaultConversations(conversations, records)
    const activeGroup = groups.find(group => group.vaultId === activeVaultId)
    if (!activeGroup) {
      progress.value = skippedSessionIds.length > 0
        ? `扫描了 ${records.length} 个会话，${activeVaultName} 暂无可整理对话`
        : `${activeVaultName} 暂无可整理对话`
      phase.value = 'done'
      return
    }
    const existingKnowledge = await fileStore.loadByCategory('knowledge', activeVaultId)
    const ingestedMessageIds = new Set(
      existingKnowledge.flatMap(item => item.sourceMessageIds || [])
    )
    const pairsToProcess = activeGroup.pairs.filter(pair =>
      !pair.messageIds.some(id => ingestedMessageIds.has(id))
    )

    if (pairsToProcess.length === 0) {
      phase.value = 'compiling'
      progress.value = `${activeVaultName} 的对话已自动回流，正在编译现有原料...`
      const result = await compileVault(activeVaultId)
      progress.value = result.rawCount > 0
        ? `编译完成：处理 ${result.rawCount} 条原始记录，生成 ${result.pageCount} 页、${result.entityCount} 个实体、${result.relationCount} 条关系`
        : `${activeVaultName} 暂无新内容需要编译`
      phase.value = 'done'
      return
    }

    progress.value = `找到 ${activeVaultName} 的 ${pairsToProcess.length} 条未入库对话，开始提取知识...`

    let config: any = null
    try { config = await resolveApiConfig() } catch { /* 无 Gateway session */ }
    let totalExtracted = 0
    let apiErrors = 0

    for (const group of [activeGroup]) {
      const vault = vaultStore.vaults.find(v => v.id === group.vaultId)
      const vaultName = vault?.name || group.vaultId
      const recentPairs = pairsToProcess.slice(-20)
      const text = recentPairs.map(pair => pair.text).join('\n\n---\n\n')
      const sourceMessageIds = recentPairs.flatMap(pair => pair.messageIds)
      const sourceSessionIds = Array.from(new Set(recentPairs.map(pair => pair.sessionId)))
      if (text.length < 100) continue

      progress.value = `正在分析知识库: ${vaultName} (${group.pairs.length} 条对话)...`

      const addRawFallback = async () => {
        await fileStore.addKnowledge({
          name: `对话_${vaultName}`,
          content: text.slice(0, 4000),
          topic: vaultName,
          skillId: recentPairs.at(-1)?.agentId || 'general',
          vaultId: group.vaultId,
          kind: 'raw',
          sourceSessionId: sourceSessionIds.at(-1),
          sourceMessageIds,
          indexed: false,
          metadata: { sourceSessionIds },
        })
        totalExtracted++
      }

      // 如果没有 API 配置，直接用前端规则提取
      if (!config) {
        for (const pair of group.pairs.slice(-10)) {
          await fileStore.addKnowledge({
            name: `对话记录_${vaultName}`,
            content: pair.text,
            topic: vaultName,
            skillId: pair.agentId,
            vaultId: group.vaultId,
            kind: 'raw',
            sourceSessionId: pair.sessionId,
            sourceMessageIds: pair.messageIds,
            indexed: false,
          })
          totalExtracted++
        }
        continue
      }

      try {
        const res = await fetch(`${config.apiBase}/v1/chat/completions`, {
          method: 'POST',
          headers: buildHeaders(config),
          body: JSON.stringify({
            model: config.model || 'claude-sonnet-4-6',
            messages: [
              { role: 'system', content: ORGANIZE_PROMPT },
              { role: 'user', content: text.slice(0, 6000) },
            ],
            temperature: 0.3,
            max_tokens: 2000,
            stream: false,
          }),
        })

        if (!res.ok) {
          apiErrors++
          const errBody = await res.text().catch(() => '')
          progress.value = `API 错误 (${res.status}): ${errBody.slice(0, 100)}，已保存 ${vaultName} 原始记录...`
          await addRawFallback()
          continue
        }
        const data = await res.json()
        const content = data.choices?.[0]?.message?.content || ''

        if (!content) {
          progress.value = `${vaultName}: LLM 返回空内容，已保存原始记录...`
          await addRawFallback()
          continue
        }

        // 解析 JSON 数组（兼容 markdown code block 包裹）
        const cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '')
        const jsonMatch = cleaned.match(/\[[\s\S]*\]/)
        if (jsonMatch) {
          const entries = JSON.parse(jsonMatch[0])
          if (Array.isArray(entries)) {
            for (const entry of entries) {
              if (!entry.content && !entry.title) continue
              await fileStore.addKnowledge({
                name: entry.title || '知识点',
                content: entry.content || '',
                topic: entry.topic || vaultName,
                skillId: recentPairs.at(-1)?.agentId || 'general',
                vaultId: group.vaultId,
                kind: 'page',
                sourceSessionId: sourceSessionIds.at(-1),
                sourceMessageIds,
                indexed: true,
                metadata: {
                  type: entry.type,
                  confidence: entry.confidence,
                  sourceSessionIds,
                },
              })
              totalExtracted++
            }
          }
        } else {
          progress.value = `${vaultName}: LLM 返回非JSON格式，使用原始存储...`
          // fallback: 直接存原始对话
          await addRawFallback()
        }
      } catch (e: any) {
        apiErrors++
        // fallback: API 失败时直接存原始对话
        await addRawFallback()
        progress.value = `${vaultName}: API失败，已存储原始对话`
      }
    }

    phase.value = 'compiling'
    progress.value = totalExtracted > 0
      ? `整理完成，写入 ${totalExtracted} 条原料，正在编译 ${activeVaultName}...`
      : `没有提取到新知识，正在检查 ${activeVaultName} 是否有待编译原料...`

    const result = await compileVault(activeVaultId)
    progress.value = result.rawCount > 0
      ? `整理并编译完成：写入 ${totalExtracted} 条原料，生成 ${result.pageCount} 页、${result.entityCount} 个实体、${result.relationCount} 条关系${apiErrors > 0 ? `（${apiErrors} 个API错误已降级保存）` : ''}`
      : totalExtracted > 0
        ? `整理完成：写入 ${totalExtracted} 条知识，暂无待编译原料${apiErrors > 0 ? `（${apiErrors} 个API错误已降级保存）` : ''}`
        : `${activeVaultName} 暂无新内容需要编译`
    phase.value = 'done'
  } catch (e: any) {
    error.value = e.message || '整理失败'
    phase.value = 'done'
  }
}

// ─── 编译：保留为内部能力，UI 统一走 runOrganizeAndCompile ───
async function runCompile() {
  if (!requireMemberAction()) return
  phase.value = 'compiling'
  progress.value = '准备编译当前知识库...'
  error.value = ''

  try {
    await vaultStore.loadAll()
    const vaultId = vaultStore.activeVaultId
    if (!vaultId) {
      progress.value = '请先在对话顶部绑定知识库'
      phase.value = 'done'
      return
    }

    const vaultName = vaultStore.activeVault?.name || '当前知识库'
    progress.value = `正在编译 ${vaultName}...`
    const result = await compileVault(vaultId)
    progress.value = result.rawCount > 0
      ? `编译完成：处理 ${result.rawCount} 条原始记录，生成 ${result.pageCount} 页、${result.entityCount} 个实体、${result.relationCount} 条关系`
      : `${vaultName} 没有待编译的原始记录`
    phase.value = 'done'
  } catch (e: any) {
    error.value = e.message || '编译失败'
    phase.value = 'done'
  }
}

// ─── 反哺：用知识库升级我的Skill ───
async function runFeedback() {
  if (!requireMemberAction()) return
  phase.value = 'feedback'
  progress.value = '读取知识库...'
  error.value = ''
  suggestions.value = []

  try {
    await vaultStore.loadAll()
    const vaultId = vaultStore.activeVaultId
    if (!vaultId) {
      progress.value = '请先在对话顶部绑定知识库'
      phase.value = 'done'
      return
    }

    const currentVault = vaultStore.vaults.find(v => v.id === vaultId)
    const vaultName = currentVault?.name || '当前知识库'
    const knowledge = (await fileStore.loadByCategory('knowledge', vaultId))
      .filter(k => k.mimeType !== 'folder' && !isPendingWikiCandidate(k))
    if (knowledge.length === 0) {
      progress.value = `${vaultName} 为空，请先整理`
      phase.value = 'done'
      return
    }

    const mySkills = store.getMySkills()
    if (mySkills.length === 0) {
      progress.value = '没有Skill可升级'
      phase.value = 'done'
      return
    }

    const config = await resolveApiConfig()

    for (const skill of mySkills) {
      // 筛选相关知识：证据必须先限定在当前知识库内，再按Skill/主题辅助匹配。
      const related = knowledge.filter(k =>
        k.skillId === skill.id || k.topic === skill.name || k.topic === skill.id
      )
      if (related.length === 0) continue

      progress.value = `分析Skill: ${skill.name}...`

      const knowledgeText = related.slice(0, 15).map(k => `- [${k.name}] ${k.content}`).join('\n')

      const res = await fetch(`${config.apiBase}/v1/chat/completions`, {
        method: 'POST',
        headers: buildHeaders(config),
        body: JSON.stringify({
          model: config.model || 'claude-sonnet-4-6',
          messages: [
            { role: 'system', content: FEEDBACK_PROMPT },
            { role: 'user', content: `## 当前Skill\n名称: ${skill.name}\nSKILL.md:\n${skill.skillContent?.slice(0, 3000)}\n\n## 相关知识库内容\n${knowledgeText}` },
          ],
          temperature: 0.4,
          max_tokens: 2000,
          stream: false,
        }),
      })

      if (!res.ok) continue
      const data = await res.json()
      const content = data.choices?.[0]?.message?.content || ''

      try {
        const jsonMatch = content.match(/\[[\s\S]*\]/)
        if (jsonMatch) {
          const items = JSON.parse(jsonMatch[0])
          for (const item of items) {
            suggestions.value.push({
              skillId: skill.id,
              skillName: skill.name,
              vaultId,
              vaultName,
              type: item.type || 'rule',
              content: item.content || '',
              reason: item.reason || '',
              selected: false,
            })
          }
        }
      } catch {}
    }

    progress.value = suggestions.value.length > 0
      ? `生成了 ${suggestions.value.length} 条升级建议`
      : '没有找到可升级的内容'
    phase.value = 'done'
  } catch (e: any) {
    error.value = e.message || '反哺失败'
    phase.value = 'done'
  }
}

function toggleAllSuggestions() {
  allSelected.value = !allSelected.value
  suggestions.value.forEach(s => { s.selected = allSelected.value })
}

function applySelected() {
  if (!requireMemberAction()) return
  const selected = suggestions.value.filter(s => s.selected)
  if (selected.length === 0) return

  // 按Skill分组应用
  const grouped: Record<string, Suggestion[]> = {}
  for (const s of selected) {
    if (!grouped[s.skillId]) grouped[s.skillId] = []
    grouped[s.skillId].push(s)
  }

  for (const [skillId, items] of Object.entries(grouped)) {
    const skill = store.loadSkills().find(s => s.id === skillId)
    if (!skill) continue

    let newContent = skill.skillContent || ''
    for (const item of items) {
      if (item.type === 'rule') {
        newContent += `\n- ${item.content}`
      } else if (item.type === 'example') {
        newContent += `\n\n### 示例\n${item.content}`
      } else if (item.type === 'reference') {
        newContent += `\n- 参考: ${item.content}`
      } else {
        newContent += `\n- ${item.content}`
      }
    }

    store.updateSkill(skillId, {
      skillContent: newContent,
      version: (skill.version || 1) + 1,
    })
  }

  progress.value = `已应用 ${selected.length} 条升级到 ${Object.keys(grouped).length} 个Skill`
  suggestions.value = []
}

// ─── G2: 图谱查询 ───
const graphQuery = ref('')
const graphQueryResult = ref('')

async function queryGraph() {
  if (!requireMemberAction()) return
  if (!graphQuery.value.trim()) return
  const vaultId = vaultStore.activeVaultId
  if (!vaultId) { progress.value = '请先绑定知识库'; return }

  progress.value = '查询本地知识库...'
  try {
    const knowledge = (await fileStore.loadByCategory('knowledge', vaultId))
      .filter(k => !isPendingWikiCandidate(k))
    const q = graphQuery.value.toLowerCase()
    const matches = knowledge.filter(k =>
      k.name.toLowerCase().includes(q) || k.content.toLowerCase().includes(q)
    ).slice(0, 5)

    if (matches.length > 0) {
      graphQueryResult.value = matches.map(m =>
        `**${m.name}** (${m.kind || ''})\n${m.content.slice(0, 200)}`
      ).join('\n\n---\n\n')
    } else {
      graphQueryResult.value = '未找到相关结果'
    }
    progress.value = ''
  } catch (e: any) {
    graphQueryResult.value = '查询失败: ' + (e.message || e)
    progress.value = ''
  }
}

// ─── G3: 注入图谱上下文到对话 ───
function injectGraphToChat() {
  if (!requireMemberAction()) return
  if (!graphQueryResult.value) return
  emitEvent('reference-file', {
    name: `图谱查询: ${graphQuery.value}`,
    content: graphQueryResult.value,
  })
  progress.value = '已注入图谱上下文到对话'
}

// ─── Prompts ───
const ORGANIZE_PROMPT = `你是知识编译引擎（llm-wiki-skill）。从以下对话记录中提取可复用的结构化知识。

## 输出要求
输出一个JSON数组，每个知识点是一个对象：
[
  {
    "title": "知识点标题（一句话描述）",
    "content": "具体内容（规则/方法/示例/模式）",
    "topic": "所属Skill或主题",
    "type": "rule | reference | example | pattern",
    "confidence": "EXTRACTED | INFERRED"
  }
]

## 提取原则
- 只提取可复用的知识，忽略一次性对话
- 优先提取：规则约束、工作流模式、输出格式规范、常见错误修正
- 用 EXTRACTED 标记直接从对话中提取的，INFERRED 标记推断的
- 如果没有可提取的知识，返回空数组 []`

const FEEDBACK_PROMPT = `你是Skill进化引擎（Skill_Seekers）。基于知识库中积累的经验，为Skill提出具体的升级建议。

## 输出要求
输出JSON数组，每项是一条升级建议：
[
  {
    "type": "rule | reference | example | trigger | workflow",
    "content": "具体要添加/修改的内容",
    "reason": "为什么要做这个改动（基于哪条知识）"
  }
]

## 进化原则
- 只建议有知识库证据支持的改动
- 优先加强：规则约束（防止重复错误）、输出格式（提升一致性）、示例（增加覆盖）
- 不要删除现有有效规则
- 如果没有可建议的改动，返回空数组 []`
</script>

<template>
  <div class="bp">
    <div class="bp-head">
      <span class="mso" style="font-size:20px;color:var(--olive)">psychology</span>
      <span class="bp-title">长脑子</span>
      <button class="bp-close" @click="emit('close')"><span class="mso">close</span></button>
    </div>

    <!-- 整理按钮 -->
    <div class="bp-actions">
      <button class="bp-action-btn" :disabled="isBusy()" @click="runOrganizeAndCompile">
        <span class="mso">auto_stories</span>
        <div class="bp-action-info">
          <span class="bp-action-name">整理并编译</span>
          <span class="bp-action-desc">处理当前知识库：对话原料 → wiki 结构化知识</span>
        </div>
      </button>
      <button class="bp-action-btn" :disabled="isBusy()" @click="buildKnowledgeGraph">
        <span class="mso">hub</span>
        <div class="bp-action-info">
          <span class="bp-action-name">知识图谱</span>
          <span class="bp-action-desc">将知识库可视化为交互式关系网络图</span>
        </div>
      </button>
      <button class="bp-action-btn" :disabled="isBusy()" @click="runFeedback">
        <span class="mso">rocket_launch</span>
        <div class="bp-action-info">
          <span class="bp-action-name">反哺Skill</span>
          <span class="bp-action-desc">用知识库经验升级我的Skill</span>
        </div>
      </button>
      <button class="bp-action-btn" @click="showAddMaterial = !showAddMaterial">
        <span class="mso">note_add</span>
        <div class="bp-action-info">
          <span class="bp-action-name">添加资料</span>
          <span class="bp-action-desc">手动添加文本、上传文档到当前知识库</span>
        </div>
      </button>
    </div>

    <!-- 添加资料面板 -->
    <div v-if="showAddMaterial" class="bp-add-material">
      <div class="bp-am-head">
        <span class="bp-am-title">添加资料到「{{ vaultStore.activeVault?.name || '未选择知识库' }}」</span>
        <button class="bp-am-close" @click="showAddMaterial = false"><span class="mso">close</span></button>
      </div>
      <div v-if="!vaultStore.activeVaultId" class="bp-am-empty">请先在对话顶部绑定知识库</div>
      <template v-else>
        <input v-model="materialName" class="bp-am-name" placeholder="资料标题（可选）" />
        <textarea v-model="materialText" class="bp-am-textarea" placeholder="粘贴文本内容..." rows="6"></textarea>
        <div class="bp-am-btns">
          <button class="bp-am-btn primary" :disabled="!materialText.trim() || addingMaterial" @click="addTextMaterial">
            <span class="mso">add</span> 添加文本
          </button>
          <label class="bp-am-btn secondary">
            <span class="mso">upload_file</span> 上传文件
            <input type="file" multiple accept=".txt,.md,.markdown,.text,.csv,.json" style="display:none" @change="handleFileUpload" />
          </label>
        </div>
        <div class="bp-am-hint">支持 .txt / .md / .csv / .json 文件，添加后可通过「整理并编译」处理</div>
      </template>
    </div>

    <!-- 图谱查询 -->
    <div class="bp-graph-query">
      <div class="bp-query-row">
        <input v-model="graphQuery" class="bp-query-input" placeholder="搜索图谱实体/关系..." @keyup.enter="queryGraph" />
        <button class="bp-query-btn" :disabled="!graphQuery.trim()" @click="queryGraph">
          <span class="mso">search</span>
        </button>
        <button v-if="graphQueryResult" class="bp-query-btn" @click="injectGraphToChat" title="注入到对话">
          <span class="mso">chat</span>
        </button>
      </div>
      <div v-if="graphQueryResult" class="bp-query-result">
        <pre>{{ graphQueryResult }}</pre>
      </div>
    </div>

    <!-- 知识图谱预览 -->
    <div v-if="showGraph" class="bp-graph-preview">
      <div class="bp-graph-head">
        <span class="bp-graph-title">知识图谱</span>
        <div class="bp-graph-actions">
          <button class="bp-graph-btn" @click="openGraphInNewTab">
            <span class="mso" style="font-size:16px">open_in_new</span> 新窗口打开
          </button>
          <button class="bp-graph-close" @click="closeGraph"><span class="mso">close</span></button>
        </div>
      </div>
      <iframe :srcdoc="graphHtml" class="bp-graph-iframe"></iframe>
    </div>

    <!-- 进度 -->
    <div v-if="progress" class="bp-progress">
      <span v-if="phase === 'organizing' || phase === 'compiling' || phase === 'feedback'" class="bp-spinner"></span>
      <span>{{ progress }}</span>
    </div>
    <div v-if="error" class="bp-error">{{ error }}</div>

    <!-- 反哺建议列表 -->
    <div v-if="suggestions.length > 0" class="bp-suggestions">
      <div class="bp-sug-head">
        <span>升级建议 ({{ suggestions.length }})</span>
        <button class="bp-sug-all" @click="toggleAllSuggestions">{{ allSelected ? '取消全选' : '全选' }}</button>
      </div>
      <div class="bp-sug-list">
        <div v-for="(s, i) in suggestions" :key="i" class="bp-sug-item" @click="s.selected = !s.selected">
          <input type="checkbox" :checked="s.selected" />
          <div class="bp-sug-content">
            <div class="bp-sug-meta">
              <span class="bp-sug-skill">{{ s.skillName }}</span>
              <span class="bp-sug-type">{{ s.type }}</span>
            </div>
            <div class="bp-sug-text">{{ s.content }}</div>
            <div class="bp-sug-reason">{{ s.reason }}</div>
          </div>
        </div>
      </div>
      <button class="bp-apply-btn" :disabled="!suggestions.some(s => s.selected)" @click="applySelected">
        确认应用 ({{ suggestions.filter(s => s.selected).length }})
      </button>
    </div>
  </div>
</template>

<style scoped>
.bp { display: flex; flex-direction: column; height: 100%; background: var(--surface); }
.bp-head { display: flex; align-items: center; gap: 8px; padding: 14px 16px; border-bottom: 1px solid var(--line); }
.bp-title { font-size: 15px; font-weight: 700; color: var(--ink1); flex: 1; }
.bp-close { border: none; background: none; color: var(--ink3); cursor: pointer; padding: 4px; }
.bp-actions { padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.bp-action-btn {
  display: flex; align-items: center; gap: 12px;
  padding: 16px; border-radius: 12px;
  border: 2px solid var(--line); background: var(--paper);
  cursor: pointer; font-family: inherit; text-align: left;
  transition: all .15s;
}
.bp-action-btn:hover { border-color: var(--olive); box-shadow: 0 2px 8px rgba(0,0,0,.05); }
.bp-action-btn:disabled { opacity: .5; cursor: not-allowed; }
.bp-action-btn .mso { font-size: 28px; color: var(--olive); flex-shrink: 0; }
.bp-action-info { display: flex; flex-direction: column; gap: 2px; }
.bp-action-name { font-size: 15px; font-weight: 700; color: var(--ink1); }
.bp-action-desc { font-size: 12px; color: var(--ink3); }
.bp-progress { padding: 12px 16px; font-size: 13px; color: var(--ink2); display: flex; align-items: center; gap: 8px; }
.bp-spinner { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--line); border-top-color: var(--olive); animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.bp-error { padding: 8px 16px; font-size: 12px; color: #e53935; }
.bp-suggestions { flex: 1; display: flex; flex-direction: column; overflow: hidden; padding: 0 16px 16px; }
.bp-sug-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; font-size: 13px; font-weight: 700; color: var(--ink1); }
.bp-sug-all { border: none; background: none; color: var(--olive); font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit; }
.bp-sug-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.bp-sug-item { display: flex; gap: 8px; padding: 10px; border-radius: 8px; border: 1px solid var(--line); cursor: pointer; }
.bp-sug-item:hover { background: var(--surface-alt); }
.bp-sug-content { flex: 1; min-width: 0; }
.bp-sug-meta { display: flex; gap: 6px; margin-bottom: 4px; }
.bp-sug-skill { font-size: 11px; font-weight: 600; color: var(--olive); background: rgba(107,142,35,.1); padding: 1px 6px; border-radius: 4px; }
.bp-sug-type { font-size: 10px; color: var(--ink3); background: var(--surface); padding: 1px 6px; border-radius: 4px; }
.bp-sug-text { font-size: 12px; color: var(--ink1); line-height: 1.5; }
.bp-sug-reason { font-size: 11px; color: var(--ink3); margin-top: 2px; }
.bp-apply-btn {
  margin-top: 12px; padding: 10px; border-radius: 8px; border: none;
  background: var(--olive); color: #fff; font-size: 14px; font-weight: 700;
  cursor: pointer; font-family: inherit;
}
.bp-apply-btn:disabled { opacity: .4; cursor: not-allowed; }
/* 添加资料 */
.bp-add-material { padding: 0 16px 16px; border-bottom: 1px solid var(--line); }
.bp-am-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.bp-am-title { font-size: 13px; font-weight: 700; color: var(--ink1); }
.bp-am-close { border: none; background: none; color: var(--ink3); cursor: pointer; padding: 4px; }
.bp-am-empty { font-size: 12px; color: var(--ink3); padding: 12px 0; }
.bp-am-name {
  width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px;
  background: var(--surface-alt); font-size: 12px; outline: none; font-family: inherit;
  color: var(--ink); margin-bottom: 8px;
}
.bp-am-name:focus { border-color: var(--olive); }
.bp-am-textarea {
  width: 100%; padding: 10px; border: 1px solid var(--line); border-radius: 8px;
  background: var(--surface-alt); font-size: 12px; outline: none; font-family: inherit;
  color: var(--ink); resize: vertical; min-height: 100px; line-height: 1.6;
}
.bp-am-textarea:focus { border-color: var(--olive); }
.bp-am-btns { display: flex; gap: 8px; margin-top: 10px; }
.bp-am-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 8px 14px; border-radius: 8px; border: none;
  font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit;
  transition: all .15s;
}
.bp-am-btn.primary { background: var(--olive); color: #fff; }
.bp-am-btn.primary:hover { filter: brightness(1.1); }
.bp-am-btn.primary:disabled { opacity: .4; cursor: not-allowed; }
.bp-am-btn.secondary {
  background: var(--surface-alt); color: var(--ink2);
  border: 1px solid var(--line); cursor: pointer;
}
.bp-am-btn.secondary:hover { border-color: var(--olive); color: var(--olive); }
.bp-am-btn .mso { font-size: 16px; }
.bp-am-hint { font-size: 11px; color: var(--ink3); margin-top: 8px; }

/* 知识���谱 */
.bp-graph-preview { flex: 1; display: flex; flex-direction: column; min-height: 0; padding: 0 16px 16px; }
.bp-graph-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; }
.bp-graph-title { font-size: 13px; font-weight: 700; color: var(--ink1); }
.bp-graph-actions { display: flex; gap: 6px; }
.bp-graph-btn {
  display: flex; align-items: center; gap: 4px;
  padding: 4px 10px; border-radius: 6px;
  border: 1px solid var(--olive); background: none;
  color: var(--olive); font-size: 11px; font-weight: 600;
  cursor: pointer; font-family: inherit;
}
.bp-graph-btn:hover { background: var(--olive); color: #fff; }
.bp-graph-close { border: none; background: none; color: var(--ink3); cursor: pointer; padding: 4px; }
/* 图谱查询 */
.bp-graph-query { padding: 0 16px 8px; }
.bp-query-row { display: flex; gap: 4px; }
.bp-query-input {
  flex: 1; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px;
  background: var(--surface-alt); font-size: 12px; outline: none; font-family: inherit; color: var(--ink);
}
.bp-query-input:focus { border-color: var(--olive); }
.bp-query-btn {
  width: 32px; height: 32px; border: 1px solid var(--line); border-radius: 8px;
  background: var(--surface); color: var(--ink3); cursor: pointer; display: flex;
  align-items: center; justify-content: center;
}
.bp-query-btn:hover { border-color: var(--olive); color: var(--olive); }
.bp-query-btn:disabled { opacity: .4; cursor: not-allowed; }
.bp-query-btn .mso { font-size: 16px; }
.bp-query-result {
  margin-top: 8px; padding: 10px; border-radius: 8px;
  background: var(--surface-alt); border: 1px solid var(--line);
  max-height: 200px; overflow-y: auto;
}
.bp-query-result pre {
  margin: 0; font-size: 12px; color: var(--ink2);
  white-space: pre-wrap; word-break: break-word;
  font-family: inherit; line-height: 1.6;
}
.bp-graph-iframe {
  flex: 1; border: 1px solid var(--line); border-radius: 10px;
  background: #fff; min-height: 300px;
}
</style>

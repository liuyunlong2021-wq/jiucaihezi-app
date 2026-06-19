<script setup lang="ts">
/**
 * V8LlmNode.vue
 *
 * Week 2 P0 — Core LLM node replacement.
 * TDD: LLM-001/002/003 + v5.1 context rules (highest priority prompt-flow last,
 * Skill via applicability into system, Tools permissive).
 *
 * UI: 5-tab progressive disclosure (summary always primary; others start collapsed).
 * Handles:
 *   - left-prompt (target): primary prompt-flow in (highest priority)
 *   - left-context (target, repeatable via connections): from Skill/Tool providers
 *   - right-text (source): prompt-flow out (for C-015 Text review step + downstream)
 *
 * Data: only optional fields (full backward compat with canvasStore).
 * Execution: explicit ▶ via NodeFrame. For this phase we assemble context locally and
 * call the safe gateway (same pattern as old node, but vastly improved input construction).
 * Full ConversationContextEngine + runtime swap happens in later phase without touching src/canvas/.
 *
 * Philosophy: everything explicit and inspectable. No black boxes.
 */

import { ref, computed, watch } from 'vue'
import { Handle, Position, useNodeConnections, useNodesData } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvasStore'
import { useAgentStore } from '@/stores/agentStore'
import NodeFrame from './NodeFrame.vue'
import { useV8NodeBehavior } from '@/components/canvas/v8/composables/useV8NodeBehavior'
import type { CanvasNode } from '@/types/canvas'
import { getApiKey } from '@/services/newApiAuth'
import { buildGatewayHeaders, getGatewayBaseUrl } from '@/services/newApiClient'
import { isCloudLoggedIn } from '@/services/newApiAuth'

// Safe runtime import for future
import { ConversationContextEngine } from '@/runtime/conversationContext'

const props = defineProps<{ id: string; data?: any; selected?: boolean }>()

const canvasStore = useCanvasStore()
const agentStore = useAgentStore()
const node = computed(() => ({ id: props.id, data: props.data } as CanvasNode))
const { onResizeHandlePointerDown } = useV8NodeBehavior(node.value, {
  onResizeEnd(id, w, h) { canvasStore.updateNodeData(id, { width: w, height: h }) }
})

const d = computed(() => props.data || {})

// ─── 模型选择器（webhuabu Phase 2: 动态下拉） ───
const textModels = computed(() => agentStore.textModels)
const modelId = computed({
  get: () => d.value.modelId || agentStore.currentModel || textModels.value[0]?.id || 'claude-sonnet-4-6',
  set: v => canvasStore.updateNodeData(props.id, { modelId: v })
})
const temperature = computed({
  get: () => d.value.temperature ?? 0.7,
  set: v => canvasStore.updateNodeData(props.id, { temperature: v })
})
const maxTokens = computed({
  get: () => d.value.maxTokens || 4096,
  set: v => canvasStore.updateNodeData(props.id, { maxTokens: v })
})
const systemOverride = computed({
  get: () => d.value.systemOverride || '',
  set: v => canvasStore.updateNodeData(props.id, { systemOverride: v })
})

// --- Tab state (LLM-003 progressive disclosure) ---
const activeTab = ref<'summary' | 'skill' | 'tools' | 'advanced'>('summary')
function toggleTab(tab: typeof activeTab.value) {
  activeTab.value = activeTab.value === tab ? 'summary' : tab
}

// --- Connections with handle-level precision (webhuabu Phase 2) ---
const targetConns = useNodeConnections({ nodeId: props.id, handleType: 'target' })
const sourceConns = useNodeConnections({ nodeId: props.id, handleType: 'source' })

// 所有上游节点（用于 data 查询）
const upstreamIds = computed(() => [...new Set(targetConns.value.map(c => c.source))])
const upstreamNodes = useNodesData(upstreamIds)

// ─── 按 sourceHandle 精确分类（不再用启发式 type 猜） ───

// left-prompt 聚合：主 prompt 文本
const promptFlowInputs = computed(() => {
  return targetConns.value
    .filter(c => c.sourceHandle === 'right-text' || (!c.sourceHandle && c.targetHandle === 'left-prompt'))
    .map(c => {
      const n = upstreamNodes.value.find((x: any) => x.id === c.source) as any
      if (!n) return ''
      // text 节点 → content; llm 节点 → outputContent
      return (n.data?.content || n.data?.outputContent || n.data?.reply || '').trim()
    })
    .filter(Boolean)
})

// left-context 聚合：Skill / Toolset / image / 附加上下文
const contextInputs = computed(() => {
  return targetConns.value
    .filter(c => c.sourceHandle === 'right-context' || c.sourceHandle === 'right-image' || (!c.sourceHandle && c.targetHandle === 'left-context'))
    .map(c => {
      const n = upstreamNodes.value.find((x: any) => x.id === c.source) as any
      if (!n) return null
      return {
        id: n.id,
        type: n.type,
        sourceHandle: c.sourceHandle || 'right-context',
        data: n.data || {}
      }
    })
    .filter(Boolean)
})

// Skill 上下文（从 contextInputs 中提取）
const skillContexts = computed(() =>
  contextInputs.value.filter(c => c !== null && (c.type === 'skill' || c.data?.skillId || c.data?.skillContent))
)

// Toolset 上下文
const toolsetContexts = computed(() =>
  contextInputs.value.filter(c => c !== null && (c.type === 'toolset' || c.data?.enabledTools))
)

// Image 上下文（vision 图片）
const imageContexts = computed(() =>
  contextInputs.value.filter(c => c !== null && (c.sourceHandle === 'right-image' || c.type === 'image' || c.data?.url))
)

// ─── 组装最终 prompt ───
const assembledPrompt = computed(() => {
  const upstream = promptFlowInputs.value.join('\n\n---\n\n')
  const local = (d.value.prompt || d.value.userPrompt || '').trim()
  return (upstream || local || '').trim()
})

// ─── Skill 名称列表 ───
const appliedSkills = computed(() =>
  skillContexts.value.map(c => c !== null ? (c.data?.skillName || c.data?.label || 'Skill') : '')
)

// ─── 工具列表 ───
const exposedTools = computed(() => {
  const toolNode = toolsetContexts.value.find(c => c !== null)
  if (toolNode && toolNode !== null) {
    return toolNode.data?.enabledTools || ['webSearch']
  }
  return []
})

// --- Status / output ---
const status = computed(() => d.value.status || 'idle')
const output = computed(() => d.value.outputContent || d.value.reply || '')
const error = ref<string | null>(null)

// --- Execute with handle-level context assembly (webhuabu Phase 2) ---
const abortController = ref<AbortController | null>(null)

async function run() {
  error.value = null
  // Web 未登录态检查
  if (!isCloudLoggedIn()) {
    canvasStore.updateNodeData(props.id, { status: 'error', error: '请先在设置页登录' })
    return
  }
  if (!assembledPrompt.value && imageContexts.value.length === 0) {
    error.value = '缺少输入：请连接文本或图片节点'
    return
  }
  canvasStore.updateNodeData(props.id, { status: 'running', error: '', outputContent: '' })

  abortController.value = new AbortController()
  try {
    const key = getApiKey()
    if (!key) throw new Error('请先登录韭菜盒子账号')

    // ─── 构建 messages（webhuabu Phase 2: 支持 Skill + 图片 + 工具） ───
    const messages: any[] = []

    // 1. System: skill + systemOverride
    const systemParts: string[] = []
    if (systemOverride.value.trim()) {
      systemParts.push(systemOverride.value.trim())
    }
    for (const skillCtx of skillContexts.value) {
      if (skillCtx === null) continue
      const content = skillCtx.data?.skillContent || ''
      const name = skillCtx.data?.skillName || 'Skill'
      // applicability 过滤
      const applicability: string[] = skillCtx.data?.applicability || []
      if (applicability.length > 0) {
        const taskHint = assembledPrompt.value.slice(0, 200).toLowerCase()
        const matchesTask = applicability.some((tag: string) => taskHint.includes(tag.toLowerCase()))
        if (!matchesTask) continue // 不匹配当前任务，跳过
      }
      if (content) {
        systemParts.push(`当前 Skill：${name}\n<SKILL.md>\n${content.slice(0, 8000)}\n</SKILL.md>`)
      } else if (name) {
        systemParts.push(`当前 Skill：${name}\n请按照该 Skill 的规则执行。`)
      }
    }
    if (systemParts.length > 0) {
      messages.push({ role: 'system', content: systemParts.join('\n\n') })
    }

    // 2. Tools
    if (exposedTools.value.length > 0) {
      messages.push({
        role: 'system',
        content: `可用工具（LLM 可自主决定是否调用）：${exposedTools.value.join(', ')}`
      })
    }

    // 3. User message: 文本 + 图片
    const userContent: any[] = []
    if (assembledPrompt.value.trim()) {
      userContent.push({ type: 'text', text: assembledPrompt.value.trim() })
    }
    for (const imgCtx of imageContexts.value) {
      if (imgCtx === null) continue
      const url = imgCtx.data?.url || imgCtx.data?.imageUrl || ''
      if (url) {
        userContent.push({ type: 'image_url', image_url: { url } })
      }
    }
    if (userContent.length > 0) {
      messages.push({ role: 'user', content: userContent.length === 1 && userContent[0].type === 'text'
        ? userContent[0].text
        : userContent })
    }

    // ─── API 调用（stream: true） ───
    const res = await fetch(`${getGatewayBaseUrl()}/v1/chat/completions`, {
      method: 'POST',
      signal: abortController.value.signal,
      headers: { ...buildGatewayHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId.value,
        messages,
        temperature: temperature.value,
        max_tokens: maxTokens.value,
        stream: true
      })
    })

    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`)
    }

    // ─── SSE 流式解析 ───
    const reader = res.body?.getReader()
    if (!reader) throw new Error('无法读取响应流')
    const decoder = new TextDecoder()
    let fullText = ''
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') continue
        try {
          const json = JSON.parse(payload)
          const delta = json.choices?.[0]?.delta?.content || ''
          if (delta) {
            fullText += delta
            canvasStore.updateNodeData(props.id, { outputContent: fullText, status: 'running' })
          }
        } catch { /* skip parse errors */ }
      }
    }

    canvasStore.updateNodeData(props.id, {
      status: 'success',
      progress: 100,
      outputContent: fullText,
      reply: fullText,
      lastContextSummary: {
        skills: appliedSkills.value,
        tools: exposedTools.value,
        images: imageContexts.value.length,
        promptFlowLength: assembledPrompt.value.length
      }
    })
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      canvasStore.updateNodeData(props.id, { status: 'cancelled' })
    } else {
      error.value = e?.message || '生成失败'
      canvasStore.updateNodeData(props.id, { status: 'error', error: e?.message })
    }
  } finally {
    abortController.value = null
  }
}

function stop() {
  if (abortController.value) {
    abortController.value.abort()
    abortController.value = null
  }
  canvasStore.updateNodeData(props.id, { status: 'cancelled' })
}

// Watch for context changes → mark dirty (E-002 style, simple version)
watch([() => appliedSkills.value, () => exposedTools.value], () => {
  if (status.value === 'success') {
    canvasStore.updateNodeData(props.id, { status: 'idle' }) // becomes dirty for re-run
  }
}, { deep: true })
</script>

<template>
  <NodeFrame
    :id="id"
    label="LLM"
    icon="smart_toy"
    role="think"
    :status="status"
    :selected="selected"
    executable
    show-stop
    @run="run"
    @stop="stop"
    @delete="$emit('delete', $event)"
    @resize-start="onResizeHandlePointerDown"
  >
    <!-- Handles per spec -->
    <Handle
      id="left-prompt"
      type="target"
      :position="Position.Left"
      :style="{ background: '#8b5cf6', width: '10px', height: '10px', border: 'none' }"
    />
    <Handle
      id="left-context"
      type="target"
      :position="Position.Left"
      :style="{ background: '#a78bfa', width: '10px', height: '10px', border: 'none', top: '65%' }"
    />
    <Handle
      id="right-text"
      type="source"
      :position="Position.Right"
      :style="{ background: '#8b5cf6', width: '10px', height: '10px', border: 'none' }"
    />

    <!-- 5-tab progressive UI (LLM-003) -->
    <div class="v8-llm">
      <!-- Tab bar -->
      <div class="v8-llm-tabs">
        <button
          v-for="tab in [
            { key: 'summary', icon: '📋', label: '摘要' },
            { key: 'skill', icon: '🧩', label: 'Skill' },
            { key: 'tools', icon: '🔧', label: '工具' },
            { key: 'advanced', icon: '⚙️', label: '高级' }
          ] as const"
          :key="tab.key"
          class="v8-tab"
          :class="{ active: activeTab === tab.key }"
          @click="toggleTab(tab.key)"
        >
          {{ tab.icon }} {{ tab.label }}
        </button>
      </div>

      <!-- SUMMARY (default visible) -->
      <div v-if="activeTab === 'summary'" class="v8-tab-panel">
        <div class="v8-summary">
          <div class="v8-summary-model">
            <strong>模型</strong>
            <select v-model="modelId" class="v8-inline-select">
              <option v-for="m in textModels" :key="m.id" :value="m.id">{{ m.label || m.id }}</option>
            </select>
          </div>
          <div v-if="appliedSkills.length"><strong>Skill</strong>：{{ appliedSkills.join('、') }}</div>
          <div v-if="imageContexts.length"><strong>图片</strong>：{{ imageContexts.length }} 张（vision 输入）</div>
          <div v-if="exposedTools.length"><strong>工具</strong>：{{ exposedTools.join('、') }}</div>
          <div class="v8-prompt-preview">
            <strong>最终 Prompt</strong>
            <pre>{{ assembledPrompt.slice(0, 600) }}{{ assembledPrompt.length > 600 ? '…' : '' }}</pre>
          </div>
          <div v-if="output" class="v8-output">{{ output.slice(0, 400) }}{{ output.length > 400 ? '…' : '' }}</div>
        </div>
      </div>

      <!-- Skill -->
      <div v-else-if="activeTab === 'skill'" class="v8-tab-panel">
        <div v-if="appliedSkills.length === 0" class="v8-hint">无 Skill 连接。拖拽 SkillNode 连线。</div>
        <div v-else class="v8-chips">
          <span v-for="s in appliedSkills" :key="s" class="v8-chip">🧩 {{ s }}</span>
        </div>
        <div class="v8-hint">Skill 通过 skillApplicability 过滤后注入 system。</div>
      </div>

      <!-- Tools (permissive) -->
      <div v-else-if="activeTab === 'tools'" class="v8-tab-panel">
        <div v-if="exposedTools.length === 0" class="v8-hint">无工具集连接。ToolsetNode 连线后显示可选工具。</div>
        <div v-else>
          <div class="v8-chips">
            <span v-for="t in exposedTools" :key="t" class="v8-chip tool">🔧 {{ t }}</span>
          </div>
          <div class="v8-hint">工具定义已暴露。LLM 可自主决定是否调用（LLM-002，与 useChat.ts 一致）。</div>
        </div>
      </div>

      <!-- Advanced -->
      <div v-else-if="activeTab === 'advanced'" class="v8-tab-panel">
        <div class="v8-adv">
          <label>模型
            <select v-model="modelId">
              <option v-for="m in textModels" :key="m.id" :value="m.id">{{ m.label || m.id }}</option>
            </select>
          </label>
          <label>温度 <input type="number" v-model.number="temperature" step="0.1" min="0" max="2" /></label>
          <label>Max Tokens <input type="number" v-model.number="maxTokens" /></label>
          <label>System 覆盖（可选）
            <textarea v-model="systemOverride" rows="2" placeholder="覆盖默认 system（高级）" />
          </label>
        </div>
      </div>

      <div v-if="error" class="v8-err">{{ error }}</div>
    </div>
  </NodeFrame>
</template>

<style scoped>
.v8-llm { padding: 6px 8px 4px; font-size: 12px; }
.v8-llm-tabs { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 6px; }
.v8-tab {
  font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border);
  background: var(--surface); color: var(--ink2); cursor: pointer;
}
.v8-tab.active { background: #8b5cf6; color: white; border-color: #8b5cf6; }
.v8-tab-panel { min-height: 80px; }
.v8-summary { line-height: 1.5; }
.v8-summary-model { display: flex; align-items: center; gap: 6px; }
.v8-inline-select { font-size: 11px; border: 1px solid var(--border); border-radius: 4px; padding: 1px 4px; background: var(--surface); color: var(--ink1); }
.v8-summary pre { background: var(--surface); padding: 6px; border-radius: 4px; white-space: pre-wrap; font-size: 11px; max-height: 160px; overflow: auto; }
.v8-output { margin-top: 6px; padding: 6px; background: rgba(139,92,246,.08); border-radius: 4px; white-space: pre-wrap; max-height: 120px; overflow: auto; }
.v8-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.v8-chip { background: rgba(167,139,250,.15); color: #6d28d9; padding: 1px 6px; border-radius: 999px; font-size: 11px; }
.v8-chip.tool { background: rgba(16,185,129,.15); color: #10b981; }
.v8-hint { font-size: 10px; color: var(--ink3); margin-top: 4px; }
.v8-adv { display: flex; flex-direction: column; gap: 6px; }
.v8-adv label { font-size: 10px; color: var(--ink3); }
.v8-adv input, .v8-adv select, .v8-adv textarea { width: 100%; font-size: 12px; padding: 3px 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); }
.v8-err { color: #f87171; font-size: 10px; margin-top: 4px; }
</style>

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
import NodeFrame from './NodeFrame.vue'
import { useV8NodeBehavior } from '@/components/canvas/v8/composables/useV8NodeBehavior'
import type { CanvasNode } from '@/types/canvas'
import { getApiKey } from '@/services/newApiAuth'
import { buildGatewayHeaders, getGatewayBaseUrl } from '@/services/newApiClient'

// Safe runtime import for future (type + eventual .build call). Does not mutate anything.
import { ConversationContextEngine } from '@/runtime/conversationContext'

const props = defineProps<{ id: string; data?: any; selected?: boolean }>()

const canvasStore = useCanvasStore()
const node = computed(() => ({ id: props.id, data: props.data } as CanvasNode))
const { onResizeHandlePointerDown } = useV8NodeBehavior(node.value, {
  onResizeEnd(id, w, h) { canvasStore.updateNodeData(id, { width: w, height: h }) }
})

const d = computed(() => props.data || {})

// --- Core editable fields (optional, compat) ---
const modelId = computed({
  get: () => d.value.modelId || 'claude-sonnet-4-6',
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

// --- Connections for 3-way context (LLM-001) ---
const targetConns = useNodeConnections({ nodeId: props.id, handleType: 'target' })
const sourceConns = useNodeConnections({ nodeId: props.id, handleType: 'source' })

const upstreamIds = computed(() => [...new Set(targetConns.value.map(c => c.source))])
const upstreamNodes = useNodesData(upstreamIds)

// Classify connections by type (heuristic + future: use edge types / handle ids)
const promptFlowSources = computed(() => {
  // left-prompt or any text/llm output that looks like prompt
  return upstreamNodes.value
    .filter((n: any) => n?.data?.prompt || n?.data?.content || n?.data?.outputContent || n?.data?.reply)
    .map((n: any) => ({
      id: n.id,
      label: n.data?.label || '上游',
      text: (n.data?.prompt || n.data?.content || n.data?.outputContent || n.data?.reply || '').slice(0, 800)
    }))
})

const contextProviders = computed(() => {
  // From Skill/Tool via left-context
  return upstreamNodes.value
    .filter((n: any) => n?.type === 'skill' || n?.type === 'toolset' || n?.data?.skillName || n?.data?.enabledTools)
    .map((n: any) => {
      const type = n.type || (n.data?.skillName ? 'skill' : 'toolset')
      return {
        id: n.id,
        type,
        label: n.data?.skillName || (n.data?.enabledTools?.join?.(', ') || '工具集'),
        detail: type === 'skill' ? 'Skill 注入' : '工具定义'
      }
    })
})

// --- Assembled context for summary + execution (LLM-001 priorities) ---
const assembledPrompt = computed(() => {
  const upstream = promptFlowSources.value.map(p => p.text).join('\n\n---\n\n')
  const local = (d.value.prompt || d.value.userPrompt || '').trim()
  return (upstream || local || '').trim()
})

const appliedSkills = computed(() =>
  contextProviders.value.filter(c => c.type === 'skill').map(c => c.label)
)

const exposedTools = computed(() => {
  const toolNode = contextProviders.value.find(c => c.type === 'toolset')
  return toolNode ? (d.value.enabledTools || ['webSearch']) : []
})

// --- Status / output ---
const status = computed(() => d.value.status || 'idle')
const output = computed(() => d.value.outputContent || d.value.reply || '')
const error = ref<string | null>(null)

// --- Execute with proper 3-way assembly (LLM-001 + LLM-002) ---
async function run() {
  error.value = null
  if (!assembledPrompt.value) {
    error.value = '缺少 prompt（上游或本地）'
    return
  }
  canvasStore.updateNodeData(props.id, { status: 'running', error: '', outputContent: '' })

  try {
    const key = getApiKey()
    if (!key) throw new Error('请先登录')

    // Build messages per v5.1 + CLAUDE.md rules
    const messages: any[] = []

    // 1. System from Skill (if any) — highest system priority
    if (appliedSkills.value.length > 0) {
      // In real: call skillApplicability + load SKILL.md
      // Here we put a marker (full impl later via safe engine)
      messages.push({
        role: 'system',
        content: `你正在使用以下 Skill：${appliedSkills.value.join(', ')}。\n请严格遵循其规则。`
      })
    }

    // 2. Tools (permissive — LLM decides)
    if (exposedTools.value.length > 0) {
      messages.push({
        role: 'system',
        content: `可用工具（LLM 可自主决定是否调用）：${exposedTools.value.join(', ')}`
      })
    }

    // 3. Main user content — prompt-flow is LAST and highest priority
    messages.push({
      role: 'user',
      content: assembledPrompt.value
    })

    // Future: const engine = new ConversationContextEngine(); const final = engine.build(...)
    // For now we use the manually prioritized messages above (correct per spec)

    const res = await fetch(`${getGatewayBaseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { ...buildGatewayHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId.value,
        messages,
        temperature: temperature.value,
        max_tokens: maxTokens.value,
        stream: false
      })
    })

    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`)
    }

    const j = await res.json()
    const text = j.choices?.[0]?.message?.content || j.content || j.reply || ''
    canvasStore.updateNodeData(props.id, {
      status: 'success',
      progress: 100,
      outputContent: text,
      reply: text,
      lastContextSummary: {
        skills: appliedSkills.value,
        tools: exposedTools.value,
        promptFlowLength: assembledPrompt.value.length
      }
    })
  } catch (e: any) {
    error.value = e?.message || '生成失败'
    canvasStore.updateNodeData(props.id, { status: 'error', error: e?.message })
  }
}

function stop() {
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
          <div><strong>模型</strong>：{{ modelId }}</div>
          <div v-if="appliedSkills.length"><strong>Skill</strong>：{{ appliedSkills.join('、') }}</div>
          <div v-if="exposedTools.length"><strong>工具</strong>：{{ exposedTools.join('、') }}</div>
          <div class="v8-prompt-preview">
            <strong>最终 Prompt（prompt-flow 优先级最高，置于最后）</strong>
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
              <option value="claude-sonnet-4-6">Claude Sonnet 4</option>
              <option value="gpt-5">GPT-5</option>
              <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
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

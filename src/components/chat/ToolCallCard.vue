<script setup lang="ts">
/**
 * ToolCallCard.vue — 工具调用卡片（小白可视化）
 *
 * 将 tool_call JSON 转化为小白看得懂的卡片:
 *   - 工具名（中文映射）
 *   - 参数预览（折叠）
 *   - 执行结果（折叠）
 *   - 耗时
 */
import { ref, computed } from 'vue'
import type { ToolCall } from '@/composables/useChat'
import { getToolCardByName } from '@/utils/toolRegistry'
import { getMcpToolLabel, isMcpToolName } from '@/runtime/tools/mcpBridge'

const props = defineProps<{
  toolCalls: ToolCall[]
}>()

const expanded = ref<Set<string>>(new Set())

function toggle(id: string) {
  if (expanded.value.has(id)) {
    expanded.value.delete(id)
  } else {
    expanded.value.add(id)
  }
  expanded.value = new Set(expanded.value) // trigger reactivity
}

// 工具名中文映射 (小白友好)
function toolLabel(name: string): { label: string; icon: string } {
  if (isMcpToolName(name)) return { label: getMcpToolLabel(name), icon: 'extension' }

  const registered = getToolCardByName(name)
  if (registered) return { label: registered.name, icon: registered.icon }

  const map: Record<string, { label: string; icon: string }> = {
    web_search: { label: '网络搜索', icon: 'search' },
    search: { label: '网络搜索', icon: 'search' },
    code_execute: { label: '执行代码', icon: 'code' },
    run_code: { label: '执行代码', icon: 'code' },
    read_file: { label: '读取文件', icon: 'description' },
    file_read: { label: '读取文件', icon: 'description' },
    write_file: { label: '写入文件', icon: 'save' },
    file_write: { label: '写入文件', icon: 'save' },
    generate_image: { label: '生成图片', icon: 'image' },
    text_to_speech: { label: '语音合成', icon: 'record_voice_over' },
  }
  return map[name] || { label: name, icon: 'build' }
}

function prettyArgs(argsStr: string): string {
  try {
    return JSON.stringify(JSON.parse(argsStr), null, 2)
  } catch {
    return argsStr || '(无参数)'
  }
}
</script>

<template>
  <div v-if="toolCalls && toolCalls.length" class="tool-calls">
    <div v-for="tc in toolCalls" :key="tc.id" class="tool-card" @click="toggle(tc.id)">
      <div class="tc-head">
        <span class="mso tc-icon">{{ toolLabel(tc.function.name).icon }}</span>
        <span class="tc-label">{{ toolLabel(tc.function.name).label }}</span>
        <span class="mso tc-expand">{{ expanded.has(tc.id) ? 'expand_less' : 'expand_more' }}</span>
      </div>
      <div v-if="expanded.has(tc.id)" class="tc-body">
        <div class="tc-section">
          <span class="tc-key">参数</span>
          <pre class="tc-pre">{{ prettyArgs(tc.function.arguments) }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-calls {
  display: flex; flex-direction: column; gap: 4px;
  margin-top: 8px;
}
.tool-card {
  border: 1px solid var(--line); border-radius: 8px;
  background: var(--surface); cursor: pointer;
  transition: all .12s; overflow: hidden;
}
.tool-card:hover { border-color: var(--olive); }
.tc-head {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px;
}
.tc-icon { font-size: 16px; color: #e91e63; }
.tc-label { font-size: 12px; font-weight: 600; color: var(--ink1); flex: 1; }
.tc-expand { font-size: 18px; color: var(--ink3); }
.tc-body { padding: 0 10px 8px; }
.tc-section { margin-top: 4px; }
.tc-key {
  font-size: 10px; font-weight: 700; color: var(--ink3);
  text-transform: uppercase; letter-spacing: .5px;
}
.tc-pre {
  margin: 2px 0 0; padding: 6px 8px;
  background: var(--paper); border-radius: 4px;
  font-size: 11px; line-height: 1.4; overflow-x: auto;
  font-family: 'SF Mono', monospace; color: var(--ink2);
  white-space: pre-wrap; word-break: break-all;
  max-height: 200px; overflow-y: auto;
}
</style>

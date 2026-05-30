<script setup lang="ts">
/**
 * AgentEditDialog — 编辑Skill对话框（SKILL.md 标准格式 + AI 重写）
 * 
 * 增强：Tab 切换「手动编辑」/「AI 重写」
 * AI 重写移植自 V4 openAgentRewriteDialog (行 12267-12350)
 */
import { ref, watch, computed } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import { resolveApiConfig, buildHeaders } from '@/utils/api'
import type { SkillConfig } from '@/types/skill'

const agentStore = useAgentStore()

const props = defineProps<{
  visible: boolean
  editAgent?: SkillConfig | null
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

// ─── 内置Skill只读判断 ───
const isReadonly = computed(() => {
  if (!props.editAgent) return false
  return props.editAgent.source !== 'user'
})

// ─── 共享状态 ───
const name = ref('')
const description = ref('')
const triggers = ref('')
const skillContent = ref('')

// ─── Tab 切换 ───
type EditTab = 'manual' | 'ai' | 'test'
const activeTab = ref<EditTab>('manual')

// ─── AI 重写状态（移植自 V4 _agentRewriteState） ───
const rewriteRequest = ref('')
const isRewriting = ref(false)
const proposedContent = ref('')
const changeSummary = ref('')
const rewriteError = ref('')
const rewriteStage = ref<'input' | 'preview'>('input')

watch(() => props.editAgent, (agent) => {
  if (agent) {
    name.value = agent.name
    description.value = agent.description || ''
    triggers.value = (agent.triggers || []).join(', ')
    skillContent.value = agent.skillContent || ''
  } else {
    name.value = ''
    description.value = ''
    triggers.value = ''
    skillContent.value = ''
  }
  // 重置 AI 重写状态
  activeTab.value = 'manual'
  rewriteRequest.value = ''
  proposedContent.value = ''
  changeSummary.value = ''
  rewriteError.value = ''
  rewriteStage.value = 'input'
}, { immediate: true })

function save() {
  const n = name.value.trim()
  if (!n) return

  const triggerArr = triggers.value.split(/[,，]/).map(t => t.trim()).filter(Boolean)

  if (props.editAgent) {
    agentStore.updateSkill(props.editAgent.id, {
      name: n,
      description: description.value,
      triggers: triggerArr,
      skillContent: skillContent.value,
    })
  } else {
    const newSkill: SkillConfig = {
      id: 'custom_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      name: n,
      description: description.value,
      triggers: triggerArr,
      skillContent: skillContent.value,
      references: [],
      examples: [],
      version: 1,
      source: 'user',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      evolutionLog: [],
    }
    agentStore.createAgent(newSkill)
  }
  emit('close')
}

/**
 * AI 重写 — 移植自 V4 requestAgentRewriteProposal (行 12291-12314)
 */
async function requestRewrite() {
  if (!rewriteRequest.value.trim()) {
    rewriteError.value = '先告诉我你想怎么改'
    return
  }
  isRewriting.value = true
  rewriteError.value = ''

  try {
    const config = await resolveApiConfig()
    const res = await fetch(`${config.apiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify({
        model: config.model || 'claude-sonnet-4-6',
        messages: [
          {
            role: 'system',
            content: '你是Skill优化专家。请根据修改意见重写 SKILL.md 内容。只按如下格式输出：<NEW_PROMPT>新的 SKILL.md 内容</NEW_PROMPT><CHANGE_SUMMARY>- 变更 1\n- 变更 2</CHANGE_SUMMARY>。不要输出其他内容。'
          },
          {
            role: 'user',
            content: `Skill名称：${name.value}\n\n当前 SKILL.md：\n${skillContent.value}\n\n修改意见：\n${rewriteRequest.value}`
          }
        ],
        temperature: 0.35,
        max_tokens: 2000,
        stream: false,
      }),
    })

    if (!res.ok) throw new Error(`API 错误: ${res.status}`)

    const data = await res.json()
    const text = data.choices?.[0]?.message?.content || ''

    // 解析 V4 格式（行 12305-12310）
    const promptMatch = text.match(/<NEW_PROMPT>([\s\S]*?)<\/NEW_PROMPT>/i)
    const summaryMatch = text.match(/<CHANGE_SUMMARY>([\s\S]*?)<\/CHANGE_SUMMARY>/i)

    proposedContent.value = (promptMatch ? promptMatch[1] : text)
      .replace(/^```markdown\n?/, '').replace(/\n?```$/, '').trim()
    changeSummary.value = summaryMatch ? summaryMatch[1].trim() : '已根据修改意见重写'

    rewriteStage.value = 'preview'
  } catch (e: any) {
    rewriteError.value = e.message || '重写失败'
  } finally {
    isRewriting.value = false
  }
}

/**
 * 确认采用 AI 重写结果
 */
function acceptRewrite() {
  skillContent.value = proposedContent.value
  activeTab.value = 'manual' // 切回手动 Tab 让用户看到结果
  rewriteStage.value = 'input'
  rewriteRequest.value = ''
  proposedContent.value = ''
}

// ─── 测试功能 ───
const testInput = ref('')
const testOutput = ref('')
const isTesting = ref(false)

async function runTest() {
  if (!testInput.value.trim() || !skillContent.value.trim()) return
  isTesting.value = true
  testOutput.value = ''
  try {
    const config = await resolveApiConfig()
    const res = await fetch(`${config.apiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify({
        model: config.model || 'claude-sonnet-4-6',
        messages: [
          { role: 'system', content: skillContent.value },
          { role: 'user', content: testInput.value },
        ],
        temperature: 0.4,
        max_tokens: 2000,
        stream: false,
      }),
    })
    if (!res.ok) throw new Error(`API ${res.status}`)
    const data = await res.json()
    testOutput.value = data.choices?.[0]?.message?.content || '(无输出)'
  } catch (e: any) {
    testOutput.value = `错误: ${e.message}`
  } finally {
    isTesting.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="ae-overlay" @mousedown.self="emit('close')">
      <div class="ae-box" :class="{ wide: activeTab === 'ai' && rewriteStage === 'preview' }">
        <h2 class="serif">
          <span v-if="isReadonly" class="mso" style="font-size:18px;margin-right:6px;color:var(--olive)">lock</span>
          {{ editAgent ? '编辑Skill' : '创建Skill' }}
        </h2>

        <!-- Tab 切换（仅编辑模式显示） -->
        <div v-if="editAgent" class="ae-tabs">
          <button class="ae-tab" :class="{ active: activeTab === 'manual' }" @click="activeTab = 'manual'">
            <span class="mso" style="font-size:16px">edit</span> 手动编辑
          </button>
          <button class="ae-tab" :class="{ active: activeTab === 'ai' }" @click="activeTab = 'ai'">
            <span class="mso" style="font-size:16px">auto_fix</span> AI 重写
          </button>
          <button class="ae-tab" :class="{ active: activeTab === 'test' }" @click="activeTab = 'test'">
            <span class="mso" style="font-size:16px">play_circle</span> 测试
          </button>
        </div>

        <!-- ═══ 手动编辑 Tab ═══ -->
        <div v-if="activeTab === 'manual'">
          <!-- 内置Skill只读提示 -->
          <div v-if="isReadonly" class="ae-readonly-banner">
            <span class="mso" style="font-size:20px">lock</span>
            <div>
              <strong>内置Skill · 仅可使用不可编辑</strong>
              <p>这是一个系统内置Skill，SKILL.md 内容已锁定。你可以选择使用它，但无法查看或修改其内容。</p>
            </div>
          </div>
          <template v-else>
          <div class="ae-field">
            <label>名称</label>
            <input v-model="name" type="text" placeholder="Skill名称" />
          </div>
          <div class="ae-field">
            <label>描述（什么时候激活 + 职责）</label>
            <input v-model="description" type="text" placeholder="当用户需要..." />
          </div>
          <div class="ae-field">
            <label>触发关键词（逗号隔开）</label>
            <input v-model="triggers" type="text" placeholder="小红书, 种草, 文案" />
          </div>
          <div class="ae-field">
            <label>SKILL.md 内容</label>
            <textarea v-model="skillContent" placeholder="## 角色定义
…
## 工作流程
…" rows="8"></textarea>
          </div>
          </template>
          <div class="ae-actions">
            <button class="ae-btn ae-ghost" @click="emit('close')">取消</button>
            <button v-if="!isReadonly" class="ae-btn ae-primary" @click="save" :disabled="!name.trim()">
              {{ editAgent ? '保存' : '创建' }}
            </button>
          </div>
        </div>

        <!-- ═══ 测试 Tab ═══ -->
        <div v-if="activeTab === 'test'">
          <div class="ae-field">
            <label>发一条测试消息，看Skill怎么回</label>
            <textarea v-model="testInput" rows="3" placeholder="输入一条用户消息来测试这个Skill..."></textarea>
          </div>
          <div class="ae-actions" style="margin-top:12px;margin-bottom:12px">
            <button class="ae-btn ae-primary" :disabled="isTesting || !testInput.trim() || !skillContent.trim()" @click="runTest">
              {{ isTesting ? '测试中...' : '发送测试' }}
            </button>
          </div>
          <div v-if="testOutput" class="ae-test-output">
            <div class="ae-test-output-title">Skill回复</div>
            <pre class="ae-test-output-body">{{ testOutput }}</pre>
          </div>
          <div v-if="!skillContent.trim()" class="ae-error">请先在「手动编辑」中填写 SKILL.md 内容</div>
        </div>

        <!-- ═══ AI 重写 Tab ═══ -->
        <div v-if="activeTab === 'ai'">
          <!-- 输入修改意见 -->
          <div v-if="rewriteStage === 'input'">
            <div class="ae-field">
              <label>当前Skill：{{ name }}</label>
              <div class="ae-current-preview">{{ skillContent.slice(0, 150) }}{{ skillContent.length > 150 ? '...' : '' }}</div>
            </div>
            <div class="ae-field">
              <label>你想怎么改？</label>
              <textarea
                v-model="rewriteRequest"
                placeholder="例如：加强输出格式约束、增加一个错误处理步骤、让语气更轻松..."
                rows="4"
              ></textarea>
            </div>
            <div v-if="rewriteError" class="ae-error">{{ rewriteError }}</div>
            <div class="ae-actions">
              <button class="ae-btn ae-ghost" @click="activeTab = 'manual'">← 返回</button>
              <button class="ae-btn ae-primary" :disabled="isRewriting || !rewriteRequest.trim()" @click="requestRewrite">
                {{ isRewriting ? 'AI 分析中...' : '🤖 生成修改方案' }}
              </button>
            </div>
          </div>

          <!-- 预览 diff（移植自 V4 rewrite preview 行 12317-12350） -->
          <div v-if="rewriteStage === 'preview'">
            <div class="ae-diff-summary">
              <div class="ae-diff-title">📝 变更摘要</div>
              <div class="ae-diff-body">{{ changeSummary }}</div>
            </div>
            <div class="ae-diff-compare">
              <div class="ae-diff-col">
                <div class="ae-diff-col-title">原版</div>
                <pre class="ae-diff-pre">{{ skillContent }}</pre>
              </div>
              <div class="ae-diff-col ae-diff-new">
                <div class="ae-diff-col-title">新版</div>
                <pre class="ae-diff-pre">{{ proposedContent }}</pre>
              </div>
            </div>
            <div class="ae-actions">
              <button class="ae-btn ae-ghost" @click="rewriteStage = 'input'">↩ 重新修改</button>
              <button class="ae-btn ae-primary" @click="acceptRewrite">✅ 采用新版</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ae-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}
.ae-box {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 24px;
  max-width: 420px;
  width: 92%;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.18);
  max-height: 85vh;
  overflow-y: auto;
  transition: max-width 0.2s;
}
.ae-box.wide { max-width: 720px; }
.ae-box h2 {
  font-size: 18px;
  color: var(--ink);
  margin: 0 0 16px;
}
/* Tabs */
.ae-tabs {
  display: flex; gap: 4px; margin-bottom: 16px;
  background: var(--surface-alt); border-radius: 8px; padding: 3px;
}
.ae-tab {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px;
  padding: 7px 12px; border: none; border-radius: 6px;
  background: none; font-size: 13px; font-weight: 600;
  color: var(--ink3); cursor: pointer; font-family: inherit;
  transition: all 0.15s;
}
.ae-tab.active { background: var(--surface); color: var(--ink); box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
/* Fields */
.ae-field { margin-bottom: 16px; }
.ae-field label {
  display: block; font-size: 12px; font-weight: 600;
  color: var(--ink2); margin-bottom: 6px;
}
.ae-field input, .ae-field textarea {
  width: 100%; padding: 9px 12px;
  border: 1px solid var(--border); border-radius: 10px;
  background: var(--surface-alt); font-size: 13px;
  font-family: inherit; color: var(--ink); outline: none;
  box-sizing: border-box; transition: border-color 0.15s;
}
.ae-field input:focus, .ae-field textarea:focus { border-color: var(--olive); }
.ae-field textarea { resize: vertical; min-height: 80px; line-height: 1.6; }
/* Actions */
.ae-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.ae-btn {
  padding: 9px 20px; border-radius: 10px; font-size: 13px;
  font-weight: 700; cursor: pointer; font-family: inherit; transition: all 0.12s;
}
.ae-ghost { border: 1px solid var(--border); background: none; color: var(--ink2); }
.ae-ghost:hover { background: var(--olive-pale); }
.ae-primary { border: none; background: var(--olive); color: #fff; }
.ae-primary:hover { transform: scale(1.03); }
.ae-primary:disabled { opacity: 0.4; cursor: default; transform: none; }
/* Readonly banner for built-in skills */
.ae-readonly-banner {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 14px 16px; border-radius: 12px;
  background: rgba(107, 142, 35, 0.06); border: 1px solid rgba(107, 142, 35, 0.2);
  margin-bottom: 16px;
}
.ae-readonly-banner strong {
  display: block; font-size: 14px; color: var(--olive-dark); margin-bottom: 4px;
}
.ae-readonly-banner p {
  margin: 0; font-size: 12px; color: var(--ink2); line-height: 1.5;
}
/* AI Rewrite specific */
.ae-current-preview {
  font-size: 12px; color: var(--ink3); line-height: 1.5;
  padding: 8px 10px; border-radius: 8px;
  background: var(--surface-alt); border: 1px solid var(--border);
  max-height: 60px; overflow: hidden;
}
.ae-error { color: #c0392b; font-size: 12px; margin-bottom: 8px; }
/* Diff preview */
.ae-diff-summary {
  padding: 12px 14px; border-radius: 10px;
  background: rgba(213, 199, 135, 0.1); border: 1px solid rgba(213, 199, 135, 0.25);
  margin-bottom: 14px;
}
.ae-diff-title { font-size: 13px; font-weight: 700; color: var(--ink); margin-bottom: 6px; }
.ae-diff-body { font-size: 12px; color: var(--ink2); line-height: 1.7; white-space: pre-line; }
.ae-diff-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 8px; }
.ae-diff-col {
  border: 1px solid var(--border); border-radius: 10px; overflow: hidden;
}
.ae-diff-col-title {
  padding: 6px 10px; font-size: 11px; font-weight: 700;
  background: var(--surface-alt); color: var(--ink3);
  border-bottom: 1px solid var(--border);
}
.ae-diff-new .ae-diff-col-title { background: rgba(46, 125, 50, 0.08); color: #2e7d32; }
.ae-diff-pre {
  padding: 10px; font-size: 11px; line-height: 1.6;
  color: var(--ink2); white-space: pre-wrap; word-break: break-all;
  max-height: 250px; overflow-y: auto; margin: 0;
  font-family: 'SF Mono', 'Fira Code', monospace;
}
/* Test output */
.ae-test-output {
  border: 1px solid var(--border); border-radius: 10px; overflow: hidden;
}
.ae-test-output-title {
  padding: 6px 10px; font-size: 11px; font-weight: 700;
  background: rgba(46, 125, 50, 0.08); color: #2e7d32;
  border-bottom: 1px solid var(--border);
}
.ae-test-output-body {
  padding: 12px; font-size: 13px; line-height: 1.7;
  color: var(--ink1); white-space: pre-wrap; word-break: break-word;
  max-height: 300px; overflow-y: auto; margin: 0;
}
</style>

<script setup lang="ts">
/**
 * AgentWizard.vue — 引导式搭子创建（V5 简化版）
 *
 * 3 步流程：
 *   Step 1: 选择创建方式 + 上传参考资料 / 描述用途
 *   Step 2: AI 追问关键问题
 *   Step 3: 预览 SKILL.md + 名字 + 触发词（AI 自动生成，用户可修改）→ 保存
 */
import { ref, computed } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import { resolveApiConfig, buildHeaders } from '@/utils/api'
import type { SkillConfig } from '@/types/skill'
import { parseSkillMd } from '@/types/skill'
import { processFile } from '@/composables/useFileUpload'

const emit = defineEmits<{ (e: 'close'): void }>()
const store = useAgentStore()

// ─── Wizard state ───
const step = ref(1)
const hasReference = ref<null | boolean>(null)
const referenceText = ref('')
const referenceUrl = ref('')
const githubUrl = ref('')
const purposeText = ref('')
const outputFormat = ref('')
// 上传文件（Phase 2 新增）
const uploadedFileName = ref('')
// AI 追问（Phase 2 新增）
const followupQuestions = ref('')
const followupAnswers = ref('')
// 生成结果
const triggers = ref('')
const skillName = ref('')
const isGenerating = ref(false)
const generatedSkillMd = ref('')
const errorMsg = ref('')

const step1Mode = computed(() => {
  if (hasReference.value === null) return 'choose'
  return hasReference.value ? 'reference' : 'describe'
})

// ─── 文件上传处理（统一走 processFile） ───
const isUploading = ref(false)

async function handleFileUpload(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  uploadedFileName.value = file.name
  isUploading.value = true

  try {
    const result = await processFile(file, { maxTextLength: 8000 })
    if (result.textContent) {
      referenceText.value = result.textContent
    } else {
      referenceText.value = '[文件解析失败，请粘贴文本内容]'
    }
  } catch {
    referenceText.value = '[文件解析失败，请粘贴文本内容]'
  } finally {
    isUploading.value = false
  }
}

// ─── Step 1 → Step 2: AI 生成追问 ───
async function generateFollowup() {
  isGenerating.value = true
  errorMsg.value = ''
  try {
    const config = await resolveApiConfig()
    const desc = hasReference.value
      ? `参考资料概要: ${referenceText.value.slice(0, 500)}`
      : `用途: ${purposeText.value}\n输出规范: ${outputFormat.value}`

    const res = await fetch(`${config.apiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify({
        model: config.model || 'claude-sonnet-4-6',
        messages: [
          {
            role: 'system',
            content: '你是搭子创建助手。请针对用户要创建的搭子，只输出 2-3 个关键追问，每行一个问题，不要加解释，不要加标题，不要编号超过 3 条。如果用户已经上传资料且资料里已有答案，就不要重复追问。'
          },
          { role: 'user', content: `我要创建的搭子需求是：${desc}` }
        ],
        temperature: 0.3,
        max_tokens: 300,
        stream: false,
      }),
    })
    if (!res.ok) throw new Error(`API 错误: ${res.status}`)
    const data = await res.json()
    followupQuestions.value = data.choices?.[0]?.message?.content || '暂无追问'
    step.value = 2
  } catch (e: any) {
    errorMsg.value = e.message || '生成追问失败'
  } finally {
    isGenerating.value = false
  }
}

// ─── Step 2 → Step 3: 生成 SKILL.md ───
async function generateSkillMd() {
  isGenerating.value = true
  errorMsg.value = ''
  try {
    const config = await resolveApiConfig()
    let userMsg = ''
    if (hasReference.value) {
      userMsg = `## 参考资料\n${referenceText.value}\n\n${referenceUrl.value ? '## 参考链接\n' + referenceUrl.value : ''}\n\n## 补充说明\n${followupAnswers.value || '无'}`
    } else {
      userMsg = `## 用途\n${purposeText.value}\n\n## 期望的输出规范\n${outputFormat.value}\n\n## 补充说明\n${followupAnswers.value || '无'}`
    }

    const toolHint = `\n\n如果搭子需要处理文档文件，可以声明使用以下后端工具：
- office_create: 创建文档(docx/pdf/xlsx)
- office_read: 读取文档内容
- office_convert: 格式转换(如docx转pdf)
- office_execute: 执行Python/JS代码处理文档
在 SKILL.md 中用 ## 可用工具 段落声明它们。`

    const metaInstruction = `

## 重要：额外输出元信息
在 SKILL.md body 之后，另起一行输出以下 JSON（用 \`\`\`json 包裹）：
\`\`\`json
{"suggestedName": "2-4个字的搭子名", "suggestedTriggers": ["触发词1", "触发词2", "触发词3"]}
\`\`\`
- suggestedName: 简洁有力，2-4个字，比如"小红书文案"、"数据分析师"、"翻译官"
- suggestedTriggers: 3-5 个关键词，用户说出这些词时自动召唤搭子`

    const sysPrompt = hasReference.value
      ? `你是韭菜盒子搭子创建引擎。用户提供了参考资料和补充说明。
请生成一份高质量的 SKILL.md body（不含 frontmatter），结构如下：

## 角色定义
用一句话定义搭子的身份和核心价值。避免泛泛的"你是一个AI助手"。

## 核心规则
从参考资料中提取 3-7 条具体的、可执行的规则。每条规则要有明确的判断标准。

## 工作流程
分步骤描述搭子的工作流程。每步要有明确的输入和输出。

## 输出格式
用代码块或模板展示期望的输出格式。要具体，不要只说"格式清晰"。

## 边界
明确什么不该做、什么情况下应该拒绝或要求澄清。${toolHint}${metaInstruction}`
      : `你是韭菜盒子搭子创建引擎。用户描述了想让搭子做什么，并补充了细节。
请生成一份高质量的 SKILL.md body（不含 frontmatter），结构如下：

## 角色定义
用一句话定义搭子的身份和核心价值。要具体，避免"你是一个AI助手"。

## 工作流程
分步骤描述工作流程，每步有明确的输入/输出。

## 输出格式
用代码块或模板展示输出格式。用户说的"输出规范"转化为可执行的模板。

## 规则约束
3-5 条关键规则，每条具体可执行。

## 边界
什么不该做、什么要拒绝。${toolHint}${metaInstruction}`

    const res = await fetch(`${config.apiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify({
        model: config.model || 'claude-sonnet-4-6',
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: userMsg },
        ],
        temperature: 0.4,
        max_tokens: 3000,
        stream: false,
      }),
    })
    if (!res.ok) throw new Error(`API 错误: ${res.status}`)
    const data = await res.json()
    let raw = data.choices?.[0]?.message?.content || ''

    // 提取 JSON 元信息（名字 + 触发词）
    const metaMatch = raw.match(/```json\s*\n?\{[\s\S]*?"suggestedName"[\s\S]*?\}\s*\n?```/)
    if (metaMatch) {
      try {
        const metaJson = metaMatch[0].replace(/```json\s*\n?/, '').replace(/\n?```/, '').trim()
        const meta = JSON.parse(metaJson)
        if (meta.suggestedName) skillName.value = meta.suggestedName
        if (Array.isArray(meta.suggestedTriggers)) triggers.value = meta.suggestedTriggers.join(', ')
      } catch { /* 解析失败忽略，用户手填 */ }
      // 从正文中移除 JSON 块
      raw = raw.replace(metaMatch[0], '').trim()
    }

    generatedSkillMd.value = raw
      .replace(/^```markdown\n?/, '').replace(/\n?```$/, '').trim()
    step.value = 3
  } catch (e: any) {
    errorMsg.value = e.message || '生成失败'
  } finally {
    isGenerating.value = false
  }
}

// ─── GitHub 导入 ───
async function importFromGitHub() {
  if (!githubUrl.value.trim()) return
  isGenerating.value = true
  errorMsg.value = ''
  try {
    let rawUrl = githubUrl.value.trim()
    if (rawUrl.includes('github.com') && !rawUrl.includes('raw.githubusercontent.com')) {
      rawUrl = rawUrl.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/')
    }
    if (!rawUrl.endsWith('SKILL.md') && !rawUrl.endsWith('README.md')) {
      rawUrl = rawUrl.replace(/\/$/, '') + '/main/SKILL.md'
    }
    const res = await fetch(rawUrl)
    if (!res.ok) throw new Error(`获取失败: ${res.status}`)
    const text = await res.text()
    const parsed = parseSkillMd(text)
    skillName.value = parsed.name || ''
    triggers.value = (parsed.triggers || []).join(', ')
    generatedSkillMd.value = parsed.skillContent || ''
    step.value = 3
  } catch (e: any) {
    errorMsg.value = `导入失败: ${e.message}`
  } finally {
    isGenerating.value = false
  }
}

// ─── 批量导入（扫描文件/文件夹） ───
const batchResults = ref<Array<{ name: string; content: string; type: string }>>([])
const batchDragging = ref(false)
const batchImporting = ref(false)

function isSkillFile(name: string): boolean {
  return /\.(md|txt|json)$/i.test(name)
}

function detectSkillContent(text: string, fileName: string): { name: string; content: string; type: string } | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length < 20) return null

  // SKILL.md 格式（有 frontmatter）
  if (trimmed.startsWith('---\n')) {
    const parsed = parseSkillMd(trimmed)
    return { name: parsed.name || fileName.replace(/\.\w+$/, ''), content: parsed.skillContent || trimmed, type: 'SKILL.md' }
  }

  // JSON 数组（旧版导出）
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed)
      if (Array.isArray(arr) && arr.length > 0 && (arr[0].systemPrompt || arr[0].prompt || arr[0].skillContent)) {
        return { name: `${fileName} (${arr.length}个)`, content: trimmed, type: 'JSON批量' }
      }
    } catch {}
  }

  // JSON 单个对象
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed)
      if (obj.systemPrompt || obj.prompt || obj.skillContent || obj.name) {
        return { name: obj.name || fileName.replace(/\.\w+$/, ''), content: obj.systemPrompt || obj.prompt || obj.skillContent || '', type: 'JSON' }
      }
    } catch {}
  }

  // 纯文本系统提示词（包含角色定义特征）
  if (trimmed.length > 50 && (/你是|角色|##\s|工作流|输出格式/i.test(trimmed) || /^#\s/m.test(trimmed))) {
    return { name: fileName.replace(/\.\w+$/, ''), content: trimmed, type: '提示词' }
  }

  return null
}

async function handleBatchFiles(files: FileList | File[]) {
  batchResults.value = []
  batchImporting.value = true
  errorMsg.value = ''

  const results: Array<{ name: string; content: string; type: string }> = []

  for (const file of Array.from(files)) {
    if (!isSkillFile(file.name)) continue
    try {
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('读取失败'))
        reader.readAsText(file)
      })
      const detected = detectSkillContent(text, file.name)
      if (detected) results.push(detected)
    } catch {}
  }

  batchResults.value = results
  batchImporting.value = false
  if (results.length === 0) {
    errorMsg.value = '未找到可识别的搭子文件'
  }
}

function handleBatchSelect(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files) handleBatchFiles(input.files)
  input.value = ''
}

function handleBatchDrop(e: DragEvent) {
  e.preventDefault()
  batchDragging.value = false
  const items = e.dataTransfer?.items
  if (!items) return

  const files: File[] = []
  const readEntry = (entry: FileSystemEntry): Promise<void> => {
    return new Promise(resolve => {
      if (entry.isFile) {
        (entry as FileSystemFileEntry).file(f => { files.push(f); resolve() })
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader()
        reader.readEntries(async entries => {
          for (const e of entries) await readEntry(e)
          resolve()
        })
      } else { resolve() }
    })
  }

  const entries: FileSystemEntry[] = []
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry()
    if (entry) entries.push(entry)
  }

  Promise.all(entries.map(readEntry)).then(() => handleBatchFiles(files))
}

function confirmBatchImport() {
  let count = 0
  for (const item of batchResults.value) {
    if (item.type === 'JSON批量') {
      count += store.importFromJSON(item.content)
    } else {
      store.importFromText(item.content, item.name)
      count++
    }
  }
  batchResults.value = []
  errorMsg.value = ''
  if (count > 0) {
    emit('close')
  }
}

// ─── 保存搭子 ───
function saveSkill() {
  if (!skillName.value.trim()) { errorMsg.value = '请给搭子起个名字'; return }
  const skill: SkillConfig = {
    id: 'skill_' + Date.now().toString(36),
    name: skillName.value.trim(),
    description: generatedSkillMd.value.slice(0, 120),
    triggers: triggers.value.split(/[,，]/).map(t => t.trim()).filter(Boolean),
    skillContent: generatedSkillMd.value,
    references: referenceUrl.value ? [referenceUrl.value] : [],
    examples: [],
    version: 1,
    source: githubUrl.value ? 'github' : 'user',
    githubUrl: githubUrl.value || undefined,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    evolutionLog: [],
  }
  store.createAgent(skill)
  store.moveToMy(skill.id)
  store.selectAgent(skill.id)
  emit('close')
}
</script>

<template>
  <div class="wizard-panel">
    <div class="wizard-head">
      <span class="mso">build_circle</span>
      <span>创建搭子</span>
    </div>

    <!-- Progress bar -->
    <div class="wizard-progress">
      <div v-for="i in 3" :key="i" class="wizard-dot" :class="{ active: step >= i }">{{ i }}</div>
    </div>

    <!-- Step 1: 收集信息 -->
    <div v-if="step === 1" class="wizard-body">
      <!-- 先选模式 -->
      <div v-if="step1Mode === 'choose'" class="wizard-choose">
        <h3>你有没有参考资料或标准答案？</h3>
        <p class="wizard-hint">如果你有"正确的范文"，搭子能学会你想要的输出风格。</p>
        <div class="wizard-choice-row">
          <button class="wizard-choice" @click="hasReference = true">
            <span class="mso">description</span>
            <span>有，我来发给你</span>
          </button>
          <button class="wizard-choice" @click="hasReference = false">
            <span class="mso">edit_note</span>
            <span>没有，我来描述</span>
          </button>
        </div>
        <div class="wizard-github-section">
          <div class="wizard-divider"><span>或者</span></div>
          <div class="wizard-github-row">
            <input v-model="githubUrl" class="wizard-input" placeholder="粘贴 GitHub 仓库 URL（含 SKILL.md）" />
            <button class="wizard-btn-sm" :disabled="isGenerating" @click="importFromGitHub">
              {{ isGenerating ? '导入中...' : '导入' }}
            </button>
          </div>
        </div>

        <!-- 批量导入区域 -->
        <div class="wizard-batch-section">
          <div class="wizard-divider"><span>批量导入旧搭子</span></div>
          <div class="wizard-batch-drop"
               :class="{ dragging: batchDragging }"
               @dragover.prevent="batchDragging = true"
               @dragleave.prevent="batchDragging = false"
               @drop="handleBatchDrop">
            <span class="mso" style="font-size:28px;color:var(--olive)">folder_open</span>
            <span class="wizard-batch-text">拖拽文件夹或文件到这里</span>
            <label class="wizard-batch-btn">
              <span class="mso" style="font-size:14px">upload</span> 选择文件
              <input type="file" multiple accept=".md,.txt,.json" @change="handleBatchSelect" hidden />
            </label>
            <span class="wizard-batch-hint">支持 SKILL.md、系统提示词、JSON 导出文件</span>
          </div>

          <!-- 扫描结果 -->
          <div v-if="batchImporting" class="wizard-batch-loading">
            <span class="wizard-batch-spinner"></span> 扫描中...
          </div>
          <div v-if="batchResults.length > 0" class="wizard-batch-results">
            <div class="wizard-batch-count">找到 {{ batchResults.length }} 个搭子</div>
            <div v-for="(r, i) in batchResults" :key="i" class="wizard-batch-item">
              <span class="wizard-batch-item-name">{{ r.name }}</span>
              <span class="wizard-batch-item-type">{{ r.type }}</span>
            </div>
            <button class="wizard-btn-primary" @click="confirmBatchImport" style="margin-top:12px;width:100%">
              一键导入全部 ({{ batchResults.length }})
            </button>
          </div>
        </div>
      </div>

      <!-- 有参考资料 -->
      <div v-else-if="step1Mode === 'reference'" class="wizard-ref">
        <h3>发给我你的参考资料或标准答案</h3>
        <p class="wizard-hint">搭子会分析这些内容，学会你想要的输出规则和风格。</p>
        <textarea v-model="referenceText" class="wizard-textarea" rows="6" placeholder="粘贴参考资料/标准答案..."></textarea>
        <!-- 文件上传（Phase 2 新增） -->
        <div class="wizard-upload-row">
          <label class="wizard-upload-btn" :class="{ uploading: isUploading }">
            <span class="mso" style="font-size:16px">{{ isUploading ? 'progress_activity' : 'upload_file' }}</span>
            {{ isUploading ? '解析中...' : (uploadedFileName || '上传文件（TXT/MD/PDF/DOCX/XLSX/PPTX）') }}
            <input type="file" accept=".txt,.md,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.json" @change="handleFileUpload" hidden :disabled="isUploading" />
          </label>
        </div>
        <input v-model="referenceUrl" class="wizard-input" placeholder="参考链接（可选）" style="margin-top:8px" />
        <div class="wizard-actions">
          <button class="wizard-btn-back" @click="hasReference = null">← 返回</button>
          <button class="wizard-btn-primary" :disabled="!referenceText.trim() || isGenerating" @click="generateFollowup">
            {{ isGenerating ? '分析中...' : '下一步 →' }}
          </button>
        </div>
      </div>

      <!-- 没有参考资料 -->
      <div v-else class="wizard-desc">
        <h3>想让这个搭子帮你做什么？</h3>
        <p class="wizard-hint">用一句话描述，比如"帮我写小红书种草文案"。</p>
        <textarea v-model="purposeText" class="wizard-textarea" rows="3" placeholder="帮我做什么..."></textarea>
        <h3>输出什么样的内容算合格？</h3>
        <textarea v-model="outputFormat" class="wizard-textarea" rows="3" placeholder="比如：300-500字，口语化，带emoji..."></textarea>
        <div class="wizard-actions">
          <button class="wizard-btn-back" @click="hasReference = null">← 返回</button>
          <button class="wizard-btn-primary" :disabled="!purposeText.trim() || isGenerating" @click="generateFollowup">
            {{ isGenerating ? '分析中...' : '下一步 →' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Step 2: AI 追问（Phase 2 新增） -->
    <div v-if="step === 2" class="wizard-body">
      <h3>🤖 AI 还想了解几个问题</h3>
      <p class="wizard-hint">回答越详细，搭子就越聪明（也可以跳过直接生成）。</p>
      <div class="wizard-followup-q">{{ followupQuestions }}</div>
      <textarea v-model="followupAnswers" class="wizard-textarea" rows="4" placeholder="你的回答..."></textarea>
      <div class="wizard-actions">
        <button class="wizard-btn-back" @click="step = 1">← 返回</button>
        <button class="wizard-btn-ghost" :disabled="isGenerating" @click="followupAnswers = ''; generateSkillMd()">跳过</button>
        <button class="wizard-btn-primary" :disabled="isGenerating" @click="generateSkillMd">
          {{ isGenerating ? '生成中...' : '生成搭子 →' }}
        </button>
      </div>
    </div>

    <!-- Step 3: 名字 + 触发词 + 预览 → 保存 -->
    <div v-if="step === 3" class="wizard-body">
      <h3>搭子名字</h3>
      <p class="wizard-hint">AI 帮你取了个名，你也可以改。</p>
      <input v-model="skillName" class="wizard-input" placeholder="比如：小红书文案" />

      <h3>什么时候自动叫它出来？</h3>
      <p class="wizard-hint">填几个关键词（逗号隔开），当你的消息包含这些词时，搭子会自动接手。</p>
      <input v-model="triggers" class="wizard-input" placeholder="比如：小红书, 种草, 文案" />

      <h3>搭子能力预览</h3>
      <div class="wizard-preview">{{ generatedSkillMd.slice(0, 500) }}{{ generatedSkillMd.length > 500 ? '...' : '' }}</div>

      <div class="wizard-actions">
        <button class="wizard-btn-back" @click="step = 2">← 返回</button>
        <button class="wizard-btn-primary" :disabled="!skillName.trim() || !triggers.trim()" @click="saveSkill">✅ 创建搭子</button>
      </div>
    </div>

    <!-- Error -->
    <div v-if="errorMsg" class="wizard-error">{{ errorMsg }}</div>
  </div>
</template>

<style scoped>
.wizard-panel {
  height: 100%; display: flex; flex-direction: column;
  background: var(--surface); overflow-y: auto;
}
.wizard-head {
  display: flex; align-items: center; gap: 8px;
  padding: 16px 20px;
  font-size: 16px; font-weight: 700; color: var(--ink1);
  border-bottom: 1px solid var(--line);
}
.wizard-head .mso { font-size: 22px; color: var(--olive); }
.wizard-progress {
  display: flex; justify-content: center; gap: 12px; padding: 16px;
}
.wizard-dot {
  width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700;
  background: var(--line); color: var(--ink3);
  transition: all .2s;
}
.wizard-dot.active { background: var(--olive); color: #fff; }
.wizard-body { padding: 0 20px 20px; }
.wizard-body h3 {
  font-size: 15px; font-weight: 700; color: var(--ink1);
  margin: 16px 0 4px;
}
.wizard-hint { font-size: 13px; color: var(--ink3); margin: 0 0 12px; }
.wizard-choose { text-align: center; }
.wizard-choice-row { display: flex; gap: 12px; margin: 20px 0; }
.wizard-choice {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; gap: 8px;
  padding: 20px; border-radius: 12px;
  border: 2px solid var(--line);
  background: var(--paper); cursor: pointer;
  font-size: 14px; font-weight: 600; color: var(--ink1);
  transition: all .15s; font-family: inherit;
}
.wizard-choice:hover { border-color: var(--olive); background: var(--bg); }
.wizard-choice .mso { font-size: 32px; color: var(--olive); }
.wizard-github-section { margin-top: 16px; }
.wizard-divider {
  display: flex; align-items: center; gap: 12px;
  color: var(--ink3); font-size: 12px; margin: 12px 0;
}
.wizard-divider::before, .wizard-divider::after {
  content: ''; flex: 1; height: 1px; background: var(--line);
}
.wizard-github-row { display: flex; gap: 8px; }
.wizard-input {
  flex: 1; padding: 10px 14px; border-radius: 8px;
  border: 1.5px solid var(--line); background: var(--bg);
  font-size: 14px; color: var(--ink1); font-family: inherit;
  outline: none; width: 100%; box-sizing: border-box;
}
.wizard-input:focus { border-color: var(--olive); }
.wizard-textarea {
  width: 100%; padding: 10px 14px; border-radius: 8px;
  border: 1.5px solid var(--line); background: var(--bg);
  font-size: 14px; color: var(--ink1); font-family: inherit;
  resize: vertical; outline: none; box-sizing: border-box;
}
.wizard-textarea:focus { border-color: var(--olive); }
/* 上传按钮 */
.wizard-upload-row { margin-top: 8px; }
.wizard-upload-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 8px;
  border: 1.5px dashed var(--line); background: var(--bg);
  font-size: 13px; color: var(--ink2); cursor: pointer;
  transition: all .15s;
}
.wizard-upload-btn:hover { border-color: var(--olive); color: var(--olive); }
.wizard-upload-btn.uploading { border-color: var(--olive); color: var(--olive); animation: upload-pulse 1.5s ease infinite; }
@keyframes upload-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .6; } }
/* AI 追问 */
.wizard-followup-q {
  padding: 12px 14px; border-radius: 10px;
  background: rgba(213, 199, 135, 0.08); border: 1px solid rgba(213, 199, 135, 0.2);
  font-size: 13px; color: var(--ink1); line-height: 1.8;
  margin-bottom: 12px; white-space: pre-wrap;
}
/* Buttons */
.wizard-btn-sm {
  padding: 10px 18px; border-radius: 8px; border: none;
  background: var(--olive); color: #fff;
  font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit;
  white-space: nowrap;
}
.wizard-btn-sm:disabled { opacity: .5; cursor: not-allowed; }
.wizard-actions { display: flex; gap: 12px; margin-top: 20px; justify-content: flex-end; }
.wizard-btn-back {
  padding: 10px 18px; border-radius: 8px;
  border: 1.5px solid var(--line); background: var(--paper);
  color: var(--ink2); font-size: 13px; font-weight: 600;
  cursor: pointer; font-family: inherit;
}
.wizard-btn-ghost {
  padding: 10px 18px; border-radius: 8px;
  border: none; background: none;
  color: var(--ink3); font-size: 13px; font-weight: 600;
  cursor: pointer; font-family: inherit; text-decoration: underline;
}
.wizard-btn-primary {
  padding: 10px 24px; border-radius: 8px; border: none;
  background: var(--olive); color: #fff;
  font-size: 14px; font-weight: 700; cursor: pointer; font-family: inherit;
}
.wizard-btn-primary:disabled { opacity: .5; cursor: not-allowed; }
.wizard-preview {
  padding: 12px; border-radius: 8px;
  background: var(--bg); border: 1px solid var(--line);
  font-size: 12px; color: var(--ink2);
  white-space: pre-wrap; max-height: 200px; overflow-y: auto;
  font-family: monospace;
}
.wizard-error {
  margin: 12px 20px 20px;
  padding: 10px 14px; border-radius: 8px;
  background: #fff0f0; color: #c00; font-size: 13px;
}

/* 批量导入 */
.wizard-batch-section { margin-top: 16px; }
.wizard-batch-drop {
  margin-top: 12px; padding: 24px 16px;
  border: 2px dashed var(--line); border-radius: 12px;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  transition: all .2s; background: var(--bg);
}
.wizard-batch-drop.dragging { border-color: var(--olive); background: rgba(107,142,35,.06); }
.wizard-batch-text { font-size: 13px; color: var(--ink2); font-weight: 600; }
.wizard-batch-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 14px; border-radius: 6px;
  border: 1px solid var(--olive); background: transparent;
  color: var(--olive); font-size: 12px; font-weight: 600;
  cursor: pointer; font-family: inherit;
}
.wizard-batch-btn:hover { background: var(--olive); color: #fff; }
.wizard-batch-hint { font-size: 11px; color: var(--ink3); }
.wizard-batch-loading {
  display: flex; align-items: center; gap: 8px;
  padding: 12px; font-size: 13px; color: var(--ink2);
}
.wizard-batch-spinner {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid var(--line); border-top-color: var(--olive);
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.wizard-batch-results {
  margin-top: 12px; padding: 12px; border-radius: 8px;
  border: 1px solid var(--line); background: var(--paper);
}
.wizard-batch-count { font-size: 13px; font-weight: 700; color: var(--olive); margin-bottom: 8px; }
.wizard-batch-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 8px; border-radius: 6px; margin-bottom: 4px;
  background: var(--surface);
}
.wizard-batch-item-name { font-size: 12px; font-weight: 600; color: var(--ink1); }
.wizard-batch-item-type { font-size: 10px; color: var(--ink3); padding: 1px 6px; border-radius: 4px; background: var(--bg); }
</style>

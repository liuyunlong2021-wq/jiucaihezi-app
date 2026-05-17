<script setup lang="ts">
/**
 * VaultWizard — 知识库创建向导
 *
 * 三条路径：
 *   1. 有资料创建 → 上传 → LLM 分析追问 → 生成结构
 *   2. 无资料创建 → 三轮问卷 → 生成结构
 *   3. 使用内置模板 → 直接创建
 */
import { ref, computed } from 'vue'
import { useVaultStore } from '@/stores/vaultStore'
import { useAgentStore, inferModelTier, VAULT_RECOMMENDED_TIER } from '@/stores/agentStore'
import { VAULT_TEMPLATES } from '@/data/vaultTemplates'
import type { VaultTemplate } from '@/data/vaultTemplates'
import { callLLM } from '@/utils/api'
import { processFile } from '@/composables/useFileUpload'

const vaultStore = useVaultStore()
const agentStore = useAgentStore()

const step = ref(0) // 0=选择方式, 1=填写信息, 2=预览结构, 3=完成
const mode = ref<'upload' | 'describe' | 'template' | ''>('')
const isLoading = ref(false)
const error = ref('')

// 模型 tier 提示
const currentTier = computed(() => inferModelTier(agentStore.currentModel))
const showModelWarning = computed(() => currentTier.value === 'light')

// ─── 有资料模式 ───
const uploadedFiles = ref<Array<{ name: string; content: string }>>([])
const aiQuestions = ref<string[]>([])
const aiAnswers = ref<string[]>([])

// ─── 无资料模式：三轮问卷 ───
const q1Role = ref('')
const q1Goal = ref('')
const q2Options = ref<string[]>([])
const q2Classification = ref('')
const q2Generated = ref(false) // 第二轮是否已生成
const q2Questions = ref<Array<{ label: string; options: string[] }>>([])
const q3Name = ref('')
const q3Desc = ref('')
const q3Keywords = ref('')

// ─── 模板模式 ───
const selectedTemplate = ref<VaultTemplate | null>(null)

// ─── 生成结果 ───
const generatedResult = ref<{
  name: string
  oneLineDesc: string
  keywords: string[]
  claudeMd: string
  rawFolders: string[]
  wikiFolders: string[]
} | null>(null)

const successMessage = ref('')

/** 从 LLM 回复中提取 JSON（兼容 markdown 代码块包裹） */
function extractJson(text: string): string {
  // 尝试匹配 ```json ... ``` 或 ``` ... ```
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlock) return codeBlock[1].trim()
  // 尝试匹配第一个 { ... } 块
  const braceMatch = text.match(/\{[\s\S]*\}/)
  if (braceMatch) return braceMatch[0]
  return text.trim()
}

function selectMode(m: 'upload' | 'describe' | 'template') {
  mode.value = m
  step.value = 1
  error.value = ''
}

function goBack() {
  if (step.value > 0) step.value--
  if (step.value === 0) {
    mode.value = ''
    error.value = ''
  }
}

// ─── 文件上传处理（统一走 processFile） ───
const isFileProcessing = ref(false)

async function handleFileUpload(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files) return
  isFileProcessing.value = true
  error.value = ''
  for (const file of Array.from(input.files)) {
    try {
      const result = await processFile(file, { maxTextLength: 10000 })
      if (result.textContent) {
        uploadedFiles.value.push({ name: file.name, content: result.textContent })
      } else if (result.status === 'error') {
        error.value = `${file.name} 解析失败: ${result.error || '未知错误'}`
      } else {
        // PDF/Office 二进制文件不能用 file.text() 回退（会产生乱码）
        const isBinary = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|rtf)$/i.test(file.name)
        if (isBinary) {
          error.value = `${file.name} 解析失败：后端文档提取服务不可用，请确认网络或稍后重试`
        } else {
          const text = await file.text()
          if (text && !/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 500))) {
            uploadedFiles.value.push({ name: file.name, content: text.slice(0, 10000) })
          } else {
            error.value = `${file.name} 无法读取内容`
          }
        }
      }
    } catch (err: any) {
      error.value = `${file.name} 处理失败: ${err.message}`
    }
  }
  isFileProcessing.value = false
}

// ─── 有资料：LLM 分析并追问 ───
async function analyzeUploads() {
  if (uploadedFiles.value.length === 0) return
  isLoading.value = true
  error.value = ''
  try {
    const filesPreview = uploadedFiles.value
      .map(f => `### ${f.name}\n${f.content.slice(0, 2000)}`)
      .join('\n\n')

    const resp = await callLLM({
      model: agentStore.currentModel,
      systemPrompt: `你是知识库架构师。用户上传了一些资料，请分析资料内容，然后提出 2-3 个关键追问，帮助你设计最适合的知识库结构。
只输出 JSON，不要输出其他内容：{"questions":["问题1","问题2","问题3"]}`,
      userMessage: `我上传了以下资料，请分析并追问：\n\n${filesPreview}`,
      temperature: 0.3,
      maxTokens: 500,
    })
    const parsed = JSON.parse(extractJson(resp))
    aiQuestions.value = parsed.questions || []
    aiAnswers.value = new Array(aiQuestions.value.length).fill('')
    step.value = 2 // 进入追问步骤
  } catch (err: any) {
    error.value = '分析失败：' + (err?.message || '请重试')
  }
  isLoading.value = false
}

// ─── 有资料：根据追问答案生成结构 ───
async function generateFromUploads() {
  isLoading.value = true
  error.value = ''
  try {
    const filesPreview = uploadedFiles.value
      .map(f => `### ${f.name}\n${f.content.slice(0, 1500)}`)
      .join('\n\n')

    const qaText = aiQuestions.value
      .map((q, i) => `Q: ${q}\nA: ${aiAnswers.value[i] || '未回答'}`)
      .join('\n')

    const resp = await callLLM({
      model: agentStore.currentModel,
      systemPrompt: `你是知识库架构师。根据用户资料和回答，生成知识库结构。
输出严格 JSON：
{
  "name": "知识库名称",
  "oneLineDesc": "一句话介绍",
  "keywords": ["关键词1", "关键词2"],
  "claudeMd": "完整的CLAUDE.md配置内容",
  "rawFolders": ["对话记录", "其他raw子目录"],
  "wikiFolders": ["分类1/子分类", "分类2"]
}`,
      userMessage: `资料内容：\n${filesPreview}\n\n追问与回答：\n${qaText}`,
      temperature: 0.3,
      maxTokens: 2000,
    })
    generatedResult.value = JSON.parse(extractJson(resp))
    step.value = 3 // 预览
  } catch (err: any) {
    error.value = '生成失败：' + (err?.message || '请重试')
  }
  isLoading.value = false
}

// ─── 无资料：第一轮完成后生成第二轮问题 ───
async function generateRound2() {
  if (!q1Role.value.trim() || !q1Goal.value.trim()) return
  isLoading.value = true
  error.value = ''
  try {
    const resp = await callLLM({
      model: agentStore.currentModel,
      systemPrompt: `你是知识库架构师。根据用户的角色和目标，生成第二轮追问（2个多选题）。
输出严格 JSON：
{
  "questions": [
    {"label": "你的资料里最重要的是什么？", "options": ["选项1", "选项2", "选项3", "选项4", "选项5"]},
    {"label": "你希望知识库怎么分类？", "options": ["分类方式1", "分类方式2", "分类方式3", "让 AI 自动决定"]}
  ]
}`,
      userMessage: `我是${q1Role.value}，我希望知识库帮我${q1Goal.value}`,
      temperature: 0.3,
      maxTokens: 800,
    })
    const parsed = JSON.parse(extractJson(resp))
    q2Questions.value = parsed.questions || []
    q2Generated.value = true
  } catch (err: any) {
    error.value = '生成问题失败：' + (err?.message || '请重试')
  }
  isLoading.value = false
}

// ─── 无资料：最终生成 ───
async function generateFromDescribe() {
  isLoading.value = true
  error.value = ''
  try {
    const q2Text = q2Questions.value
      .map((q, i) => `Q: ${q.label}\nA: ${q2Options.value[i] || '未选择'}`)
      .join('\n')

    const resp = await callLLM({
      model: agentStore.currentModel,
      systemPrompt: `你是知识库架构师。根据用户信息生成知识库结构。
输出严格 JSON：
{
  "name": "建议名称",
  "oneLineDesc": "一句话介绍",
  "keywords": ["关键词1", "关键词2"],
  "claudeMd": "完整的CLAUDE.md配置内容",
  "rawFolders": ["对话记录", "其他子目录"],
  "wikiFolders": ["分类1/子分类", "分类2"]
}`,
      userMessage: `角色：${q1Role.value}\n目标：${q1Goal.value}\n${q2Text}\n命名：${q3Name.value || '自动'}\n介绍：${q3Desc.value || '自动'}\n关键词：${q3Keywords.value || '自动'}`,
      temperature: 0.3,
      maxTokens: 2000,
    })
    generatedResult.value = JSON.parse(extractJson(resp))
    // 覆盖用户指定的名称
    if (q3Name.value.trim()) generatedResult.value!.name = q3Name.value.trim()
    if (q3Desc.value.trim()) generatedResult.value!.oneLineDesc = q3Desc.value.trim()
    if (q3Keywords.value.trim()) {
      generatedResult.value!.keywords = q3Keywords.value.split(/[,，\s]+/).filter(Boolean)
    }
    step.value = 3 // 预览
  } catch (err: any) {
    error.value = '生成失败：' + (err?.message || '请重试')
  }
  isLoading.value = false
}

// ─── 模板：直接预览 ───
function selectTemplateAndPreview(tpl: VaultTemplate) {
  selectedTemplate.value = tpl
  generatedResult.value = {
    name: tpl.name,
    oneLineDesc: tpl.oneLineDesc,
    keywords: [...tpl.keywords],
    claudeMd: tpl.claudeMd,
    rawFolders: [...tpl.rawFolders],
    wikiFolders: [...tpl.wikiFolders],
  }
  step.value = 3
}

// ─── 最终创建知识库 ───
async function createVault() {
  if (!generatedResult.value) return
  isLoading.value = true
  error.value = ''
  try {
    const r = generatedResult.value
    const vault = await vaultStore.createVault(r.name, 'project', {
      description: r.oneLineDesc,
      oneLineDesc: r.oneLineDesc,
      keywords: r.keywords,
      template: selectedTemplate.value?.id,
      claudeMd: r.claudeMd,
      rawFolders: r.rawFolders,
      wikiFolders: r.wikiFolders,
    })
    vaultStore.setActiveVault(vault.id)

    // 如果有上传资料，存入 raw/
    if (uploadedFiles.value.length > 0) {
      const { useFileStore } = await import('@/composables/useFileStore')
      const fs = useFileStore()
      // 等一下让骨架生成完成
      await new Promise(resolve => setTimeout(resolve, 500))
      const rawFolder = await fs.findVaultRootFolder(vault.id, 'raw')
      if (rawFolder) {
        for (const file of uploadedFiles.value) {
          await fs.addFile({
            category: 'knowledge',
            name: file.name,
            content: file.content,
            mimeType: 'text/plain',
            size: new TextEncoder().encode(file.content).length,
            vaultId: vault.id,
            folderId: rawFolder.id,
            kind: 'raw',
            indexed: false,
            metadata: { vaultFolder: 'raw', kind: 'uploaded-material' },
          })
        }
      }
    }

    successMessage.value = r.name
    step.value = 4
  } catch (err: any) {
    error.value = '创建失败：' + (err?.message || '请重试')
  }
  isLoading.value = false
}

function resetWizard() {
  step.value = 0
  mode.value = ''
  uploadedFiles.value = []
  aiQuestions.value = []
  aiAnswers.value = []
  q1Role.value = ''
  q1Goal.value = ''
  q2Options.value = []
  q2Classification.value = ''
  q2Generated.value = false
  q2Questions.value = []
  q3Name.value = ''
  q3Desc.value = ''
  q3Keywords.value = ''
  selectedTemplate.value = null
  generatedResult.value = null
  successMessage.value = ''
  error.value = ''
}
</script>

<template>
  <div class="vw">
    <!-- 标题 -->
    <div class="vw-head">
      <button v-if="step > 0 && step < 4" class="vw-back" @click="goBack">
        <span class="mso">arrow_back</span>
      </button>
      <h3 class="vw-title">
        {{ step === 4 ? '创建成功' : '创建知识库' }}
      </h3>
    </div>

    <!-- 模型提示 -->
    <div v-if="showModelWarning && step < 4" class="vw-model-hint">
      <span class="mso">tips_and_updates</span>
      <span>知识库质量取决于模型能力，建议使用 <strong>Claude Opus</strong> 或 <strong>GPT-5.4/5.5</strong> 等强力模型</span>
    </div>

    <!-- 错误提示 -->
    <div v-if="error" class="vw-error">
      <span class="mso">error</span> {{ error }}
    </div>

    <!-- Step 0: 选择方式 -->
    <div v-if="step === 0" class="vw-step0">
      <p class="vw-intro">知识库帮你把零散资料变成有结构的知识，AI 会自动从对话中学习并整理。</p>

      <div class="vw-choices">
        <button class="vw-choice" @click="selectMode('upload')">
          <span class="mso vw-choice-icon">upload_file</span>
          <span class="vw-choice-title">有资料创建</span>
          <span class="vw-choice-desc">上传已有资料，AI 分析后生成知识库结构</span>
        </button>

        <button class="vw-choice" @click="selectMode('describe')">
          <span class="mso vw-choice-icon">edit_note</span>
          <span class="vw-choice-title">描述创建</span>
          <span class="vw-choice-desc">回答几个问题，AI 帮你设计知识库结构</span>
        </button>

        <button class="vw-choice" @click="selectMode('template')">
          <span class="mso vw-choice-icon">dashboard</span>
          <span class="vw-choice-title">使用内置模板</span>
          <span class="vw-choice-desc">律师、小说、研究笔记等现成模板</span>
        </button>
      </div>
    </div>

    <!-- Step 1: 有资料 — 上传 -->
    <div v-if="step === 1 && mode === 'upload'" class="vw-step">
      <h4>上传你的资料</h4>
      <p class="vw-hint">支持 TXT、MD、PDF、DOCX、XLSX、PPTX 等文件</p>
      <input type="file" multiple accept=".txt,.md,.pdf,.docx,.doc,.csv,.json,.xlsx,.xls,.pptx,.ppt,.rtf,.odt" @change="handleFileUpload" class="vw-file-input" :disabled="isFileProcessing" />
      <div v-if="isFileProcessing" class="vw-processing">
        <span class="vw-spin"><span class="mso">progress_activity</span></span> 正在解析文件...
      </div>
      <div v-if="uploadedFiles.length > 0" class="vw-uploaded">
        <div v-for="f in uploadedFiles" :key="f.name" class="vw-uploaded-item">
          <span class="mso" style="font-size:14px">description</span>
          {{ f.name }}
        </div>
      </div>
      <button class="vw-btn primary" :disabled="uploadedFiles.length === 0 || isLoading" @click="analyzeUploads">
        <span v-if="isLoading" class="vw-spin">
          <span class="mso">progress_activity</span>
        </span>
        {{ isLoading ? 'AI 分析中...' : '开始分析' }}
      </button>
    </div>

    <!-- Step 2: 有资料 — AI 追问 -->
    <div v-if="step === 2 && mode === 'upload'" class="vw-step">
      <h4>AI 需要了解更多</h4>
      <div v-for="(q, i) in aiQuestions" :key="i" class="vw-qa">
        <label>{{ q }}</label>
        <textarea v-model="aiAnswers[i]" rows="2" placeholder="你的回答..." />
      </div>
      <button class="vw-btn primary" :disabled="isLoading" @click="generateFromUploads">
        {{ isLoading ? '生成中...' : '生成知识库结构' }}
      </button>
    </div>

    <!-- Step 1: 无资料 — 问卷 -->
    <div v-if="step === 1 && mode === 'describe'" class="vw-step">
      <!-- 第一轮 -->
      <div v-if="!q2Generated">
        <h4>第 1 步：告诉我你的需求</h4>
        <div class="vw-qa">
          <label>你是做什么的？</label>
          <input v-model="q1Role" placeholder="例如：律师、小说作者、产品经理..." />
        </div>
        <div class="vw-qa">
          <label>你最希望知识库帮你做什么？</label>
          <input v-model="q1Goal" placeholder="例如：管理案件资料、整理小说设定..." />
        </div>
        <button class="vw-btn primary" :disabled="!q1Role.trim() || !q1Goal.trim() || isLoading" @click="generateRound2">
          {{ isLoading ? 'AI 思考中...' : '下一步' }}
        </button>
      </div>

      <!-- 第二轮 -->
      <div v-else>
        <h4>第 2 步：细化需求</h4>
        <div v-for="(q, i) in q2Questions" :key="i" class="vw-qa">
          <label>{{ q.label }}</label>
          <div class="vw-options">
            <label v-for="opt in q.options" :key="opt" class="vw-option">
              <input type="radio" :name="'q2_' + i" :value="opt" v-model="q2Options[i]" />
              <span>{{ opt }}</span>
            </label>
          </div>
        </div>

        <h4 style="margin-top:16px">第 3 步：命名</h4>
        <div class="vw-qa">
          <label>知识库名称</label>
          <input v-model="q3Name" placeholder="例如：刑事辩护知识库" />
        </div>
        <div class="vw-qa">
          <label>一句话介绍（可选）</label>
          <input v-model="q3Desc" placeholder="AI 可自动生成" />
        </div>
        <div class="vw-qa">
          <label>关键词（逗号分隔，可选）</label>
          <input v-model="q3Keywords" placeholder="律师, 刑事, 辩护" />
        </div>
        <button class="vw-btn primary" :disabled="isLoading" @click="generateFromDescribe">
          {{ isLoading ? '生成中...' : '生成知识库' }}
        </button>
      </div>
    </div>

    <!-- Step 1: 模板选择 -->
    <div v-if="step === 1 && mode === 'template'" class="vw-step">
      <h4>选择一个模板</h4>
      <div class="vw-tpl-grid">
        <button v-for="tpl in VAULT_TEMPLATES" :key="tpl.id" class="vw-tpl-card"
                @click="selectTemplateAndPreview(tpl)">
          <span class="mso vw-tpl-icon">{{ tpl.icon }}</span>
          <span class="vw-tpl-name">{{ tpl.name }}</span>
          <span class="vw-tpl-desc">{{ tpl.oneLineDesc }}</span>
        </button>
      </div>
    </div>

    <!-- Step 3: 预览结构 -->
    <div v-if="step === 3 && generatedResult" class="vw-step">
      <h4>预览知识库结构</h4>
      <div class="vw-preview">
        <div class="vw-preview-name">{{ generatedResult.name }}</div>
        <div class="vw-preview-desc">{{ generatedResult.oneLineDesc }}</div>
        <div class="vw-preview-tree">
          <div class="vw-tree-item root">
            <span class="mso">folder</span> {{ generatedResult.name }}/
          </div>
          <div class="vw-tree-item l1"><span class="mso">description</span> CLAUDE.md</div>
          <div class="vw-tree-item l1"><span class="mso">folder</span> raw/</div>
          <div v-for="f in generatedResult.rawFolders" :key="'r_'+f" class="vw-tree-item l2">
            <span class="mso">folder</span> {{ f }}/
          </div>
          <div class="vw-tree-item l1"><span class="mso">folder</span> wiki/</div>
          <div v-for="f in generatedResult.wikiFolders" :key="'w_'+f" class="vw-tree-item l2">
            <span class="mso">folder</span> {{ f }}/
          </div>
        </div>
        <div v-if="generatedResult.keywords.length" class="vw-preview-tags">
          <span v-for="k in generatedResult.keywords" :key="k" class="vw-tag">{{ k }}</span>
        </div>
      </div>
      <button class="vw-btn primary" :disabled="isLoading" @click="createVault">
        <span v-if="isLoading" class="vw-spin"><span class="mso">progress_activity</span></span>
        {{ isLoading ? '创建中...' : '确认创建' }}
      </button>
    </div>

    <!-- Step 4: 成功 -->
    <div v-if="step === 4" class="vw-step vw-success">
      <span class="mso vw-success-icon">check_circle</span>
      <h4>恭喜你完成「{{ successMessage }}」知识库的创建!</h4>
      <p>你现在可以在输入框上方的知识库选择器中选择这个知识库进行使用。</p>
      <button class="vw-btn" @click="resetWizard">继续创建新知识库</button>
    </div>
  </div>
</template>

<style scoped>
.vw {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px;
  overflow-y: auto;
  gap: 12px;
}
.vw-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.vw-back {
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  border: none; background: none; border-radius: 8px;
  color: var(--ink3); cursor: pointer;
}
.vw-back:hover { background: var(--olive-pale); color: var(--olive-dark); }
.vw-title {
  font-size: 16px; font-weight: 800; color: var(--ink);
  margin: 0;
}
.vw-model-hint {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-radius: 10px;
  background: rgba(251,191,36,.08);
  border: 1px solid rgba(217,119,6,.18);
  font-size: 11px; color: #92400e; font-weight: 600;
}
.vw-model-hint strong { color: #78350f; }
.vw-error {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px; border-radius: 10px;
  background: rgba(239,68,68,.08);
  border: 1px solid rgba(239,68,68,.2);
  font-size: 12px; color: #dc2626; font-weight: 600;
}
.vw-intro {
  font-size: 13px; color: var(--ink3); line-height: 1.6;
  margin: 0 0 12px;
}
.vw-choices {
  display: flex; flex-direction: column; gap: 10px;
}
.vw-choice {
  display: flex; flex-direction: column; gap: 4px;
  padding: 14px 16px; border-radius: 12px;
  border: 1.5px solid var(--border);
  background: var(--surface-alt);
  cursor: pointer; text-align: left; font-family: inherit;
  transition: all .15s;
}
.vw-choice:hover {
  border-color: var(--olive);
  background: rgba(107,142,35,.04);
}
.vw-choice-icon { font-size: 22px; color: var(--olive); }
.vw-choice-title { font-size: 14px; font-weight: 700; color: var(--ink); }
.vw-choice-desc { font-size: 12px; color: var(--ink3); }

.vw-step { display: flex; flex-direction: column; gap: 12px; }
.vw-step h4 { font-size: 14px; font-weight: 700; color: var(--ink); margin: 0; }
.vw-hint { font-size: 12px; color: var(--ink3); margin: 0; }
.vw-file-input {
  font-size: 12px; font-family: inherit;
}
.vw-uploaded { display: flex; flex-direction: column; gap: 4px; }
.vw-uploaded-item {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--olive-dark); font-weight: 600;
  padding: 4px 8px; border-radius: 8px;
  background: rgba(107,142,35,.06);
}
.vw-qa { display: flex; flex-direction: column; gap: 4px; }
.vw-qa label { font-size: 13px; font-weight: 600; color: var(--ink2); }
.vw-qa input, .vw-qa textarea {
  padding: 8px 10px; border: 1px solid var(--border);
  border-radius: 8px; background: var(--surface-alt);
  font-size: 13px; font-family: inherit; color: var(--ink);
  outline: none; resize: vertical;
}
.vw-qa input:focus, .vw-qa textarea:focus { border-color: var(--olive); }
.vw-options { display: flex; flex-direction: column; gap: 6px; padding-left: 4px; }
.vw-option {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; color: var(--ink2); cursor: pointer;
}
.vw-option input[type="radio"] { accent-color: var(--olive); }
.vw-btn {
  padding: 10px 20px; border-radius: 10px;
  font-size: 13px; font-weight: 700; cursor: pointer;
  font-family: inherit; border: 1px solid var(--border);
  background: var(--surface-alt); color: var(--ink2);
  transition: all .15s;
}
.vw-btn.primary {
  background: var(--olive); color: #fff; border-color: var(--olive);
}
.vw-btn.primary:hover { filter: brightness(1.1); }
.vw-btn.primary:disabled { opacity: .5; cursor: default; filter: none; }
.vw-spin { display: inline-flex; animation: vw-rotate 1s linear infinite; }
@keyframes vw-rotate { to { transform: rotate(360deg); } }
.vw-processing {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; font-size: 13px; color: var(--olive);
  font-weight: 600;
}

.vw-tpl-grid { display: flex; flex-direction: column; gap: 8px; }
.vw-tpl-card {
  display: flex; flex-direction: column; gap: 4px;
  padding: 12px 14px; border-radius: 10px;
  border: 1.5px solid var(--border);
  background: var(--surface-alt);
  cursor: pointer; text-align: left; font-family: inherit;
  transition: all .15s;
}
.vw-tpl-card:hover { border-color: var(--olive); background: rgba(107,142,35,.04); }
.vw-tpl-icon { font-size: 20px; color: var(--olive); }
.vw-tpl-name { font-size: 13px; font-weight: 700; color: var(--ink); }
.vw-tpl-desc { font-size: 11px; color: var(--ink3); }

.vw-preview {
  padding: 12px; border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface-alt);
}
.vw-preview-name { font-size: 14px; font-weight: 700; color: var(--ink); }
.vw-preview-desc { font-size: 12px; color: var(--ink3); margin-bottom: 8px; }
.vw-preview-tree { font-size: 12px; font-family: 'SF Mono', monospace; color: var(--ink2); }
.vw-tree-item { display: flex; align-items: center; gap: 4px; padding: 2px 0; }
.vw-tree-item .mso { font-size: 14px; color: var(--olive); }
.vw-tree-item.root { font-weight: 700; color: var(--ink); }
.vw-tree-item.l1 { padding-left: 16px; }
.vw-tree-item.l2 { padding-left: 32px; color: var(--ink3); }
.vw-preview-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.vw-tag {
  padding: 2px 8px; border-radius: 6px;
  background: rgba(107,142,35,.1); color: var(--olive-dark);
  font-size: 11px; font-weight: 600;
}

.vw-success {
  align-items: center; text-align: center;
  padding-top: 40px;
}
.vw-success-icon { font-size: 48px; color: var(--olive); }
.vw-success h4 { font-size: 16px; }
.vw-success p { font-size: 13px; color: var(--ink3); max-width: 300px; }
</style>

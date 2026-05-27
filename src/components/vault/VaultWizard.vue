<script setup lang="ts">
/**
 * VaultWizard — 知识库创建向导
 *
 * 四条路径：
 *   1. 有资料创建 → 上传 → LLM 分析追问 → 生成结构
 *   2. 无资料创建 → 三轮问卷 → 生成结构
 *   3. 使用内置模板 → 直接创建
 *   4. 添加现有知识库内容 → 选择知识库 → 上传资料 → 自动整理为 Wiki
 */
import { ref, computed } from 'vue'
import { useVaultStore } from '@/stores/vaultStore'
import { useAgentStore } from '@/stores/agentStore'
import { useFileStore } from '@/composables/useFileStore'
import { useVaultCompiler } from '@/composables/useVaultCompiler'
import { VAULT_TEMPLATES } from '@/data/vaultTemplates'
import type { VaultTemplate } from '@/data/vaultTemplates'
import { callLLM } from '@/utils/api'
import { convertDocumentToMarkdown } from '@/utils/documentMarkdown'
import { buildVaultScaffold, type VaultSeedPageSpec } from '@/utils/vaultScaffold'
import { buildVaultIngestionPlan, buildVaultIngestionReport, isMeaningfulExtractedText, type VaultIngestionSourceFile } from '@/utils/vaultIngestion'
import { buildFirstWikiDraft, buildFirstWikiReport, mergeFirstWikiDraftSeedPages, type FirstWikiDraft } from '@/utils/vaultFirstWiki'
import { buildCorpusMapMarkdown, scanMarkdownCorpus } from '@/utils/vaultCorpus'
import {
  buildDescribeArchitectureDirections,
  buildUploadArchitectureDirections,
  normalizeWikiArchitectureDirections,
  type WikiArchitectureDirection,
} from '@/utils/vaultArchitecture'
import { emitEvent } from '@/utils/eventBus'

const vaultStore = useVaultStore()
const agentStore = useAgentStore()

const step = ref(0) // 0=选择方式, 1=填写/上传, 2=追问和架构方向, 3=预览结构, 4=完成
const mode = ref<'upload' | 'describe' | 'template' | 'addToVault' | ''>('')
const isLoading = ref(false)
const error = ref('')

// ─── 添加现有知识库内容模式 ───
const addToVaultId = ref('')
const addToVaultFiles = ref<VaultIngestionSourceFile[]>([])
const addToVaultReadyCount = computed(() =>
  addToVaultFiles.value.filter(file => file.status !== 'error' && isMeaningfulExtractedText(file.extractedText || '')).length
)
const addToVaultCompiling = ref(false)
const addToVaultResult = ref('')

const availableVaults = computed(() => vaultStore.vaults)

// ─── 有资料模式 ───
const uploadedFiles = ref<VaultIngestionSourceFile[]>([])
const readyUploadCount = computed(() =>
  uploadedFiles.value.filter(file => file.status !== 'error' && isMeaningfulExtractedText(file.extractedText || '')).length
)
const aiQuestions = ref<string[]>([])
const aiAnswers = ref<string[]>([])
const localFirstWikiDraft = ref<FirstWikiDraft | null>(null)
const wikiDirections = ref<WikiArchitectureDirection[]>([])
const selectedWikiDirectionId = ref('')

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
  rawFolders: string[]
  wikiFolders: string[]
  seedPages: VaultSeedPageSpec[]
  templateRulebook?: string
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

function selectMode(m: 'upload' | 'describe' | 'template' | 'addToVault') {
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

// ─── 添加现有知识库内容：上传并整理 ───

async function handleAddToVaultUpload(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  if (!files.length) return

  addToVaultFiles.value = []
  for (const file of files) {
    const source: VaultIngestionSourceFile = {
      name: file.name,
      size: file.size,
      status: undefined,
      extractedText: '',
    }
    try {
      source.extractedText = await file.text()
      source.status = 'ready'
    } catch {
      source.status = 'error'
    }
    addToVaultFiles.value.push(source)
  }
}

async function compileAddToVault() {
  const vaultId = addToVaultId.value
  if (!vaultId) { error.value = '请先选择知识库'; return }
  if (addToVaultReadyCount.value === 0) { error.value = '没有可用的文件'; return }

  addToVaultCompiling.value = true
  error.value = ''
  addToVaultResult.value = ''
  try {
    const fileStore = useFileStore()
    const { compileRawToWiki } = useVaultCompiler()
    const vault = vaultStore.vaults.find(v => v.id === vaultId)
    const vaultName = vault?.name || '知识库'

    // 1. 上传到 raw/ 目录
    const rawFolder = await fileStore.findVaultRootFolder(vaultId, 'raw')
    let uploadedCount = 0
    for (const file of addToVaultFiles.value) {
      if (file.status === 'error' || !isMeaningfulExtractedText(file.extractedText || '') ) continue
      await fileStore.addFile({
        category: 'knowledge',
        name: file.name,
        content: file.extractedText || '',
        mimeType: 'text/plain',
        size: new TextEncoder().encode(file.extractedText || '').length,
        vaultId,
        folderId: rawFolder?.id,
        kind: 'raw',
        metadata: { vaultFolder: 'raw', manualAdd: true },
      })
      uploadedCount++
    }

    // 2. 编译 raw → wiki
    await compileRawToWiki(vaultId)
    addToVaultResult.value = `已上传 ${uploadedCount} 个文件到「${vaultName}」的 raw/ 目录，并完成整理。`

    // 3. 刷新
    await vaultStore.loadAll()
    emitEvent('refresh-file-list')
  } catch (err: any) {
    error.value = err?.message || '整理失败'
  } finally {
    addToVaultCompiling.value = false
  }
}

function sourceBasePath(source: string): string {
  return String(source || '').replace(/\\/g, '/').split('#')[0].replace(/^\/+|\/+$/g, '')
}

function seedPageHasContent(page: VaultSeedPageSpec): boolean {
  const text = String(page.content || '')
    .replace(/^---[\s\S]*?---/, '')
    .replace(/[#>*_`\-[\]().,，。:：;；\s]/g, '')
    .trim()
  return /[\p{L}\p{N}]/u.test(text) && text.length >= 12
}

function validUploadedSources(): { bases: Set<string>; anchors: Set<string> } {
  if (mode.value !== 'upload' || uploadedFiles.value.length === 0) {
    return { bases: new Set(), anchors: new Set() }
  }
  const plan = buildVaultIngestionPlan({ files: uploadedFiles.value })
  const bases = new Set<string>()
  const anchors = new Set<string>()
  for (const item of plan.items) {
    const base = `${item.markdown.folderPath}/${item.markdown.name}`
    bases.add(base)
    anchors.add(base)
    try {
      const meta = JSON.parse(item.meta.content)
      for (const heading of meta.sourceAnchors || []) {
        if (heading?.anchor) anchors.add(`${base}${heading.anchor}`)
      }
      for (const chunk of meta.chunks || []) {
        if (chunk?.anchor) anchors.add(String(chunk.anchor))
      }
    } catch {}
  }
  return { bases, anchors }
}

function sanitizeSeedPagesForCurrentMode(
  pages: VaultSeedPageSpec[],
  fallbackPages: VaultSeedPageSpec[] = [],
): VaultSeedPageSpec[] {
  const validSources = validUploadedSources()
  const requireUploadedSource = validSources.bases.size > 0
  const result: VaultSeedPageSpec[] = []

  for (const page of pages || []) {
    const path = String(page.path || '').replace(/\\/g, '/').replace(/^wiki\//, '').replace(/^\/+|\/+$/g, '').trim()
    if (!path || !seedPageHasContent(page)) continue
    const sources = (page.sources || [])
      .map(source => String(source || '').trim())
      .filter(Boolean)
      .filter(source => !requireUploadedSource || (
        validSources.bases.has(sourceBasePath(source)) &&
        (!source.includes('#') || validSources.anchors.has(source))
      ))
    if (requireUploadedSource && sources.length === 0) continue
    result.push({
      ...page,
      path: /\.(md|markdown)$/i.test(path) ? path : `${path}.md`,
      sources,
    })
  }

  if (result.length === 0 && fallbackPages.length > 0) {
    return sanitizeSeedPagesForCurrentMode(fallbackPages, [])
  }
  return result
}

function normalizeGeneratedResult(input: any, fallback: Partial<NonNullable<typeof generatedResult.value>> = {}) {
  const name = String(input?.name || fallback.name || q3Name.value || '新项目知识库').trim()
  const oneLineDesc = String(input?.oneLineDesc || input?.description || fallback.oneLineDesc || q3Desc.value || '').trim()
  const keywords = Array.isArray(input?.keywords)
    ? input.keywords.map((k: unknown) => String(k).trim()).filter(Boolean)
    : Array.isArray(fallback.keywords) ? fallback.keywords : []
  const rawFolders = Array.isArray(input?.rawFolders)
    ? input.rawFolders.map((f: unknown) => String(f).trim()).filter(Boolean)
    : Array.isArray(fallback.rawFolders) ? fallback.rawFolders : []
  const wikiFolders = Array.isArray(input?.wikiFolders)
    ? input.wikiFolders.map((f: unknown) => String(f).trim()).filter(Boolean)
    : Array.isArray(fallback.wikiFolders) ? fallback.wikiFolders : []
  const rawSeedPages = Array.isArray(input?.seedPages)
    ? input.seedPages.map((page: any) => ({
        path: String(page?.path || page?.title || '').trim(),
        title: page?.title ? String(page.title).trim() : undefined,
        summary: page?.summary ? String(page.summary).trim() : undefined,
        content: page?.content ? String(page.content).trim() : undefined,
        sources: Array.isArray(page?.sources) ? page.sources.map((s: unknown) => String(s).trim()).filter(Boolean) : [],
        tags: Array.isArray(page?.tags) ? page.tags.map((s: unknown) => String(s).trim()).filter(Boolean) : [],
        confidence: page?.confidence ? String(page.confidence).trim() : undefined,
      })).filter((page: VaultSeedPageSpec) => page.path)
    : Array.isArray(fallback.seedPages) ? fallback.seedPages : []
  const seedPages = sanitizeSeedPagesForCurrentMode(
    rawSeedPages,
    Array.isArray(fallback.seedPages) ? fallback.seedPages : [],
  )

  return {
    name,
    oneLineDesc,
    keywords,
    rawFolders,
    wikiFolders,
    seedPages,
    templateRulebook: String(input?.templateRulebook || input?.rules || fallback.templateRulebook || '').trim() || undefined,
  }
}

const previewScaffold = computed(() => {
  if (!generatedResult.value) return null
  return buildVaultScaffold({
    name: generatedResult.value.name,
    oneLineDesc: generatedResult.value.oneLineDesc,
    keywords: generatedResult.value.keywords,
    rawFolders: generatedResult.value.rawFolders,
    wikiFolders: generatedResult.value.wikiFolders,
    seedPages: generatedResult.value.seedPages,
    templateRulebook: generatedResult.value.templateRulebook,
  })
})

const selectedWikiDirection = computed(() =>
  wikiDirections.value.find(direction => direction.id === selectedWikiDirectionId.value) || wikiDirections.value[0] || null
)

function setWikiDirections(directions: WikiArchitectureDirection[]) {
  wikiDirections.value = directions
  selectedWikiDirectionId.value = directions[0]?.id || ''
}

function buildSelectedDirectionPrompt(): string {
  const direction = selectedWikiDirection.value
  if (!direction) return '用户未选择架构方向，请按资料内容自动决定。'
  return [
    `用户选择的 Wiki 架构方向：${direction.title}`,
    `说明：${direction.description}`,
    `建议栏目：${direction.wikiFolders.join('、')}`,
    `选择理由：${direction.rationale}`,
    `取舍：${direction.tradeoffs}`,
  ].join('\n')
}

function buildLocalFirstWikiDraft(name = '新项目知识库'): FirstWikiDraft | null {
  const plan = buildVaultIngestionPlan({ files: uploadedFiles.value })
  if (plan.items.length === 0) return null
  return buildFirstWikiDraft({
    vaultName: name,
    rawMarkdownFiles: plan.items.map(item => ({
      name: item.markdown.name,
      path: `${item.markdown.folderPath}/${item.markdown.name}`,
      content: item.markdown.content,
    })),
  })
}

function buildUploadedCorpusMap(maxChunks = 10): string {
  const plan = buildVaultIngestionPlan({ files: uploadedFiles.value })
  const scan = scanMarkdownCorpus({
    files: plan.items.map(item => ({
      name: item.markdown.name,
      path: `${item.markdown.folderPath}/${item.markdown.name}`,
      content: item.markdown.content,
      metadata: item.markdown.metadata,
    })),
  })
  return buildCorpusMapMarkdown(scan, {
    maxSources: 12,
    maxHeadings: 80,
    maxChunks,
    perChunkChars: 260,
  })
}

// ─── 文件上传处理（统一走 processFile） ───
const isFileProcessing = ref(false)
const fileProcessingMessage = ref('')

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('读取原文件失败'))
    reader.readAsDataURL(file)
  })
}

async function handleFileUpload(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files) return
  isFileProcessing.value = true
  fileProcessingMessage.value = '正在读取文件...'
  error.value = ''
  try {
    const files = Array.from(input.files)
    for (let index = 0; index < files.length; index++) {
      const file = files[index]
      try {
        fileProcessingMessage.value = `正在解析 ${index + 1}/${files.length}：${file.name}`
        const originalDataUrl = await readFileAsDataUrl(file)
        const converted = await convertDocumentToMarkdown({
          file,
          maxChars: 500000,
          timeoutMs: 1800000,
        })
        if (converted.status === 'success' && isMeaningfulExtractedText(converted.content)) {
          uploadedFiles.value.push({
            name: file.name,
            mimeType: file.type,
            size: file.size,
            sourceType: converted.engine,
            extractedText: converted.content,
            originalDataUrl,
            status: 'ready',
          })
        } else {
          const message = converted.message || converted.error || '没有提取到有效正文'
          error.value = `${file.name} 解析失败：${message}`
          uploadedFiles.value.push({
            name: file.name,
            mimeType: file.type,
            size: file.size,
            sourceType: converted.engine,
            originalDataUrl,
            status: 'error',
            error: message,
          })
        }
      } catch (err: any) {
        error.value = `${file.name} 处理失败: ${err.message}`
        uploadedFiles.value.push({
          name: file.name,
          mimeType: file.type,
          size: file.size,
          sourceType: 'unknown',
          status: 'error',
          error: err.message || '处理失败',
        })
      }
    }
  } finally {
    isFileProcessing.value = false
    fileProcessingMessage.value = ''
    input.value = ''
  }
}

// ─── 有资料：LLM 分析并追问 ───
async function analyzeUploads() {
  if (readyUploadCount.value === 0) {
    error.value = '没有可用于创建知识库的有效正文，请换用可复制文字的文件或先转成 Markdown/TXT'
    return
  }
  isLoading.value = true
  error.value = ''
  try {
    const localDraft = buildLocalFirstWikiDraft('新项目知识库')
    localFirstWikiDraft.value = localDraft
    const corpusMap = buildUploadedCorpusMap(8)

    const resp = await callLLM({
      model: agentStore.currentModel,
      systemPrompt: `你是知识库架构师。用户上传了一些资料，请分析资料内容，然后提出 2-3 个关键追问，并给出 2-3 个可选 Wiki 架构方向。
只输出 JSON，不要输出其他内容：
{
  "questions":["问题1","问题2","问题3"],
  "directions":[
    {
      "title":"架构方向名称",
      "description":"这个方向适合什么",
      "wikiFolders":["总览","分类/子分类"],
      "rationale":"为什么适合这些资料",
      "tradeoffs":"这个方向的取舍"
    }
  ]
}`,
      userMessage: `我上传了以下资料。下面是本地扫描出的资料图谱，请基于它分析并追问：\n\n${corpusMap}`,
      temperature: 0.3,
      maxTokens: 1400,
    })
    const parsed = JSON.parse(extractJson(resp))
    aiQuestions.value = parsed.questions || []
    aiAnswers.value = new Array(aiQuestions.value.length).fill('')
    const llmDirections = normalizeWikiArchitectureDirections(parsed.directions)
    setWikiDirections(llmDirections.length ? llmDirections : buildUploadArchitectureDirections({
      files: uploadedFiles.value,
      draftWikiFolders: localDraft?.wikiFolders,
    }))
    step.value = 2 // 进入追问步骤
  } catch (err: any) {
    const localDraft = buildLocalFirstWikiDraft('新项目知识库')
    localFirstWikiDraft.value = localDraft
    aiQuestions.value = ['你希望这个知识库优先用于什么场景？', '资料中哪些内容最重要？']
    aiAnswers.value = new Array(aiQuestions.value.length).fill('')
    setWikiDirections(buildUploadArchitectureDirections({
      files: uploadedFiles.value,
      draftWikiFolders: localDraft?.wikiFolders,
    }))
    error.value = 'AI 分析暂时失败，已用本地资料结构生成可选方向'
    step.value = 2
  }
  isLoading.value = false
}

// ─── 有资料：根据追问答案生成结构 ───
async function generateFromUploads() {
  isLoading.value = true
  error.value = ''
  try {
    const localDraft = buildLocalFirstWikiDraft('新项目知识库')
    localFirstWikiDraft.value = localDraft
    const corpusMap = buildUploadedCorpusMap(14)

    const qaText = aiQuestions.value
      .map((q, i) => `Q: ${q}\nA: ${aiAnswers.value[i] || '未回答'}`)
      .join('\n')
    const directionText = buildSelectedDirectionPrompt()

    const resp = await callLLM({
      model: agentStore.currentModel,
      systemPrompt: `你是知识库架构师。根据用户资料和回答，生成知识库结构。
Output strict JSON:
{
  "name": "建议名称",
  "oneLineDesc": "一句话介绍",
  "keywords": ["关键词1", "关键词2"],
  "rawFolders": ["资料分类名"],
  "wikiFolders": ["分类1/子分类", "分类2"],
  "seedPages": [],
  "templateRulebook": "只写当前知识库特有的整理规则，不要生成完整 CLAUDE.md"
}

Rules:
- Do not output claudeMd field.
- Fixed skeletons are created by local programs.
- seedPages can be empty when no data, but focus on generating suitable wikiFolders.
- Must respect user's selected Wiki architecture direction. `,
      userMessage: `资料扫描图谱：\n${corpusMap}\n\n追问与回答：\n${qaText}\n\n${directionText}`,
      temperature: 0.3,
      maxTokens: 5000,
    })
    const parsed = JSON.parse(extractJson(resp))
    generatedResult.value = normalizeGeneratedResult(parsed, localDraft
      ? {
          wikiFolders: localDraft.wikiFolders,
          seedPages: localDraft.seedPages,
        }
      : {})
    if (localDraft) {
      const existingFolders = new Set(generatedResult.value.wikiFolders)
      for (const folder of localDraft.wikiFolders) existingFolders.add(folder)
      for (const folder of selectedWikiDirection.value?.wikiFolders || []) existingFolders.add(folder)
      generatedResult.value.wikiFolders = Array.from(existingFolders)
      generatedResult.value.seedPages = mergeFirstWikiDraftSeedPages(generatedResult.value.seedPages, localDraft)
    }
    step.value = 3 // 预览
  } catch (err: any) {
    const localDraft = buildLocalFirstWikiDraft('新项目知识库')
    if (localDraft) {
      localFirstWikiDraft.value = localDraft
      generatedResult.value = normalizeGeneratedResult({}, {
        name: q3Name.value || '新项目知识库',
        oneLineDesc: '基于上传资料自动生成的知识库',
        keywords: [],
        rawFolders: [],
        wikiFolders: Array.from(new Set([...localDraft.wikiFolders, ...(selectedWikiDirection.value?.wikiFolders || [])])),
        seedPages: localDraft.seedPages,
      })
      step.value = 3
    } else {
      error.value = '生成失败：' + (err?.message || '请重试')
    }
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
      systemPrompt: `你是知识库架构师。根据用户的角色和目标，生成第二轮追问（2个多选题），并给出 2-3 个可选 Wiki 架构方向。
Output strict JSON:
{
  "questions": [
    {"label": "你的资料里最重要的是什么？", "options": ["选项1", "选项2", "选项3", "选项4", "选项5"]},
    {"label": "你希望知识库怎么分类？", "options": ["分类方式1", "分类方式2", "分类方式3", "让 AI 自动决定"]}
  ],
  "directions": [
    {
      "title": "架构方向名称",
      "description": "这个方向适合什么",
      "wikiFolders": ["总览", "分类/子分类"],
      "rationale": "为什么适合用户目标",
      "tradeoffs": "这个方向的取舍"
    }
  ]
}`,
      userMessage: `我是${q1Role.value}，我希望知识库帮我${q1Goal.value}`,
      temperature: 0.3,
      maxTokens: 800,
    })
    const parsed = JSON.parse(extractJson(resp))
    q2Questions.value = parsed.questions || []
    const llmDirections = normalizeWikiArchitectureDirections(parsed.directions)
    setWikiDirections(llmDirections.length ? llmDirections : buildDescribeArchitectureDirections({
      role: q1Role.value,
      goal: q1Goal.value,
    }))
    q2Generated.value = true
  } catch (err: any) {
    q2Questions.value = [
      { label: '你希望知识库优先支持哪类任务？', options: ['长文输出', '资料查询', '搭子执行', '让 AI 自动决定'] },
      { label: '你希望内容主要按什么方式整理？', options: ['主题', '对象', '流程', '让 AI 自动决定'] },
    ]
    setWikiDirections(buildDescribeArchitectureDirections({
      role: q1Role.value,
      goal: q1Goal.value,
    }))
    q2Generated.value = true
    error.value = 'AI 追问暂时失败，已用本地规则生成可选方向'
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
    const directionText = buildSelectedDirectionPrompt()

    const resp = await callLLM({
      model: agentStore.currentModel,
      systemPrompt: `你是知识库架构师。根据用户信息生成知识库结构。
Output strict JSON:
{
  "name": "建议名称",
  "oneLineDesc": "一句话介绍",
  "keywords": ["关键词1", "关键词2"],
  "rawFolders": ["资料分类名"],
  "wikiFolders": ["分类1/子分类", "分类2"],
  "seedPages": [],
  "templateRulebook": "只写当前知识库特有的整理规则，不要生成完整 CLAUDE.md"
}

Rules:
- Do not output claudeMd field.
- Fixed skeletons are created by local programs.
- seedPages can be empty when no data, but focus on generating suitable wikiFolders.
- Must respect user's selected Wiki architecture direction. `,
      userMessage: `Role: ${q1Role.value}\nGoal: ${q1Goal.value}\n${q2Text}\nNaming: ${q3Name.value || 'Auto'}\nIntroduction: ${q3Desc.value || 'Auto'}\nKeywords: ${q3Keywords.value || 'Auto'}\n\n${directionText}`,
      temperature: 0.3,
      maxTokens: 2000,
    })
    generatedResult.value = normalizeGeneratedResult(JSON.parse(extractJson(resp)))
    if (selectedWikiDirection.value) {
      const existingFolders = new Set(generatedResult.value.wikiFolders)
      for (const folder of selectedWikiDirection.value.wikiFolders) existingFolders.add(folder)
      generatedResult.value.wikiFolders = Array.from(existingFolders)
    }
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
    rawFolders: [...tpl.rawFolders],
    wikiFolders: [...tpl.wikiFolders],
    seedPages: [],
    templateRulebook: tpl.claudeMd,
  }
  step.value = 3
}

// ─── 最终创建知识库 ───
async function createVault() {
  if (!generatedResult.value) return
  isLoading.value = true
  error.value = ''
  try {
    if (mode.value === 'upload' && uploadedFiles.value.length > 0 && readyUploadCount.value === 0) {
      error.value = '没有可用于创建知识库的有效正文，请先重新上传资料'
      isLoading.value = false
      return
    }
    const r = generatedResult.value
    const vault = await vaultStore.createVault(r.name, 'project', {
      description: r.oneLineDesc,
      oneLineDesc: r.oneLineDesc,
      keywords: r.keywords,
      template: selectedTemplate.value?.id,
      claudeMd: r.templateRulebook,
      rawFolders: r.rawFolders,
      wikiFolders: r.wikiFolders,
      seedPages: r.seedPages,
    })
    vaultStore.setActiveVault(vault.id)

    // 如果有上传资料，存入 raw/原始文件 + raw/转换后的MD，并记录导入报告
    if (uploadedFiles.value.length > 0) {
      const fs = useFileStore()
      const plan = buildVaultIngestionPlan({ files: uploadedFiles.value })

      async function writePlannedEntry(entry:
        ReturnType<typeof buildVaultIngestionPlan>['items'][number]['markdown'] |
        ReturnType<typeof buildVaultIngestionPlan>['items'][number]['meta'] |
        NonNullable<ReturnType<typeof buildVaultIngestionPlan>['items'][number]['original']>
      ) {
        const folder = await fs.findFolderByPath(vault.id, entry.folderPath) || await fs.findVaultRootFolder(vault.id, 'raw')
        if (!folder) return
        await fs.addFile({
          category: 'knowledge',
          name: entry.name,
          content: entry.content,
          mimeType: entry.mimeType,
          size: new TextEncoder().encode(entry.content).length,
          vaultId: vault.id,
          folderId: folder.id,
          kind: 'raw',
          indexed: entry.indexed,
          metadata: entry.metadata,
        })
      }

      for (const item of plan.items) {
        if (item.original) await writePlannedEntry(item.original)
        await writePlannedEntry(item.markdown)
        await writePlannedEntry(item.meta)
      }

      const reportFolder = await fs.findFolderByPath(vault.id, '_reports/整理记录')
      if (reportFolder) {
        const report = buildVaultIngestionReport(r.name, plan)
        await fs.addFile({
          category: 'knowledge',
          name: `资料导入报告_${new Date().toLocaleString('zh-CN').replace(/[/:]/g, '-')}.md`,
          content: report,
          mimeType: 'text/markdown',
          size: new TextEncoder().encode(report).length,
          vaultId: vault.id,
          folderId: reportFolder.id,
          kind: 'summary',
          indexed: true,
          metadata: {
            vaultFolder: 'reports',
            kind: 'vault-ingestion-report',
            imported: plan.summary.ready,
            failed: plan.summary.failed,
            createdAt: Date.now(),
          },
        })

        const firstWikiDraft = localFirstWikiDraft.value || buildLocalFirstWikiDraft(r.name)
        if (firstWikiDraft) {
          const firstWikiReport = buildFirstWikiReport(r.name, firstWikiDraft)
          await fs.addFile({
            category: 'knowledge',
            name: `首版Wiki生成报告_${new Date().toLocaleString('zh-CN').replace(/[/:]/g, '-')}.md`,
            content: firstWikiReport,
            mimeType: 'text/markdown',
            size: new TextEncoder().encode(firstWikiReport).length,
            vaultId: vault.id,
            folderId: reportFolder.id,
            kind: 'summary',
            indexed: true,
            metadata: {
              vaultFolder: 'reports',
              kind: 'vault-first-wiki-report',
              pageCount: firstWikiDraft.seedPages.length,
              folderCount: firstWikiDraft.wikiFolders.length,
              createdAt: Date.now(),
            },
          })
        }
      }

      if (plan.failures.length > 0) {
        error.value = `有 ${plan.failures.length} 个文件未成功转换，已写入导入报告`
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
  localFirstWikiDraft.value = null
  wikiDirections.value = []
  selectedWikiDirectionId.value = ''
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

        <button class="vw-choice" @click="selectMode('addToVault')">
          <span class="mso vw-choice-icon">folder_open</span>
          <span class="vw-choice-title">添加现有知识库内容</span>
          <span class="vw-choice-desc">选择已有知识库，上传资料后自动整理为 Wiki</span>
        </button>
      </div>
    </div>

    <!-- Step 1: 有资料 — 上传 -->
    <div v-if="step === 1 && mode === 'upload'" class="vw-step">
      <h4>上传你的资料</h4>
      <p class="vw-hint">支持 TXT、MD、PDF、DOCX、XLSX、PPTX 等文件</p>
      <label class="vw-file-picker" :class="{ disabled: isFileProcessing }">
        <span class="mso">upload_file</span>
        <span>{{ isFileProcessing ? '正在解析资料...' : '选择资料文件' }}</span>
        <input type="file" multiple accept=".txt,.md,.pdf,.docx,.doc,.csv,.json,.xlsx,.xls,.pptx,.ppt,.rtf,.odt" @change="handleFileUpload" class="vw-file-input" :disabled="isFileProcessing" />
      </label>
      <div v-if="isFileProcessing" class="vw-processing">
        <span class="vw-spin"><span class="mso">progress_activity</span></span> {{ fileProcessingMessage || '正在解析文件...' }}
      </div>
      <div v-if="uploadedFiles.length > 0" class="vw-uploaded">
        <div v-for="f in uploadedFiles" :key="f.name" class="vw-uploaded-item">
          <span class="mso" style="font-size:14px">description</span>
          {{ f.name }}<span v-if="f.status === 'error'">（解析失败）</span>
        </div>
      </div>
      <button class="vw-btn primary" :disabled="readyUploadCount === 0 || isLoading || isFileProcessing" @click="analyzeUploads">
        <span v-if="isLoading" class="vw-spin">
          <span class="mso">progress_activity</span>
        </span>
        {{ isLoading ? 'AI 分析中...' : '开始分析' }}
      </button>
    </div>

    <!-- Step 1: 添加现有知识库内容 -->
    <div v-if="step === 1 && mode === 'addToVault'" class="vw-step">
      <h4>选择知识库并上传资料</h4>

      <!-- 选择知识库 -->
      <div class="vw-qa">
        <label>目标知识库</label>
        <select v-model="addToVaultId" class="vw-select">
          <option value="" disabled>请选择知识库...</option>
          <option v-for="vault in availableVaults" :key="vault.id" :value="vault.id">
            {{ vault.name }}
          </option>
        </select>
        <p v-if="availableVaults.length === 0" class="vw-hint" style="margin-top:4px">
          还没有知识库？先用「有资料创建」或「描述创建」新建一个。
        </p>
      </div>

      <!-- 上传文件 -->
      <div class="vw-qa" style="margin-top:12px">
        <label>上传资料</label>
        <label class="vw-file-picker" :class="{ disabled: addToVaultCompiling }">
          <span class="mso">upload_file</span>
          <span>{{ addToVaultCompiling ? '正在处理...' : '选择文件上传' }}</span>
          <input type="file" multiple accept=".txt,.md,.pdf,.docx,.doc,.csv,.json,.xlsx,.xls,.pptx,.ppt,.rtf,.odt" @change="handleAddToVaultUpload" class="vw-file-input" :disabled="addToVaultCompiling" />
        </label>
      </div>

      <!-- 已上传文件列表 -->
      <div v-if="addToVaultFiles.length > 0" class="vw-uploaded">
        <div v-for="f in addToVaultFiles" :key="f.name" class="vw-uploaded-item">
          <span class="mso" style="font-size:14px">{{ f.status === 'ready' ? 'check_circle' : f.status === 'error' ? 'error' : 'hourglass_empty' }}</span>
          {{ f.name }}<span v-if="f.status === 'error'">（解析失败）</span>
        </div>
      </div>

      <!-- 整理按钮 -->
      <button
        class="vw-btn primary"
        :disabled="!addToVaultId || addToVaultReadyCount === 0 || addToVaultCompiling"
        @click="compileAddToVault"
        style="margin-top:12px"
      >
        <span v-if="addToVaultCompiling" class="vw-spin">
          <span class="mso">progress_activity</span>
        </span>
        {{ addToVaultCompiling ? '正在上传并整理...' : '上传并整理为 Wiki' }}
      </button>

      <!-- 结果提示 -->
      <div v-if="addToVaultResult" class="vw-success" style="margin-top:8px">
        <span class="mso">check_circle</span> {{ addToVaultResult }}
      </div>
    </div>

    <!-- Step 2: 有资料 — AI 追问 -->
    <div v-if="step === 2 && mode === 'upload'" class="vw-step">
      <h4>AI 需要了解更多</h4>
      <div v-for="(q, i) in aiQuestions" :key="i" class="vw-qa">
        <label>{{ q }}</label>
        <textarea v-model="aiAnswers[i]" rows="2" placeholder="你的回答..." />
      </div>
      <div v-if="wikiDirections.length" class="vw-directions">
        <h4>选择 Wiki 整理方向</h4>
        <button
          v-for="direction in wikiDirections"
          :key="direction.id"
          class="vw-direction-card"
          :class="{ selected: selectedWikiDirectionId === direction.id }"
          @click="selectedWikiDirectionId = direction.id"
        >
          <span class="vw-direction-title">{{ direction.title }}</span>
          <span class="vw-direction-desc">{{ direction.description }}</span>
          <span class="vw-direction-folders">{{ direction.wikiFolders.slice(0, 5).join(' / ') }}</span>
        </button>
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
        <div v-if="wikiDirections.length" class="vw-directions">
          <h4>选择 Wiki 整理方向</h4>
          <button
            v-for="direction in wikiDirections"
            :key="direction.id"
            class="vw-direction-card"
            :class="{ selected: selectedWikiDirectionId === direction.id }"
            @click="selectedWikiDirectionId = direction.id"
          >
            <span class="vw-direction-title">{{ direction.title }}</span>
            <span class="vw-direction-desc">{{ direction.description }}</span>
            <span class="vw-direction-folders">{{ direction.wikiFolders.slice(0, 5).join(' / ') }}</span>
          </button>
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
          <div v-for="f in previewScaffold?.rawFolders || generatedResult.rawFolders" :key="'r_'+f" class="vw-tree-item l2">
            <span class="mso">folder</span> {{ f }}/
          </div>
          <div class="vw-tree-item l1"><span class="mso">folder</span> wiki/</div>
          <div class="vw-tree-item l2"><span class="mso">description</span> index.md</div>
          <div class="vw-tree-item l2"><span class="mso">description</span> overview.md</div>
          <div class="vw-tree-item l2"><span class="mso">description</span> hot.md</div>
          <div class="vw-tree-item l2"><span class="mso">description</span> log.md</div>
          <div v-for="f in previewScaffold?.wikiFolders || generatedResult.wikiFolders" :key="'w_'+f" class="vw-tree-item l2">
            <span class="mso">folder</span> {{ f }}/
          </div>
          <div v-for="p in generatedResult.seedPages.slice(0, 8)" :key="'p_'+p.path" class="vw-tree-item l2">
            <span class="mso">article</span> {{ p.path }}
          </div>
          <div class="vw-tree-item l1"><span class="mso">folder</span> _reports/</div>
          <div class="vw-tree-item l2"><span class="mso">folder</span> 整理记录/</div>
          <div class="vw-tree-item l2"><span class="mso">folder</span> 健康检查/</div>
          <div class="vw-tree-item l1"><span class="mso">folder</span> _templates/</div>
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
.vw-file-picker {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  width: fit-content; padding: 9px 14px; border-radius: 8px;
  border: 1px solid var(--olive); background: var(--paper);
  color: var(--olive); font-size: 13px; font-weight: 700;
  cursor: pointer; font-family: inherit;
}
.vw-file-picker:hover { background: rgba(107,142,35,.08); }
.vw-file-picker.disabled { opacity: .55; cursor: default; }
.vw-file-picker .mso { font-size: 16px; }
.vw-file-input {
  position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none;
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
.vw-qa input:focus, .vw-qa textarea:focus, .vw-qa select:focus { border-color: var(--olive); }
.vw-select {
  width: 100%; padding: 8px 10px; border: 1px solid var(--border);
  border-radius: 8px; background: var(--surface-alt);
  font-size: 13px; font-family: inherit; color: var(--ink);
  outline: none; cursor: pointer;
}
.vw-options { display: flex; flex-direction: column; gap: 6px; padding-left: 4px; }
.vw-option {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; color: var(--ink2); cursor: pointer;
}
.vw-option input[type="radio"] { accent-color: var(--olive); }
.vw-directions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.vw-direction-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 100%;
  padding: 10px 12px;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  background: var(--surface-alt);
  color: var(--ink2);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: all .15s;
}
.vw-direction-card:hover {
  border-color: var(--olive);
  background: rgba(107,142,35,.04);
}
.vw-direction-card.selected {
  border-color: var(--olive);
  background: rgba(107,142,35,.08);
}
.vw-direction-title {
  font-size: 13px;
  font-weight: 800;
  color: var(--ink);
}
.vw-direction-desc {
  font-size: 12px;
  color: var(--ink3);
  line-height: 1.45;
}
.vw-direction-folders {
  font-size: 11px;
  color: var(--olive-dark);
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
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

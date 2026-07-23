<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import MediaPlanCard from '@/components/chat/MediaPlanCard.vue'
import { sendSingleTurnWorkbench } from '@/composables/singleTurnWorkbench'
import { createRuntimeProjectFileService } from '@/services/projectFileService'
import { useAgentStore } from '@/stores/agentStore'
import { useProjectStore } from '@/stores/projectStore'
import { isTauriRuntime } from '@/utils/tauriEnv'
import { webProjectFiles } from '@/utils/webProjectFiles'
import { emitEvent } from '@/utils/eventBus'
import {
  buildProductionWorkbenchRequest,
  getProductionProfile,
  isProductionAssetStep,
  parseProductionPromptCards,
  type ProductionSource,
  type ProductionStep,
} from '@/runtime/workbench/productionWorkbench'
import {
  createProductionWikiSkeleton,
  readProductionWikiBinding,
  saveProductionWikiBinding,
  saveProductionWikiOutput,
} from '@/runtime/workbench/productionWikiOutputStore'
import type { ProductionOutputKind } from '@/runtime/workbench/productionWikiOutput'
import { preparePublicMediaPlan } from '@/runtime/workbench/mediaPlanBridge'
import { resolveProductDefaultModelId, type MediaPlan } from '@/runtime/workbench/mediaPlan'
import { resolveProductionWikiScene, type ProductionWikiEntity } from '@/runtime/workbench/productionWikiBinding'
import type { WorkbenchAttachment } from '@/runtime/workbench/singleTurnWorkbench'
import type { ProjectResource } from '@/utils/projectResource'
import type { ModelEntry } from '@/stores/agentStore'

const agentStore = useAgentStore()
const projectStore = useProjectStore()
const projectFiles = createRuntimeProjectFileService()
const step = ref<ProductionStep>('style')
const userText = ref('')
const sourceFolder = ref('')
const showSourcePicker = ref(false)
const showWikiRootPicker = ref(false)
const selectedPaths = ref<string[]>([])
const wikiRootPath = ref('')
const wikiAnchorPath = ref('')
const wikiEntities = ref<ProductionWikiEntity[]>([])
const wikiUnresolvedLinks = ref<string[]>([])
const excludedWikiEntities = ref<string[]>([])
const wikiBoundSources = ref<Array<{ source: ProductionSource; revision: string }>>([])
const resources = ref<ProjectResource[]>([])
const attachments = ref<WorkbenchAttachment[]>([])
const modelId = ref(agentStore.currentModel)
const showModelMenu = ref(false)
const modelBtnRef = ref<HTMLElement | null>(null)
const modelMenuStyle = ref<Record<string, string>>({})
const error = ref('')
const loadingResources = ref(false)

type RunStatus = 'running' | 'success' | 'failed' | 'media-ready'
type AssetCard = {
  id: string
  name: string
  prompt: string
  sourcePath?: string
  mediaPlan?: MediaPlan
}
type ProductionRun = {
  id: string
  step: ProductionStep
  name: string
  status: RunStatus
  modelId: string
  profile: string
  content: string
  error: string
  createdAt: number
  mediaPlan?: MediaPlan
  cards?: AssetCard[]
}
const runs = ref<ProductionRun[]>([])

const steps: Array<{ key: ProductionStep; label: string }> = [
  { key: 'style', label: '风格' },
  { key: 'characters', label: '角色' },
  { key: 'scenes', label: '场景' },
  { key: 'props', label: '道具' },
  { key: 'storyboard-images', label: '分镜图' },
  { key: 'storyboard-video', label: '分镜视频' },
]
const owner = computed(() => isTauriRuntime() ? projectStore.projectDir.value : projectStore.webProjectId.value)
const projectName = computed(() => projectStore.projectName.value || '未命名制作项目')
const selectedResources = computed(() => resources.value.filter(resource => selectedPaths.value.includes(resource.path)))
const sourceFolders = computed(() => [...new Set(resources.value.flatMap(resource => {
  const parts = resource.path.split('/').slice(0, -1)
  return parts.map((_part, index) => parts.slice(0, index + 1).join('/'))
}))].sort((a, b) => a.localeCompare(b, 'zh-CN')))
const visibleResources = computed(() => sourceFolder.value
  ? resources.value.filter(resource => resource.path.startsWith(`${sourceFolder.value}/`))
  : resources.value)
const wikiRootCandidates = computed(() => sourceFolders.value.filter(folder => {
  const children = new Set(sourceFolders.value
    .filter(path => path.startsWith(`${folder}/`))
    .map(path => path.slice(folder.length + 1).split('/')[0]))
  return ['作品', '角色', '场景', '道具', '世界', '世界观'].filter(name => children.has(name)).length >= 2
}))
const wikiAnchorCandidates = computed(() => wikiRootPath.value
  ? resources.value.filter(resource => resource.path.startsWith(`${wikiRootPath.value}/作品/`))
  : [])
const activeWikiEntities = computed(() => wikiEntities.value.filter(entity => !excludedWikiEntities.value.includes(`${entity.kind}:${entity.name}`)))
const currentWikiAssetEntities = computed(() => {
  const kind = step.value === 'characters' ? 'character' : step.value === 'scenes' ? 'scene' : step.value === 'props' ? 'prop' : null
  return kind ? activeWikiEntities.value.filter(entity => entity.kind === kind) : []
})
const wikiBoundResources = computed(() => {
  const paths = new Set([wikiAnchorPath.value, ...activeWikiEntities.value.flatMap(entity => entity.paths)])
  return resources.value.filter(resource => paths.has(resource.path))
})
const activeWikiSources = computed(() => {
  const paths = new Set(wikiBoundResources.value.map(resource => resource.path))
  return wikiBoundSources.value.filter(item => paths.has(item.source.path))
})
const currentProfile = computed(() => getProductionProfile(step.value))
const currentModel = computed(() => agentStore.availableModels.find(model => model.id === modelId.value))
const modelChoices = computed(() => agentStore.textModels)
const currentRuns = computed(() => runs.value.filter(run => run.step === step.value))

function selectStep(nextStep: ProductionStep) {
  step.value = nextStep
  error.value = ''
}

function outputKind(): ProductionOutputKind {
  if (step.value === 'style') return 'style'
  if (step.value === 'characters') return 'character'
  if (step.value === 'scenes') return 'scene'
  if (step.value === 'props') return 'prop'
  if (step.value === 'storyboard-images') return 'storyboard'
  return 'video'
}

function toggleModelMenu(event?: Event) {
  event?.stopPropagation()
  showModelMenu.value = !showModelMenu.value
  if (showModelMenu.value && modelBtnRef.value) {
    const rect = modelBtnRef.value.getBoundingClientRect()
    modelMenuStyle.value = {
      position: 'fixed',
      top: `${rect.bottom + 4}px`,
      right: `${window.innerWidth - rect.right}px`,
    }
  }
}

function selectWorkbenchModel(model: ModelEntry) {
  modelId.value = model.id
  showModelMenu.value = false
}

async function toggleSourcePicker() {
  showSourcePicker.value = !showSourcePicker.value
  if (showSourcePicker.value) await refreshResources()
}

async function refreshResources() {
  if (!owner.value) {
    resources.value = []
    selectedPaths.value = []
    return
  }
  loadingResources.value = true
  try {
    resources.value = (await projectFiles.list(owner.value))
      .filter(resource => !resource.isDirectory && resource.kind === 'document' && resource.path !== 'wiki/hot.md')
    selectedPaths.value = selectedPaths.value.filter(path => resources.value.some(resource => resource.path === path))
    if (wikiAnchorPath.value && !resources.value.some(resource => resource.path === wikiAnchorPath.value)) unlinkProjectWiki()
  } finally {
    loadingResources.value = false
  }
}

function toggleWikiRootPicker() {
  if (!wikiRootCandidates.value.length) {
    error.value = '当前项目没有可关联的 Wiki 文档。'
    return
  }
  showWikiRootPicker.value = !showWikiRootPicker.value
}

function linkProjectWiki(root: string) {
  wikiRootPath.value = root
  sourceFolder.value = `${root}/作品`
  showWikiRootPicker.value = false
  error.value = ''
  void persistWikiBinding()
}

function unlinkProjectWiki() {
  wikiRootPath.value = ''
  wikiAnchorPath.value = ''
  wikiEntities.value = []
  wikiUnresolvedLinks.value = []
  excludedWikiEntities.value = []
  wikiBoundSources.value = []
  void persistWikiBinding()
}

async function selectWikiAnchor(
  resource: ProjectResource,
  exclusions: string[] = [],
  persist = true,
  expectedSources: Array<{ path: string; revision: string }> = [],
) {
  if (!wikiRootPath.value) return
  const content = await projectFiles.readText(resource)
  const resolved = resolveProductionWikiScene({
    rootPath: wikiRootPath.value,
    anchor: resource,
    content: content.content,
    resources: resources.value,
  })
  const paths = [...new Set([resource.path, ...resolved.entities.flatMap(entity => entity.paths)])]
  const snapshots = await Promise.all(paths.map(async path => {
    const item = resources.value.find(candidate => candidate.path === path)
    if (!item) throw new Error(`Wiki 资料不存在：${path}`)
    const current = await projectFiles.readText(item)
    return {
      source: { id: item.id || item.path, name: item.name, path: item.path, content: current.content },
      revision: current.revision.value,
    }
  }))
  if (expectedSources.length && !sameWikiSources(snapshots, expectedSources)) {
    error.value = '关联 Wiki 资料已变化，请刷新绑定后再运行。'
    return
  }
  wikiAnchorPath.value = resource.path
  wikiEntities.value = resolved.entities
  wikiUnresolvedLinks.value = resolved.unresolvedLinks
  excludedWikiEntities.value = exclusions
  wikiBoundSources.value = snapshots
  if (persist) void persistWikiBinding()
}

function toggleWikiEntity(entity: ProductionWikiEntity) {
  const key = `${entity.kind}:${entity.name}`
  excludedWikiEntities.value = excludedWikiEntities.value.includes(key)
    ? excludedWikiEntities.value.filter(item => item !== key)
    : [...excludedWikiEntities.value, key]
  void persistWikiBinding()
}

async function persistWikiBinding() {
  if (!owner.value) return
  try {
    await saveProductionWikiBinding(projectFiles, owner.value, {
      rootPath: wikiRootPath.value,
      anchorPath: wikiAnchorPath.value,
      excludedEntityKeys: excludedWikiEntities.value,
      sources: wikiBoundSources.value.map(item => ({ path: item.source.path, revision: item.revision })),
    })
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  }
}

async function restoreWikiBinding() {
  if (!owner.value) return
  const binding = await readProductionWikiBinding(projectFiles, owner.value)
  if (!binding?.rootPath || !binding.anchorPath) return
  const anchor = resources.value.find(resource => resource.path === binding.anchorPath)
  if (!anchor) return
  wikiRootPath.value = binding.rootPath
  sourceFolder.value = `${binding.rootPath}/作品`
  await selectWikiAnchor(anchor, binding.excludedEntityKeys, false, binding.sources)
}

function sameWikiSources(
  snapshots: Array<{ source: ProductionSource; revision: string }>,
  expected: Array<{ path: string; revision: string }>,
): boolean {
  return snapshots.length === expected.length
    && snapshots.every(snapshot => expected.some(item => item.path === snapshot.source.path && item.revision === snapshot.revision))
}

async function assertWikiBindingFresh() {
  for (const snapshot of activeWikiSources.value) {
    const resource = resources.value.find(item => item.path === snapshot.source.path)
    if (!resource) throw new Error(`关联 Wiki 资料已不存在：${snapshot.source.path}`)
    const current = await projectFiles.readText(resource)
    if (current.revision.value !== snapshot.revision) throw new Error('关联 Wiki 资料已变化，请刷新绑定后再运行。')
  }
}

async function ensureProject(): Promise<string> {
  if (!owner.value) {
    if (isTauriRuntime()) {
      const { invoke } = await import('@tauri-apps/api/core')
      projectStore.selectProject(await invoke<string>('create_production_project'))
    } else {
      const project = await webProjectFiles.createProject('未命名制作项目')
      projectStore.selectWebProject({ id: project.id, name: project.name })
    }
  }
  const nextOwner = isTauriRuntime() ? projectStore.projectDir.value : projectStore.webProjectId.value
  if (!nextOwner) throw new Error('创建制作项目失败')
  await createProductionWikiSkeleton(projectFiles, nextOwner)
  await refreshResources()
  return nextOwner
}

function fileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error(`无法读取 ${file.name}`))
    reader.readAsDataURL(file)
  })
}

async function addAttachments(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files || [])]
  try {
    attachments.value = [...attachments.value, ...await Promise.all(files.map(async file => ({
      id: `${Date.now()}-${file.name}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      mime: file.type || 'application/octet-stream',
      value: await fileAsDataUrl(file),
    })))]
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    input.value = ''
  }
}

function removeAttachment(id: string) {
  attachments.value = attachments.value.filter(attachment => attachment.id !== id)
}

async function selectedSources() {
  await assertWikiBindingFresh()
  const selected = new Map([...selectedResources.value, ...wikiBoundResources.value].map(resource => [resource.path, resource]))
  const manual = await Promise.all([...selected.values()]
    .filter(resource => !activeWikiSources.value.some(item => item.source.path === resource.path))
    .map(async resource => ({
    id: resource.id || resource.path,
    name: resource.name,
    path: resource.path,
    content: (await projectFiles.readText(resource)).content,
  })))
  return [...manual, ...activeWikiSources.value.map(item => item.source)]
}

function updateRun(id: string, patch: Partial<ProductionRun>) {
  const index = runs.value.findIndex(run => run.id === id)
  if (index >= 0) runs.value[index] = { ...runs.value[index], ...patch }
}

async function run() {
  error.value = ''
  const runId = `production_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const name = currentProfile.value.heading
  try {
    const projectOwner = await ensureProject()
    const sources = await selectedSources()
    const request = buildProductionWorkbenchRequest({
      step: step.value,
      modelId: modelId.value,
      userText: userText.value,
      sources,
      attachments: attachments.value,
      entityNames: currentWikiAssetEntities.value.map(entity => entity.name),
    })
    const item: ProductionRun = {
      id: runId,
      step: step.value,
      name,
      status: 'running',
      modelId: modelId.value,
      profile: currentProfile.value.id,
      content: '',
      error: '',
      createdAt: Date.now(),
    }
    runs.value = [item, ...runs.value]
    const result = await sendSingleTurnWorkbench(request, currentModel.value?.providerId, text => updateRun(runId, { content: text }))
    const parsedCards = isProductionAssetStep(step.value) ? parseProductionPromptCards(result.output) : []
    const cards = currentWikiAssetEntities.value.length
      ? currentWikiAssetEntities.value.map(entity => {
        const card = parsedCards.find(item => item.name === entity.name)
        if (!card) throw new Error(`本次没有返回${entity.name}的提示词，请重试。`)
        return { ...card, sourcePath: entity.paths[0] }
      })
      : parsedCards
    if (isProductionAssetStep(step.value) && !cards.length) {
      throw new Error('本次没有返回可用的对象提示词，请重试。')
    }
    await saveProductionWikiOutput(projectFiles, projectOwner, {
      kind: outputKind(),
      ...(cards.length || outputKind() === 'style' ? {} : { name }),
      content: result.output,
      ...(cards.length ? { cards } : {}),
    })
    updateRun(runId, {
      status: 'success',
      content: result.output,
      ...(cards.length ? { cards: cards.map((card, index) => ({ ...card, id: `${runId}_${index}` })) } : {}),
    })
    await refreshResources()
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason)
    if (runs.value.some(item => item.id === runId)) updateRun(runId, { status: 'failed', error: message })
    else error.value = message
  }
}

function updateCard(runId: string, cardId: string, patch: Partial<AssetCard>) {
  const run = runs.value.find(item => item.id === runId)
  const index = run?.cards?.findIndex(card => card.id === cardId) ?? -1
  if (!run || !run.cards || index < 0) return
  run.cards[index] = { ...run.cards[index], ...patch }
}

function assetImageLabel(step: ProductionStep): string {
  if (step === 'characters') return '生成角色图'
  if (step === 'scenes') return '生成场景图'
  return '生成道具图'
}

function prepareMedia(run: ProductionRun) {
  const kind = run.step === 'storyboard-video' ? 'video' : 'image'
  const plan: MediaPlan = {
    kind,
    title: run.name,
    prompt: run.content,
    modelId: resolveProductDefaultModelId({ kind }),
    usesProductDefaultModel: true,
    ...(attachments.value.filter(attachment => attachment.mime.startsWith('image/')).length
      ? { referenceImages: attachments.value.filter(attachment => attachment.mime.startsWith('image/')).map(attachment => attachment.value) }
      : {}),
  }
  updateRun(run.id, { status: 'media-ready', mediaPlan: plan })
}

async function submitMedia(run: ProductionRun) {
  if (!run.mediaPlan) return
  try {
    const projectOwner = await ensureProject()
    const prepared = await preparePublicMediaPlan({ plan: run.mediaPlan, owner: projectOwner })
    emitEvent('switch-panel', 'creation')
    emitEvent('production-media-plan-approved', { runId: run.id, sessionId: run.id, plan: prepared.plan, preparedSubmission: prepared.submission })
  } catch (reason) {
    updateRun(run.id, { status: 'failed', error: reason instanceof Error ? reason.message : String(reason) })
  }
}

function prepareAssetMedia(run: ProductionRun, card: AssetCard) {
  updateCard(run.id, card.id, {
    mediaPlan: {
      kind: 'image',
      title: card.name,
      prompt: card.prompt,
      modelId: resolveProductDefaultModelId({ kind: 'image' }),
      usesProductDefaultModel: true,
      ...(attachments.value.filter(attachment => attachment.mime.startsWith('image/')).length
        ? { referenceImages: attachments.value.filter(attachment => attachment.mime.startsWith('image/')).map(attachment => attachment.value) }
        : {}),
    },
  })
}

async function submitAssetMedia(run: ProductionRun, card: AssetCard) {
  if (!card.mediaPlan) return
  try {
    const projectOwner = await ensureProject()
    const prepared = await preparePublicMediaPlan({ plan: card.mediaPlan, owner: projectOwner })
    emitEvent('switch-panel', 'creation')
    emitEvent('production-media-plan-approved', {
      runId: run.id,
      mediaCardId: card.id,
      sessionId: `${run.id}_${card.id}`,
      plan: prepared.plan,
      preparedSubmission: prepared.submission,
    })
  } catch (reason) {
    updateRun(run.id, { error: reason instanceof Error ? reason.message : String(reason) })
  }
}

watch(owner, () => {
  runs.value = []
  void refreshWorkbenchData()
}, { immediate: true })
onMounted(() => {
  void agentStore.fetchModels({ skipOpenCode: true })
  void refreshWorkbenchData()
})

async function refreshWorkbenchData() {
  await refreshResources()
  if (!wikiRootPath.value) await restoreWikiBinding()
}
</script>

<template>
  <section class="production-workbench">
    <header class="production-header">
      <div><h2>制作</h2><p>项目：{{ projectName }}</p></div>
      <div class="production-model-wrap">
        <button ref="modelBtnRef" class="production-model-btn" type="button" @click="toggleModelMenu($event)"><JcIcon name="deployed_code" />{{ modelId }}</button>
        <Teleport to="body">
          <div v-if="showModelMenu" class="production-model-menu" :style="modelMenuStyle" @click.stop>
            <div v-if="!modelChoices.length" class="production-model-empty" :class="{ error: Boolean(agentStore.modelsFetchError) }">{{ agentStore.modelsFetchError ? '模型列表未就绪' : '正在读取模型列表' }}</div>
            <button v-for="model in modelChoices" :key="model.id" class="production-model-item" :class="{ active: model.id === modelId }" type="button" @click="selectWorkbenchModel(model)">{{ model.id }}</button>
          </div>
        </Teleport>
      </div>
    </header>

    <nav class="production-steps" aria-label="制作步骤">
      <button v-for="item in steps" :key="item.key" type="button" :class="{ active: step === item.key }" @click="selectStep(item.key)">{{ item.label }}</button>
    </nav>

    <main class="production-body">
      <section class="production-form">
        <label>用户信息<textarea v-model="userText" rows="5" placeholder="写一句话、片段或本次要解决的制作问题" /></label>
      </section>

      <section class="production-sources">
        <div class="production-section-head"><h3>本次资料</h3></div>
        <p>没有资料也能运行。已选资料才会进入本次请求。</p>
        <div v-if="selectedResources.length" class="production-selected-sources"><button v-for="resource in selectedResources" :key="resource.path" type="button" @click="selectedPaths = selectedPaths.filter(path => path !== resource.path)">{{ resource.name }} <JcIcon name="close" /></button></div>
        <button class="production-add-source" type="button" @click="toggleSourcePicker"><JcIcon name="add" />添加资料</button>
        <div v-if="showSourcePicker" class="production-source-picker">
          <div class="production-wiki-link"><button type="button" :class="{ active: Boolean(wikiRootPath) }" @click="toggleWikiRootPicker">{{ wikiRootPath ? `已关联 ${wikiRootPath}` : '关联项目 Wiki' }}</button><button v-if="wikiRootPath" type="button" @click="unlinkProjectWiki">解除</button><button v-for="root in showWikiRootPicker ? wikiRootCandidates : []" :key="root" type="button" @click="linkProjectWiki(root)">{{ root }}</button></div>
          <div v-if="wikiRootPath" class="production-wiki-scenes">
            <p>选择单集或单场</p>
            <button v-for="resource in wikiAnchorCandidates" :key="resource.path" type="button" :class="{ active: resource.path === wikiAnchorPath }" @click="selectWikiAnchor(resource)">{{ resource.path }}</button>
            <template v-if="wikiAnchorPath">
              <p>本场实体</p>
              <button v-for="entity in wikiEntities" :key="`${entity.kind}:${entity.name}`" type="button" :class="{ muted: excludedWikiEntities.includes(`${entity.kind}:${entity.name}`) }" @click="toggleWikiEntity(entity)">{{ entity.name }}</button>
              <p v-if="wikiUnresolvedLinks.length" class="production-error">未找到实体：{{ wikiUnresolvedLinks.join('、') }}</p>
            </template>
          </div>
          <div class="production-folder-list"><button type="button" :class="{ active: !sourceFolder }" @click="sourceFolder = ''">项目文档</button><button v-for="folder in sourceFolders" :key="folder" type="button" :class="{ active: sourceFolder === folder }" @click="sourceFolder = folder">{{ folder }}</button></div>
          <label v-for="resource in visibleResources" :key="resource.path" class="production-source"><input v-model="selectedPaths" type="checkbox" :value="resource.path">{{ resource.path }}</label>
          <p v-if="loadingResources">正在读取项目资料...</p>
          <label class="production-upload">上传文档或参考素材<input type="file" multiple @change="addAttachments"></label>
        </div>
        <div class="production-attachments"><button v-for="attachment in attachments" :key="attachment.id" type="button" @click="removeAttachment(attachment.id)">{{ attachment.name }} ×</button></div>
      </section>

      <button class="production-run" type="button" :disabled="currentRuns.some(run => run.status === 'running')" @click="run"><JcIcon name="play_arrow" />运行{{ currentProfile.heading }}</button>
      <p v-if="error" class="production-error">{{ error }}</p>

      <section v-for="run in currentRuns" :key="run.id" class="production-run-card">
        <header><strong>{{ run.name }}</strong><small>{{ run.modelId }} · {{ new Date(run.createdAt).toLocaleString() }}</small></header>
        <p v-if="run.status === 'running'">正在生成...</p>
        <template v-if="run.cards?.length">
          <section v-for="card in run.cards" :key="card.id" class="production-asset-card">
            <strong>{{ card.name }}</strong>
            <textarea :value="card.prompt" rows="5" @input="updateCard(run.id, card.id, { prompt: ($event.target as HTMLTextAreaElement).value })" />
            <button type="button" @click="prepareAssetMedia(run, card)">{{ assetImageLabel(run.step) }}</button>
            <MediaPlanCard v-if="card.mediaPlan" :plan="card.mediaPlan" :error="run.error" @approve="submitAssetMedia(run, card)" @update-parameters="patch => updateCard(run.id, card.id, { mediaPlan: { ...card.mediaPlan!, ...patch } })" />
          </section>
        </template>
        <pre v-else-if="run.content">{{ run.content }}</pre>
        <p v-if="run.error" class="production-error">{{ run.error }}</p>
        <div v-if="run.status === 'success' && !isProductionAssetStep(run.step) && run.step !== 'style'" class="production-actions"><button type="button" @click="prepareMedia(run)">{{ run.step === 'storyboard-video' ? '准备视频生成' : '准备图片生成' }}</button></div>
        <MediaPlanCard v-if="run.mediaPlan" :plan="run.mediaPlan" :error="run.error" @approve="submitMedia(run)" @update-parameters="patch => updateRun(run.id, { mediaPlan: { ...run.mediaPlan!, ...patch } })" />
      </section>
    </main>
  </section>
</template>

<style scoped>
.production-workbench { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--surface); color: var(--ink); }
.production-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 18px 12px; border-bottom: 1px solid var(--border); }
.production-header h2, .production-header p { margin: 0; }.production-header h2 { font-size: 17px; }.production-header p { margin-top: 3px; color: var(--ink3); font-size: 11px; }
.production-form input, .production-form textarea { box-sizing: border-box; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--ink); font: inherit; font-size: 12px; padding: 8px; }
.production-model-wrap { position: relative; }.production-model-btn { display: inline-flex; align-items: center; gap: 7px; min-height: 34px; max-width: 260px; padding: 0 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--ink); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }.production-model-menu { z-index: 999; display: grid; gap: 1px; width: 240px; max-height: 360px; overflow-y: auto; padding: 4px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); box-shadow: 0 8px 24px rgba(0, 0, 0, .12); }.production-model-item { min-height: 32px; padding: 7px 12px; border: 0; border-radius: 8px; background: transparent; color: var(--ink2); font: inherit; font-size: 12px; font-weight: 600; text-align: left; cursor: pointer; }.production-model-item:hover, .production-model-item.active { background: var(--olive-pale); color: var(--olive-dark); }.production-model-empty { padding: 8px 12px; color: var(--ink3); font-size: 12px; }.production-model-empty.error { color: var(--jc-error); }
.production-steps { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); border-bottom: 1px solid var(--border); }.production-steps button { min-height: 42px; border: 0; border-right: 1px solid var(--border); outline: none; background: transparent; color: var(--ink3); font: inherit; font-size: 12px; cursor: pointer; }.production-steps button.active { color: var(--olive-dark); background: var(--olive-pale); font-weight: 700; }.production-steps button:focus-visible { outline: 2px solid var(--olive); outline-offset: -2px; }
.production-body { flex: 1; min-height: 0; overflow: auto; padding: 16px 18px 28px; }.production-form, .production-sources { display: grid; gap: 10px; margin-bottom: 14px; }.production-form label { display: grid; gap: 5px; color: var(--ink2); font-size: 12px; }.production-form textarea { resize: vertical; line-height: 1.55; }.production-profile, .production-sources p { color: var(--ink3); font-size: 11px; }.production-section-head { display: flex; align-items: center; justify-content: space-between; }.production-section-head h3 { margin: 0; font-size: 13px; }.production-section-head button, .production-run-card button { border: 0; background: transparent; color: var(--olive-dark); font: inherit; font-size: 11px; cursor: pointer; }
.production-add-source, .production-upload { display: inline-flex; align-items: center; gap: 5px; width: fit-content; min-height: 32px; padding: 0 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--olive-dark); font: inherit; font-size: 12px; cursor: pointer; }.production-upload { border-style: dashed; }.production-upload input { display: none; }.production-source-picker { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); }.production-folder-list, .production-selected-sources, .production-attachments, .production-wiki-link, .production-wiki-scenes { display: flex; flex-wrap: wrap; gap: 5px; }.production-folder-list button, .production-selected-sources button, .production-attachments button, .production-wiki-link button, .production-wiki-scenes button { display: inline-flex; align-items: center; gap: 3px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--ink2); font: inherit; font-size: 11px; cursor: pointer; padding: 4px 6px; }.production-folder-list button.active, .production-wiki-link button.active, .production-wiki-scenes button.active { border-color: var(--olive); background: var(--olive-pale); color: var(--olive-dark); }.production-wiki-scenes p { width: 100%; margin: 2px 0; }.production-wiki-scenes button.muted { opacity: .45; text-decoration: line-through; }.production-source { display: flex; gap: 7px; align-items: flex-start; color: var(--ink2); font-size: 12px; overflow-wrap: anywhere; }
.production-run { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 38px; width: 100%; border: 1px solid var(--olive); border-radius: 6px; background: var(--olive); color: #fff; font: inherit; font-size: 13px; cursor: pointer; }.production-run:disabled { opacity: .55; cursor: wait; }.production-run-card { display: grid; gap: 9px; margin-top: 14px; padding: 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); }.production-run-card header { display: grid; gap: 2px; }.production-run-card strong { font-size: 13px; }.production-run-card small { color: var(--ink3); font-size: 10px; overflow-wrap: anywhere; }.production-run-card pre { max-height: 420px; margin: 0; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--ink2); font: inherit; font-size: 12px; line-height: 1.6; }.production-asset-card { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); }.production-asset-card textarea { width: 100%; box-sizing: border-box; resize: vertical; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--ink); padding: 8px; font: inherit; font-size: 12px; line-height: 1.55; }.production-asset-card > button { width: fit-content; min-height: 32px; padding: 0 10px; border: 1px solid var(--olive); border-radius: 6px; background: var(--olive-pale); color: var(--olive-dark); font: inherit; font-size: 12px; cursor: pointer; }.production-actions { display: flex; gap: 8px; }.production-error { margin: 8px 0; color: #bf3a2d; font-size: 12px; }
</style>

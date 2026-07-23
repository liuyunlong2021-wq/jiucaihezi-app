import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const source = (path: string) => readFileSync(join(root, path), 'utf8')

test('production workbench is a separate six-step surface with no Chat dependency', () => {
  const workbench = source('src/components/workbench/ProductionWorkbench.vue')
  const layout = source('src/layouts/WorkspaceLayout.vue')
  const rail = source('src/components/rail/ActivityRail.vue')

  assert.match(workbench, /buildProductionWorkbenchRequest/)
  assert.match(workbench, /sendSingleTurnWorkbench/)
  assert.match(workbench, /createProductionWikiSkeleton/)
  assert.match(workbench, /saveProductionWikiOutput/)
  assert.match(workbench, /preparePublicMediaPlan/)
  assert.match(workbench, /key: 'scenes'/)
  assert.match(workbench, /key: 'props'/)
  assert.match(workbench, /showModelMenu/)
  assert.match(workbench, /添加资料/)
  assert.match(workbench, /关联项目 Wiki/)
  assert.match(workbench, /resolveProductionWikiScene/)
  assert.match(workbench, /saveProductionWikiBinding/)
  assert.match(workbench, /readProductionWikiBinding/)
  assert.match(workbench, /wikiAnchorPath/)
  assert.match(workbench, /wikiRootCandidates/)
  assert.match(workbench, /linkProjectWiki\(root\)/)
  assert.match(workbench, /本场实体/)
  assert.match(workbench, /parseProductionPromptCards/)
  assert.match(workbench, /v-for="card in run\.cards"/)
  assert.match(workbench, /生成角色图/)
  assert.match(workbench, /@click="prepareAssetMedia\(run, card\)"/)
  assert.match(workbench, /<MediaPlanCard v-if="card\.mediaPlan"/)
  assert.match(workbench, /@approve="submitAssetMedia\(run, card\)"/)
  assert.match(workbench, /agentStore\.fetchModels\(\{ skipOpenCode: true \}\)/)
  assert.match(workbench, /watch\(owner, \(\) => \{\n  runs\.value = \[\]/)
  assert.doesNotMatch(workbench, /成果名称/)
  assert.match(workbench, /<MediaPlanCard/)
  assert.doesNotMatch(workbench, /scene-props|Profile：|<select v-model="modelId"/)
  assert.doesNotMatch(workbench, /ChatPanel|useChat\(|listProductionRuns|saveProductionMediaTask|production-media-plan-submitted|production-media-plan-failed/)
  assert.match(layout, /ProductionWorkbench/)
  assert.match(layout, /isProductionWorkbench/)
  assert.match(rail, /key: 'production'/)
})

test('production media confirmation uses the existing CreationPanel task engine', () => {
  const workbench = source('src/components/workbench/ProductionWorkbench.vue')
  const creation = source('src/components/creation/CreationPanel.vue')

  assert.match(workbench, /production-media-plan-approved/)
  assert.match(creation, /production-media-plan-approved/)
  assert.match(creation, /mediaTaskStore\.submitTask/)
  assert.match(creation, /mediaCardId\?: string/)
  assert.match(creation, /mediaCardId: data\.mediaCardId/)
  assert.doesNotMatch(workbench, /mediaTaskStore\.submitTask|saveProductionMediaTask|production-media-plan-submitted|production-media-plan-failed/)
})

import { spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { build } from 'esbuild'

const outdir = '/private/tmp/jc-focused-tests'

const wave1FocusedTests = [
  'src/components/canvas/__tests__/canvasDocument.test.ts',
  'src/components/canvas/__tests__/canvasCoordinates.test.ts',
  'src/components/canvas/__tests__/canvasAssetUrlResolver.test.ts',
  'src/components/mcp/__tests__/mcpManagerPanel.test.ts',
  'src/components/__tests__/creationPanelContractUi.test.ts',
  'src/components/__tests__/desktopProjectDrop.test.ts',
  'src/components/chat/display/__tests__/streamingTextRenderer.test.ts',
  'src/components/chat/display/__tests__/markdownDisplayPolicy.test.ts',
  'src/components/__tests__/skillSourcesContract.test.ts',
  'src/composables/__tests__/useContentEditable.test.ts',
  'src/composables/__tests__/webDirectEngine.test.ts',
  'src/composables/__tests__/useCreationPlanMaterialization.test.ts',
  'src/runtime/direct/__tests__/directStream.test.ts',
  'src/runtime/direct/__tests__/directTools.test.ts',
  'src/runtime/direct/__tests__/creativeMemory.test.ts',
  'src/runtime/direct/__tests__/directEngine.test.ts',
  'src/runtime/direct/__tests__/modelInputCapabilities.test.ts',
  'src/runtime/direct/__tests__/directAttachmentErrors.test.ts',
  'src/runtime/direct/__tests__/webProjectTools.test.ts',
  'src/runtime/direct/__tests__/desktopProjectTools.test.ts',
  'src/runtime/direct/__tests__/creativeSkillCatalog.test.ts',
  'src/runtime/direct/__tests__/toolSearch.test.ts',
  'src/components/memory/__tests__/memoryWorkbench.test.ts',
  'src/runtime/memory/__tests__/markdownFileLinks.test.ts',
  'src/runtime/memory/__tests__/conversationTranscript.test.ts',
  'src/runtime/memory/__tests__/conversationMemoryIndex.test.ts',
  'src/runtime/memory/__tests__/conversationMemorySummary.test.ts',
  'src/runtime/memory/__tests__/memoryProject.test.ts',
  'src/runtime/memory/__tests__/memoryToolRouting.test.ts',
  'src/runtime/memory/__tests__/memoryToolPolicy.test.ts',
  'src/runtime/memory/__tests__/skillCreatorToolExecutor.test.ts',
  'src/runtime/memory/__tests__/scene3d.test.ts',
  'src/runtime/memory/__tests__/skillInstall.test.ts',
  'src/runtime/creation/__tests__/creationMediaPlan.test.ts',
  'src/runtime/creation/__tests__/creationMediaRuntime.test.ts',
  'src/runtime/creation/__tests__/localComfyRuntime.test.ts',
  'src/runtime/workbench/__tests__/mediaReference.test.ts',
  'src/runtime/workbench/__tests__/mediaPlan.test.ts',
  'src/runtime/workbench/__tests__/mediaPlanBridge.test.ts',
  'src/composables/__tests__/officeTools.test.ts',
  'src/runtime/tools/__tests__/kernel.test.ts',
  'src/runtime/tools/__tests__/artifacts.test.ts',
  'src/runtime/tools/__tests__/skillCreatorRuntime.test.ts',
  'src/runtime/tools/__tests__/skillBuilderRuntime.test.ts',
  'src/runtime/tools/__tests__/jobRunner.test.ts',
  'src/runtime/tools/__tests__/mcpBridge.test.ts',
  'src/runtime/connection/__tests__/toolConnection.test.ts',
  'src/stores/__tests__/agentStore.test.ts',
  'src/stores/__tests__/skillsManageStore.test.ts',
  'src/utils/__tests__/skillDisplayAlias.test.ts',
  'src/utils/__tests__/centralSkillViewModel.test.ts',
  'src/utils/__tests__/skillsSettingsViewModel.test.ts',
  'src/stores/__tests__/mediaTaskStore.test.ts',
  'src/utils/__tests__/apiConfig.test.ts',
  'src/utils/__tests__/httpClient.test.ts',
  'src/utils/__tests__/gatewayClient.test.ts',
  'src/utils/__tests__/runTrace.test.ts',
  'src/utils/__tests__/contextAssembly.test.ts',
  'src/utils/__tests__/providerCapabilityProbe.test.ts',
  'src/utils/__tests__/runtimeCapabilities.test.ts',
  'src/utils/__tests__/tauriEnv.test.ts',
  'src/utils/__tests__/llmRuntime.test.ts',
  'src/utils/__tests__/confirmAction.test.ts',
  'src/utils/__tests__/confirmUsageGuard.test.ts',
  'src/utils/__tests__/localDocx.test.ts',
  'src/utils/__tests__/documentMarkdown.test.ts',
  'src/utils/__tests__/projectMaterials.test.ts',
  'src/utils/__tests__/memoryProjectPaths.test.ts',
  'src/utils/__tests__/localContentTools.test.ts',
  'src/utils/__tests__/localCapabilities.test.ts',
  'src/utils/__tests__/localToolsPreference.test.ts',
  'src/utils/__tests__/comfyUiRuntime.test.ts',
  'src/utils/__tests__/localMlxRuntime.test.ts',
  'src/utils/__tests__/providerConfig.test.ts',
  'src/utils/__tests__/directMessageBuilder.test.ts',
  'src/utils/__tests__/modelSelection.test.ts',
  'src/utils/__tests__/qrCode.test.ts',
  'src/utils/__tests__/skillTextBuilder.test.ts',
  'src/utils/__tests__/skillBuilderTools.test.ts',
  'src/utils/__tests__/skillMaterialCompiler.test.ts',
  'src/utils/__tests__/skillMaterialNormalizer.test.ts',
  'src/utils/__tests__/skillMaterialRuntime.test.ts',
  'src/utils/__tests__/skillPackageStorage.test.ts',
  'src/utils/__tests__/skillWarehouseMenu.test.ts',
  'src/utils/__tests__/skillTestRunner.test.ts',
  'src/utils/__tests__/skillCreatorWorkspace.test.ts',
  'src/utils/__tests__/skillCreatorScriptRunner.test.ts',
  'src/utils/__tests__/fileEntryFilters.test.ts',
  'src/utils/__tests__/webProjectFiles.test.ts',
  'src/utils/__tests__/webProjectBinaryStore.test.ts',
  'src/utils/__tests__/webProjectTransfer.test.ts',
  'src/utils/__tests__/creationMediaCacheWeb.test.ts',
  'src/utils/__tests__/skillContentResolver.test.ts',
  'src/utils/__tests__/mediaDisplayAsset.test.ts',
  'src/utils/__tests__/urlSafety.test.ts',
  'src/utils/__tests__/fileDownload.test.ts',
  'src/utils/__tests__/officeDownloads.test.ts',
  'src/utils/__tests__/messageDisplay.test.ts',
  'src/utils/__tests__/exportSave.test.ts',
  'src/utils/__tests__/eventBus.test.ts',
  'src/utils/__tests__/todoTools.test.ts',
  'src/utils/__tests__/toolRegistry.test.ts',
  'src/data/__tests__/mediaModelCapabilities.test.ts',
  'src/data/__tests__/modelContextWindows.test.ts',
  'src/api/__tests__/mediaGenerationModelGuard.test.ts',
  'src/data/__tests__/mediaModelInputValidation.test.ts',
  'src/services/__tests__/apiKeyCallback.test.ts',
  'src/services/__tests__/mcpOAuth.test.ts',
  'src/services/__tests__/mcpOAuthCredentialCache.test.ts',
  'src/services/__tests__/mcpClientRestore.test.ts',
  'src/services/__tests__/mcpStdioLifecycle.test.ts',
  'src/services/__tests__/projectFileService.test.ts',
  'src/services/__tests__/projectFileActions.test.ts',
  'src/services/__tests__/projectExplorerService.test.ts',
  'src/services/__tests__/projectResourceWatcher.test.ts',
  'src/services/__tests__/newApiOneClickLogin.test.ts',
  'src/services/__tests__/textSyncClient.test.ts',
  'src/services/__tests__/projectTextSync.test.ts',
  'src/services/__tests__/creationModelAvailability.test.ts',
  'src/utils/__tests__/creationResults.test.ts',
  'src/components/filetree/__tests__/projectFileTreeCanvas.test.ts',
  'src/components/chat/display/__tests__/autoScrollPolicy.test.ts',
  'src/utils/__tests__/idbPath.test.ts',
  'src/utils/__tests__/mediaAssetTypes.test.ts',
  'src/utils/__tests__/projectResource.test.ts',
]

const externalNodeTests = [
  'scripts/creation-models/__tests__/server.test.mjs',
  'scripts/__tests__/audit-skills-manage-parity.test.mjs',
  'scripts/__tests__/create-official-dmg.test.mjs',
  'scripts/__tests__/memory-product-separation.test.mjs',
  'scripts/__tests__/windows-release-contract.test.mjs',
  // ponytail: rh-deploy config test removed — canvas archived, canvasModels.ts gone
]

// Registered for removal with the old product; do not make current Memory baseline depend on them.
const legacyOrSupersededTests = [
  'scripts/rh-deploy/__tests__/config.test.mjs',
  'src/composables/__tests__/useCreationFileFiltering.test.ts',
  'src/runtime/connection/__tests__/architectureGuards.test.ts',
  'src/runtime/connection/__tests__/runtimeConnection.test.ts',
  'src/runtime/connection/__tests__/skillApplicability.test.ts',
  'src/runtime/connection/__tests__/skillConnection.test.ts',
  'src/services/__tests__/desktopBrowserLogin.test.ts',
  'src/utils/__tests__/chatToolPolicy.test.ts',
  'src/utils/__tests__/devProjectTools.test.ts',
  'src/utils/__tests__/fileTreeView.test.ts',
  'src/utils/__tests__/longFormPolicy.test.ts',
  'src/utils/__tests__/materialSymbolsCoverage.test.ts',
  'src/utils/__tests__/mediaDisplayResolver.test.ts',
  'src/utils/__tests__/messageExport.test.ts',
  'src/utils/__tests__/runninghubGatewayPolicy.test.ts',
  'src/utils/__tests__/webDataMigration.test.ts',
]

void legacyOrSupersededTests

function compiledTestPath(sourcePath) {
  return `${outdir}/${sourcePath.replace(/^src\//, '').replace(/\.ts$/, '.js')}`
}

async function buildFocusedTests() {
  if (existsSync(outdir)) rmSync(outdir, { recursive: true, force: true })
  await build({
    entryPoints: wave1FocusedTests,
    bundle: true,
    platform: 'node',
    format: 'esm',
    alias: { '@': './src' },
    outbase: 'src',
    outdir,
  })
}

async function runFocusedTests() {
  const files = [
    ...wave1FocusedTests.map(compiledTestPath),
    ...externalNodeTests,
  ]
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', ...files], { stdio: 'inherit' })
    child.on('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`node --test exited with code ${code}`))
    })
    child.on('error', reject)
  })
}

const command = process.argv[2]
if (command === 'build') {
  await buildFocusedTests()
} else if (command === 'run') {
  await runFocusedTests()
} else {
  throw new Error('Usage: node scripts/run-focused-tests.mjs <build|run>')
}

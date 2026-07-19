import { spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { build } from 'esbuild'

const outdir = '/private/tmp/jc-focused-tests'

const wave1FocusedTests = [
  'src/components/canvas/__tests__/canvasDocument.test.ts',
  'src/components/canvas/__tests__/canvasAssetUrlResolver.test.ts',
  'src/components/__tests__/settingsApiActions.test.ts',
  'src/components/__tests__/creationPanelContractUi.test.ts',
  'src/components/chat/display/__tests__/textDiagnostics.test.ts',
  'src/components/chat/display/__tests__/messageDisplayModel.test.ts',
  'src/components/chat/display/__tests__/toolDisplayModel.test.ts',
  'src/components/chat/display/__tests__/streamSmoother.test.ts',
  'src/components/chat/display/__tests__/progressiveStreamReveal.test.ts',
  'src/components/chat/display/__tests__/streamCommitScheduler.test.ts',
  'src/components/chat/display/__tests__/streamingTextRenderer.test.ts',
  'src/components/chat/display/__tests__/conversationExperienceTrace.test.ts',
  'src/components/chat/display/__tests__/markdownDisplayPolicy.test.ts',
  'src/components/chat/display/__tests__/continuationDisplayModel.test.ts',
  'src/components/__tests__/chatMessagePresentation.test.ts',
  'src/components/__tests__/skillSourcesContract.test.ts',
  'src/composables/__tests__/useChatControls.test.ts',
  'src/composables/__tests__/useContentEditable.test.ts',
  'src/composables/__tests__/webDirectEngine.test.ts',
  'src/composables/__tests__/creativeChat.test.ts',
  'src/composables/__tests__/useCreationPlanMaterialization.test.ts',
  'src/runtime/direct/__tests__/directStream.test.ts',
  'src/runtime/direct/__tests__/directTools.test.ts',
  'src/runtime/direct/__tests__/creativeMemory.test.ts',
  'src/runtime/direct/__tests__/directEngine.test.ts',
  'src/runtime/direct/__tests__/webProjectTools.test.ts',
  'src/runtime/direct/__tests__/desktopProjectTools.test.ts',
  'src/runtime/direct/__tests__/creativeSkillCatalog.test.ts',
  'src/runtime/creation/__tests__/creationMediaPlan.test.ts',
  'src/runtime/creation/__tests__/creationMediaRuntime.test.ts',
  'src/runtime/workbench/__tests__/mediaPlan.test.ts',
  'src/runtime/workbench/__tests__/mediaPlanBridge.test.ts',
  'src/runtime/workbench/__tests__/ecommercePlanner.test.ts',
  'src/runtime/workbench/__tests__/workbenchManifest.test.ts',
  'src/composables/__tests__/officeTools.test.ts',
  'src/opencodeClient/__tests__/messageMapper.test.ts',
  'src/opencodeClient/__tests__/diffReview.test.ts',
  'src/opencodeClient/__tests__/eventBridge.test.ts',
  'src/opencodeClient/__tests__/client.test.ts',
  'src/opencodeClient/__tests__/eventReducer.test.ts',
  'src/opencodeClient/__tests__/identifier.test.ts',
  'src/opencodeClient/__tests__/providerProjection.test.ts',
  'src/opencodeClient/__tests__/interactive.test.ts',
  'src/opencodeClient/__tests__/runEvents.test.ts',
  'src/opencodeClient/__tests__/sdkContract.test.ts',
  'src/opencodeClient/__tests__/session.test.ts',
  'src/opencodeClient/__tests__/sessionCommands.test.ts',
  'src/opencodeClient/__tests__/shellDisplay.test.ts',
  'src/opencodeClient/__tests__/skillScope.test.ts',
  'src/runtime/tools/__tests__/kernel.test.ts',
  'src/runtime/tools/__tests__/artifacts.test.ts',
  'src/runtime/tools/__tests__/skillCreatorRuntime.test.ts',
  'src/runtime/tools/__tests__/skillBuilderRuntime.test.ts',
  'src/runtime/tools/__tests__/jobRunner.test.ts',
  'src/runtime/tools/__tests__/mcpBridge.test.ts',
  'src/runtime/connection/__tests__/toolConnection.test.ts',
  'src/stores/__tests__/agentStore.test.ts',
  'src/stores/__tests__/creativeSessionStore.test.ts',
  'src/stores/__tests__/ecommerceWorkbenchStore.test.ts',
  'src/stores/__tests__/webSessionHistory.test.ts',
  'src/stores/__tests__/openCodeSyncStore.test.ts',
  'src/stores/__tests__/skillsManageStore.test.ts',
  'src/layouts/__tests__/workspaceLayoutSizing.test.ts',
  'src/components/workbench/__tests__/ecommerceWorkbench.test.ts',
  'src/utils/__tests__/skillDisplayAlias.test.ts',
  'src/utils/__tests__/i18n.test.ts',
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
  'src/utils/__tests__/llmRuntime.test.ts',
  'src/utils/__tests__/confirmAction.test.ts',
  'src/utils/__tests__/confirmUsageGuard.test.ts',
  'src/utils/__tests__/localDocx.test.ts',
  'src/utils/__tests__/documentMarkdown.test.ts',
  'src/utils/__tests__/localContentTools.test.ts',
  'src/utils/__tests__/localCapabilities.test.ts',
  'src/utils/__tests__/localDocxV2.test.ts',
  'src/components/editor/__tests__/editorSessionStore.test.ts',
  'src/components/editor/__tests__/editorInteractionSurface.test.ts',
  'src/utils/__tests__/localToolsPreference.test.ts',
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
  'src/utils/__tests__/openCodeP3UiPolicy.test.ts',
  'src/utils/__tests__/opencodeRuntimePackaging.test.ts',
  'src/utils/__tests__/messageDisplay.test.ts',
  'src/utils/__tests__/exportSave.test.ts',
  'src/utils/__tests__/eventBus.test.ts',
  'src/utils/__tests__/todoTools.test.ts',
  'src/utils/__tests__/vaultScaffold.test.ts',
  'src/utils/__tests__/toolRegistry.test.ts',
  'src/data/__tests__/mediaModelCapabilities.test.ts',
  'src/api/__tests__/mediaGenerationModelGuard.test.ts',
  'src/data/__tests__/mediaModelInputValidation.test.ts',
  'src/services/__tests__/apiKeyCallback.test.ts',
  'src/services/__tests__/mcpOAuth.test.ts',
  'src/services/__tests__/projectFileService.test.ts',
  'src/services/__tests__/projectFileActions.test.ts',
  'src/services/__tests__/projectExplorerService.test.ts',
  'src/services/__tests__/projectResourceWatcher.test.ts',
  'src/services/__tests__/newApiOneClickLogin.test.ts',
  'src/services/__tests__/creationModelAvailability.test.ts',
  'src/utils/__tests__/creationResults.test.ts',
  'src/components/__tests__/desktopOpenCodeSyncCutover.test.ts',
  'src/components/__tests__/desktopProjectDrop.test.ts',
  'src/components/filetree/__tests__/projectFileTreeCanvas.test.ts',
]

const externalNodeTests = [
  'scripts/creation-models/__tests__/server.test.mjs',
  // ponytail: rh-deploy config test removed — canvas archived, canvasModels.ts gone
]

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

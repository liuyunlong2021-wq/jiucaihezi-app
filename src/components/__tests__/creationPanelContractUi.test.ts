import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = process.cwd()

test('creation panel reads registry-backed plan state instead of legacy RH-only model heuristics', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(source, /CREATION_PANEL_MODELS/)
  assert.match(source, /currentCreationSpec/)
  assert.match(source, /currentRunPlan/)
  assert.match(source, /currentRunPlanError/)
  assert.match(source, /currentSubmitSummary/)
  assert.doesNotMatch(source, /currentContractWarnings/)
  assert.doesNotMatch(source, /cp-contract-warnings/)

  assert.doesNotMatch(source, /RH_CREATION_MODELS/)
  assert.doesNotMatch(source, /validateMediaModelInputs/)
  assert.doesNotMatch(source, /const rhMode = computed/)
})

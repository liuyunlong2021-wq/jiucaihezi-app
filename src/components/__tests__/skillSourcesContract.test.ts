import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const memoryWorkbench = readFileSync('src/components/memory/MemoryWorkbench.vue', 'utf8')
const centralPanel = readFileSync('src/components/skills/CentralSkillsPanel.vue', 'utf8')
const webPanel = readFileSync('src/components/skills/WebSkillPanel.vue', 'utf8')
const builtInList = readFileSync('src/components/skills/BuiltInSkillList.vue', 'utf8')
const settingsPanel = readFileSync('src/components/skills/SkillsSettingsPanel.vue', 'utf8')
const scanner = readFileSync('src-tauri/src/skills/scanner.rs', 'utf8')
const skillsDb = readFileSync('src-tauri/src/skills/db.rs', 'utf8')

test('memory workbench reads installed Skills from the shared store', () => {
  assert.match(memoryWorkbench, /agentStore\.getCustomSkills\(\)/)
  assert.match(memoryWorkbench, /agentStore\.refreshSkills\(\)/)
  assert.match(memoryWorkbench, /loadWebSkillCatalog\(\)/)
  assert.doesNotMatch(memoryWorkbench, /openCodeSkills|mergeCreativeSkillCatalog/)
})

test('settings exposes the bundled public Skills without copying them into central storage', () => {
  assert.match(settingsPanel, /loadWebSkillCatalog\(\)/)
  assert.match(settingsPanel, /public\/skills\/\{\{ skill\.id \}\}\/SKILL\.md/)
  assert.match(settingsPanel, /韭菜盒子内置 Skill/)
})

test('Desktop keeps the bundled list while Web exposes only user-installed Skills', () => {
  assert.match(centralPanel, /viewMode === 'builtin'/)
  assert.match(centralPanel, /<BuiltInSkillList :skills="visibleBuiltInSkills"/)
  assert.match(webPanel, />自建</)
  assert.match(webPanel, /store\.getCustomSkills\(\)/)
  assert.match(webPanel, /openCreate\(/)
  assert.match(webPanel, /openEdit\(skill: SkillConfig\)/)
  assert.match(webPanel, /await store\.createAgent\(skill\)/)
  assert.match(webPanel, /store\.updateSkill\(editingSkill\.value\.id, skill\)/)
  assert.match(webPanel, /await store\.deleteAgent\(skill\.id\)/)
  assert.doesNotMatch(webPanel, /BuiltInSkillList|内置 Skill/)
  assert.doesNotMatch(builtInList, /<button/)
})

test('Desktop no longer copies bundled Skills into the user directory', () => {
  assert.match(scanner, /scan_product_skills_impl/)
  assert.match(scanner, /Bundled Skills stay in app resources/)
  assert.match(skillsDb, /remove_seeded_preset_skills/)
  assert.doesNotMatch(skillsDb, /pub async fn seed_preset_skills/)
  assert.doesNotMatch(skillsDb, /copy_dir_recursive/)
})

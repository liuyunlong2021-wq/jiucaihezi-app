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
  assert.match(webPanel, /打开本地目录/)
  assert.match(webPanel, /invoke\('open_central_skills_directory'\)/)
  assert.match(webPanel, /store\.getCustomSkills\(\)/)
  assert.match(webPanel, /openCreate\(/)
  assert.match(webPanel, /openEdit\(skill: SkillConfig\)/)
  assert.match(webPanel, /emitEvent\('skill-creator-edit'/)
  // 文件能力合同：中央 Skill 在项目外，预填必须是绝对目录，不能用项目内相对路径
  assert.match(webPanel, /skillPath: skill\.packagePath \|\| ''/)
  // 新建入口与修改对称：预填中央 Skill 根目录的绝对路径，模型才能直接落盘
  assert.match(webPanel, /emitEvent\('skill-creator-create', \{ skillsRoot: centralSkillsRoot\.value \}\)/)
  assert.match(webPanel, /@click="requestSkillCreate"/)
  assert.match(webPanel, /store\.getCustomSkills\(\)\.find\(skill => \/\^\\\/\/\.test\(String\(skill\.packagePath \|\| ''\)\)\)/)
  assert.doesNotMatch(webPanel, /\.agents\/skills\/\$\{skill\.id\}\/SKILL\.md/)
  assert.match(webPanel, /修改<\/button>/)
  assert.match(webPanel, /await store\.createAgent\(skill\)/)
  assert.match(webPanel, /store\.updateSkill\(editingSkill\.value\.id, skill\)/)
  assert.match(webPanel, /await store\.deleteAgent\(skill\.id\)/)
  assert.doesNotMatch(webPanel, /BuiltInSkillList/)
  assert.match(webPanel, /loadWebSkillCatalog\(\)/)
  assert.match(webPanel, /customizeBuiltInSkill/)
  assert.match(webPanel, /定制/)
  assert.doesNotMatch(builtInList, /<button/)
})

test('Desktop no longer copies bundled Skills into the user directory', () => {
  assert.match(scanner, /scan_product_skills_impl/)
  assert.match(scanner, /Bundled Skills stay in app resources/)
  assert.match(skillsDb, /remove_seeded_preset_skills/)
  assert.doesNotMatch(skillsDb, /pub async fn seed_preset_skills/)
  assert.doesNotMatch(skillsDb, /copy_dir_recursive/)
})

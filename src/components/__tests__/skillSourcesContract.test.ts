import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const chatPanel = readFileSync('src/components/chat/ChatPanel.vue', 'utf8')
const centralPanel = readFileSync('src/components/skills/CentralSkillsPanel.vue', 'utf8')
const webPanel = readFileSync('src/components/skills/WebSkillPanel.vue', 'utf8')
const builtInList = readFileSync('src/components/skills/BuiltInSkillList.vue', 'utf8')
const scanner = readFileSync('src-tauri/src/skills/scanner.rs', 'utf8')
const skillsDb = readFileSync('src-tauri/src/skills/db.rs', 'utf8')

test('Desktop combines only local and bundled Skill sources before selection and loading', () => {
  assert.match(chatPanel, /mergeCreativeSkillCatalog\(skillsManageStore\.centralSkills, builtInSkills\.value\)/)
  assert.match(chatPanel, /loadWebSkillCatalog\(\)/)
  assert.match(chatPanel, /if \(isTauriRuntime\(\)\) return desktopProductSkills\.value/)
  assert.doesNotMatch(chatPanel, /for \(const skill of openCodeSkills\.value\)/)
})

test('bundled Skill list is browse-only in both Desktop and Web repositories', () => {
  assert.match(centralPanel, /viewMode === 'builtin'/)
  assert.match(centralPanel, /<BuiltInSkillList :skills="visibleBuiltInSkills"/)
  assert.match(webPanel, /<BuiltInSkillList v-else :skills="builtInSkills"/)
  assert.doesNotMatch(builtInList, /<button/)
})

test('Desktop no longer copies bundled Skills into the user directory', () => {
  assert.match(scanner, /scan_product_skills_impl/)
  assert.match(scanner, /Bundled Skills stay in app resources/)
  assert.match(skillsDb, /remove_seeded_preset_skills/)
  assert.doesNotMatch(skillsDb, /pub async fn seed_preset_skills/)
  assert.doesNotMatch(skillsDb, /copy_dir_recursive/)
})

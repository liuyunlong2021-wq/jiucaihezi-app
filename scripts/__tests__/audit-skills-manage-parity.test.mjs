import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { tmpdir } from 'node:os'

import {
  auditSkillsManageParity,
  extractInterfaceFields,
  extractRegisteredSkillCommands,
} from '../audit-skills-manage-parity.mjs'

test('extractRegisteredSkillCommands reads names from skills namespace handlers', () => {
  const source = `
    .invoke_handler(tauri::generate_handler![
      skills::scanner::scan_all_skills,
      skills::agents::get_agents,
      other::ignored::command,
    ])
  `

  assert.deepEqual(extractRegisteredSkillCommands(source), ['get_agents', 'scan_all_skills'])
})

test('extractInterfaceFields handles optional fields and nested array object types', () => {
  const source = `
    export interface SkillDetail extends Omit<Skill, 'content'> {
      row_id?: string | null
      installations: Array<{ agent_id: string; installed_at?: string }>
      collections?: Collection[]
    }
  `

  assert.deepEqual(extractInterfaceFields(source, 'SkillDetail'), [
    'collections',
    'installations',
    'row_id',
  ])
  assert.equal(extractInterfaceFields(source, 'Missing'), null)
})

test('auditSkillsManageParity fails when required local pieces are missing', () => {
  const root = join(tmpdir(), `jc-parity-${Date.now()}`)
  mkdirSync(join(root, 'src-tauri/src/skills'), { recursive: true })
  mkdirSync(join(root, 'src/types'), { recursive: true })
  mkdirSync(join(root, 'src/i18n'), { recursive: true })
  mkdirSync(join(root, 'src/components/skills'), { recursive: true })
  writeFileSync(
    join(root, 'src-tauri/src/lib.rs'),
    'skills::scanner::scan_all_skills, skills::agents::get_agents,',
  )
  writeFileSync(join(root, 'src-tauri/src/skills/scanner.rs'), '')
  writeFileSync(
    join(root, 'src/types/skillsManage.ts'),
    'export interface AgentWithStatus { id: string }',
  )
  writeFileSync(join(root, 'src/i18n/index.ts'), 'Skill Central Skills Platform')

  const report = auditSkillsManageParity(root, {
    repo: 'test',
    branch: 'main',
    commit: 'abc',
    commitDate: 'now',
    commands: ['scan_all_skills', 'get_agents', 'missing_command'],
    rustModules: ['scanner.rs', 'missing.rs'],
    typeFields: {
      AgentWithStatus: ['id', 'display_name'],
    },
    i18nTerms: ['Skill', 'Marketplace'],
  })

  assert.equal(report.ok, false)
  assert.deepEqual(report.results[0].missing, ['missing_command'])
  assert.deepEqual(report.results[1].missing, ['missing.rs'])
  assert.deepEqual(report.results[2].issues, [{
    interfaceName: 'AgentWithStatus',
    missingFields: ['display_name'],
  }])
  assert.equal(report.results[3].status, 'warn')
  assert.deepEqual(report.results[3].missing, ['Marketplace'])
})

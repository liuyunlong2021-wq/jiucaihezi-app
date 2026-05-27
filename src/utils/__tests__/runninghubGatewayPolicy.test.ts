import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const skillRoot = join(process.cwd(), 'public/skills/runninghub')

function readSkillFile(relativePath: string) {
  return readFileSync(join(skillRoot, relativePath), 'utf8')
}

test('bundled RunningHub skill does not guide desktop users to configure upstream API keys', () => {
  const publicGuidance = [
    'SKILL.md',
    'references/api-key-setup.md',
    'references/output-delivery.md',
    'data/my-workflows.json',
  ].map(readSkillFile).join('\n')

  for (const forbidden of [
    'primaryEnv',
    'RUNNINGHUB_API_KEY',
    'Create API Key',
    '创建 Key',
    '发 Key 给我',
    'Save Key',
    'sharedApi',
    'skills.entries.runninghub.apiKey',
    'profiles.<name>.apiKey',
  ]) {
    assert.equal(publicGuidance.includes(forbidden), false, `public guidance contains ${forbidden}`)
  }

  assert.match(publicGuidance, /Gateway/)
  assert.match(publicGuidance, /会员/)
})

test('RunningHub script no-key path points users back to Gateway account membership', () => {
  const script = [
    'scripts/runninghub.py',
    'scripts/runninghub_app.py',
  ].map(readSkillFile).join('\n')

  for (const forbidden of [
    'Create API Key at',
    'Register/login at https://www.runninghub.cn',
    'Recharge wallet at https://www.runninghub.cn/vip-rights/4',
    'under profiles.<name>.apiKey',
    'skills.entries.runninghub.apiKey',
    'read_key_from_workflow_registry',
    'read_key_from_openclaw_config',
    'RUNNINGHUB_API_KEY',
    '--api-key',
    'args.api_key',
    'apiKey',
    'provided_key',
  ]) {
    assert.equal(script.includes(forbidden), false, `script no-key path contains ${forbidden}`)
  }

  assert.match(script, /Gateway/)
  assert.match(script, /会员/)
})

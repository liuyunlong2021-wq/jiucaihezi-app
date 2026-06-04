import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildSkillCreatorScriptCommand,
  isSkillCreatorScriptName,
} from '../skillCreatorScriptRunner'

test('buildSkillCreatorScriptCommand maps official skill-creator scripts with safe arguments', () => {
  const command = buildSkillCreatorScriptCommand({
    scriptName: 'quick_validate.py',
    skillCreatorRoot: '/app/public/skills/skill-creator',
    args: { skill_dir: '/tmp/workspace/skill' },
  })

  assert.equal(command.program, 'python3')
  assert.deepEqual(command.args, [
    '/app/public/skills/skill-creator/scripts/quick_validate.py',
    '/tmp/workspace/skill',
  ])
  assert.equal(command.timeoutMs, 30000)
})

test('buildSkillCreatorScriptCommand blocks unknown scripts and shell-like arguments', () => {
  assert.equal(isSkillCreatorScriptName('package_skill.py'), true)
  assert.equal(isSkillCreatorScriptName('../evil.py'), false)

  assert.throws(
    () => buildSkillCreatorScriptCommand({
      scriptName: 'package_skill.py',
      skillCreatorRoot: '/app/public/skills/skill-creator',
      args: { skill_dir: '/tmp/workspace/skill; rm -rf /' },
    }),
    /不安全/,
  )
})

test('buildSkillCreatorScriptCommand rejects traversal in roots and path args', () => {
  assert.throws(
    () => buildSkillCreatorScriptCommand({
      scriptName: 'quick_validate.py',
      skillCreatorRoot: '/app/public/skills/../other-skill',
      args: { skill_dir: '/tmp/workspace/skill' },
    }),
    /路径不安全/,
  )

  assert.throws(
    () => buildSkillCreatorScriptCommand({
      scriptName: 'quick_validate.py',
      skillCreatorRoot: '/app/public/skills/skill-creator',
      args: { skill_dir: '/tmp/workspace/../secret' },
    }),
    /路径不安全/,
  )
})

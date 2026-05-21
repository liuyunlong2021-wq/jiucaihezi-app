import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildMissingProjectRootResult,
  getDevProjectToolDefinitions,
  hasUnsafeShellSyntax,
  isAllowedDevCommandProgram,
  normalizeProjectRelativePath,
  parseDevCommand,
} from '../devProjectTools'

test('normalizes safe project-relative paths', () => {
  assert.equal(normalizeProjectRelativePath('src/../src/App.vue'), 'src/App.vue')
  assert.equal(normalizeProjectRelativePath('./package.json'), 'package.json')
  assert.equal(normalizeProjectRelativePath(''), '.')
})

test('rejects absolute and parent-traversal paths', () => {
  assert.throws(() => normalizeProjectRelativePath('/Users/by3/.ssh/id_rsa'), /必须是项目内相对路径/)
  assert.throws(() => normalizeProjectRelativePath('../secret.txt'), /不能跳出项目目录/)
})

test('detects shell syntax that should not run through dev commands', () => {
  assert.equal(hasUnsafeShellSyntax('pnpm build'), false)
  assert.equal(hasUnsafeShellSyntax('cargo check --manifest-path src-tauri/Cargo.toml'), false)
  assert.equal(hasUnsafeShellSyntax('pnpm build && rm -rf dist'), true)
  assert.equal(hasUnsafeShellSyntax('cat package.json | pbcopy'), true)
  assert.equal(hasUnsafeShellSyntax('echo hi > out.txt'), true)
})

test('parses dev commands without invoking a shell', () => {
  assert.deepEqual(parseDevCommand('pnpm tauri build'), {
    program: 'pnpm',
    args: ['tauri', 'build'],
  })
})

test('allows common developer command programs and rejects destructive programs', () => {
  assert.equal(isAllowedDevCommandProgram('pnpm'), true)
  assert.equal(isAllowedDevCommandProgram('cargo'), true)
  assert.equal(isAllowedDevCommandProgram('rm'), false)
  assert.equal(isAllowedDevCommandProgram('/bin/rm'), false)
})

test('returns clear missing project root result', () => {
  const result = JSON.parse(buildMissingProjectRootResult('dev_read_file'))

  assert.equal(result.status, 'error')
  assert.equal(result.error, 'DEV_PROJECT_ROOT_REQUIRED')
  assert.equal(result.tool, 'dev_read_file')
})

test('exposes local dev runtime v2 tools', () => {
  assert.deepEqual(
    getDevProjectToolDefinitions().map(tool => tool.function.name),
    [
      'dev_detect_project',
      'dev_list_files',
      'dev_search_text',
      'dev_read_file',
      'dev_read_many_files',
      'dev_write_file',
      'dev_replace_in_file',
      'dev_get_diff',
      'dev_run_command',
    ],
  )
})

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'

const source = path => readFileSync(path, 'utf8')

function testFiles(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) testFiles(path, files)
    else if (/\.(test|spec)\.(ts|mjs|js)$/.test(entry.name)) files.push(relative(process.cwd(), path))
  }
  return files
}

test('every repository test is registered exactly once as focused or legacy', () => {
  const runner = source('scripts/run-focused-tests.mjs')
  const registered = [...runner.matchAll(/'(\S+\.(?:test|spec)\.(?:ts|mjs|js))'/g)].map(match => match[1])
  const actual = [...testFiles('src'), ...testFiles('scripts')].sort()

  assert.deepEqual([...new Set(registered)].sort(), actual)
  assert.equal(registered.length, new Set(registered).size)
})

test('memory product keeps its entry, release identity, updater, and desktop release jobs', () => {
  const app = source('src/App.vue')
  const desktop = JSON.parse(source('src-tauri/tauri.conf.json'))
  const ios = JSON.parse(source('src-tauri/tauri.ios.conf.json'))
  const workflow = source('.github/workflows/build.yml')

  assert.match(app, /<MemoryWorkbench \/>/)
  assert.equal(desktop.identifier, 'com.jiucaihezi.desktop')
  assert.deepEqual(desktop.plugins['deep-link'].desktop.schemes, ['jiucaihezi'])
  assert.deepEqual(desktop.plugins.updater.endpoints, [
    'https://api.jiucaihezi.studio/updates/latest.json',
  ])
  assert.equal(desktop.plugins.updater.pubkey, 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAssh62kcmRsQtptzYi90tkEEF8kCxYB3QFwEbpRBlgCLFTXGwvb5u80UOERpBoPgeAf86I88n05eFVaPP44qJ9Rs08NHzrSPLRuEm/rTJ0sLpAMEUO+20G5dm73FlaHxE3uHJn2f4dIf9S7IqEBJG7zelsJlCuXqMgLJH9IRdn3Iinw4ll2fyii0yQzNlzdbbhNbRYqla5zWLXHUzoIi4ud2GXlFBDRTm43KdqU4+9QCpfqd8j4QG7/W2EGbyPBFMWTI6j5hA4U61hS4GPcZovWRoCZQwEBy5AR/rF/w3ms39ng7EhfD1G6FfzgQpZRZVnRnJge4qcuOE5OfTVEDa4wIDAQAB')
  assert.equal(ios.identifier, 'com.jiucaihezi.mobile')
  for (const job of ['macos-arm:', 'macos-intel:', 'windows:']) assert.match(workflow, new RegExp(`^  ${job}`, 'm'))
  assert.match(workflow, /needs: \[macos-arm, macos-intel, windows\]/)
})

test('legacy product-only paths are removed from the memory repository', () => {
  const legacyPaths = [
    'src/StudioApp.vue',
    'scripts/remove-canvas.sh',
    'src/layouts',
    'src/components/rail',
    'src/components/workbench',
    'src/components/agents',
    'src/components/plugins',
    'src/plugin',
    'src/plugins',
    'src-tauri/tauri.studio.conf.json',
    'jiucaihezi-promo',
  ]

  assert.deepEqual(legacyPaths.filter(existsSync), [])
})

test('Studio and OpenCode build paths are removed', () => {
  const pkg = JSON.parse(source('package.json'))
  const vite = source('vite.config.ts')
  const blockers = []

  for (const script of ['dev:studio', 'build:desktop:studio:quick', 'tauri:build:studio', 'opencode:update']) {
    if (pkg.scripts[script]) blockers.push(`script:${script}`)
  }
  if (pkg.dependencies['@opencode-ai/sdk']) blockers.push('dependency:@opencode-ai/sdk')
  if (/StudioApp|mode === 'studio'/.test(vite)) blockers.push('vite:studio-entry')
  assert.deepEqual(blockers, [])
})

test('the memory entry dependency closure no longer reaches OpenCode', () => {
  const blockers = [
    ['src/stores/agentStore.ts', /opencodeClient|useSessionStore/],
    ['src/components/creation/CreationPanel.vue', /useOpenCodeSyncStore/],
    ['src/components/search/GlobalSearch.vue', /useSessionStore/],
    ['src-tauri/src/lib.rs', /OpenCodeRuntime|commands::opencode/],
  ].filter(([path, pattern]) => pattern.test(source(path))).map(([path]) => path)

  assert.deepEqual(blockers, [])
})

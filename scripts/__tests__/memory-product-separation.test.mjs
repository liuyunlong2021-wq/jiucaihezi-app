import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
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
    '.opencode',
    'src-tauri/binaries',
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
  if (pkg.dependencies.lowlight) blockers.push('dependency:lowlight')
  for (const dependency of Object.keys(pkg.dependencies)) {
    if (dependency.startsWith('@tiptap/')) blockers.push(`dependency:${dependency}`)
  }
  if (/StudioApp|mode === 'studio'/.test(vite)) blockers.push('vite:studio-entry')
  assert.deepEqual(blockers, [])
})

test('superseded editor experiments are removed', () => {
  const legacyPaths = [
    'src/utils/localDocxV2.ts',
    'src/utils/pptxExport.ts',
    'src/utils/__tests__/smoke',
    'src/components/editor/__tests__/helpers/editorTestDocuments.ts',
  ]

  assert.deepEqual(legacyPaths.filter(existsSync), [])
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

test('legacy production command and user-facing OpenCode guidance are removed', () => {
  const blockers = [
    ['src-tauri/src/commands/dev.rs', /create_production_project/],
    ['src-tauri/src/lib.rs', /create_production_project/],
    ['src-tauri/src/commands/media.rs', /通过 OpenCode 处理/],
    ['src/composables/officeTools.ts', /文武模式中调用/],
  ].filter(([path, pattern]) => pattern.test(source(path))).map(([path]) => path)

  assert.deepEqual(blockers, [])
})

test('current product instructions and packaged Wiki templates use the memory contract', () => {
  const blockers = [
    ['README.md', /OpenCode 项目协作|100% 复刻官方 OpenCode/],
    ['AGENTS.md', /OpenCode 有的照抄/],
    ['docs/jiucaihezi-app.code-workspace', /MYnewapi|my-opencode/],
    ['public/skills/jc-everything-wiki/scripts/everything_to_wiki.py', /Studio 创模式|Studio 文\/武模式|ses_<会话ID>/],
    ['public/skills/jc-everything-wiki/references/项目语境/开发项目.md', /Studio 创模式|OpenCode `ses_\*`/],
    ['public/skills/jc-raw-wiki/references/能力标准/Raw与来源索引.md', /Studio 创模式|Studio 文\/武/],
    ['docs/wiki/开发/通用记忆工作台单产品化分离SDD.md', /`src\/components\/editor\/` \| `editorSessionStore\.ts` 当前/],
    ['docs/wiki/开发/文件系统/索引.md', /src\/components\/editor\/(?:editorSessionStore\.ts|EditorPanel\.vue)/],
  ].filter(([path, pattern]) => pattern.test(source(path))).map(([path]) => path)

  assert.deepEqual(blockers, [])
})

test('App bundles only the seven product Skills', () => {
  const expected = [
    'jc-cha-wiki',
    'jc-everything-wiki',
    'jc-jian-wiki',
    'jc-new-user-guide',
    'jc-raw-wiki',
    'jc-xiu-wiki',
    'skill-creator',
  ]
  const directories = readdirSync('public/skills', { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join('public/skills', entry.name, 'SKILL.md')))
    .map(entry => entry.name)
    .sort()
  const index = JSON.parse(source('public/skills/index.json')).map(skill => skill.id).sort()

  assert.deepEqual(directories, expected)
  assert.deepEqual(index, expected)
})

test('memory product bundles its dynamic playback icon', () => {
  const icons = JSON.parse(source('src/assets/icons-bundle.json')).icons
  assert.ok(icons['play-arrow'])
})

test('Web and Desktop dist reject Python caches and prune them recursively', () => {
  const root = mkdtempSync(join(tmpdir(), 'jc-dist-hygiene-'))
  try {
    for (const target of ['web', 'desktop']) {
      const dist = join(root, target)
      const cache = join(dist, 'skills', 'example', '__pycache__')
      mkdirSync(cache, { recursive: true })
      writeFileSync(join(cache, 'script.cpython-314.pyc'), 'bytecode')
      writeFileSync(join(dist, 'index.html'), '<!doctype html>')
      if (target === 'web') {
        for (const file of ['404.html', 'boot-guard.js', '_headers']) writeFileSync(join(dist, file), '')
      }

      const envName = target === 'web' ? 'WEB_DIST_DIR' : 'DESKTOP_DIST_DIR'
      const env = { ...process.env, [envName]: dist }
      const audit = `scripts/audit-${target}-dist.mjs`
      const prune = `scripts/prune-${target}-dist.mjs`
      assert.notEqual(spawnSync(process.execPath, [audit], { env }).status, 0)
      assert.equal(spawnSync(process.execPath, [prune], { env }).status, 0)
      assert.equal(existsSync(cache), false)
      assert.equal(spawnSync(process.execPath, [audit], { env }).status, 0)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

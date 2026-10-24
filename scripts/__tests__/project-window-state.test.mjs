import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const { outputFiles } = await build({
  entryPoints: ['src/stores/projectStore.ts'], bundle: true, write: false,
  platform: 'node', format: 'cjs', packages: 'external', alias: { '@': './src' },
})
function storage(values = {}) {
  const data = new Map(Object.entries(values))
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }
}
function open(label, localStorage, sessionStorage = storage(), workspace) {
  const module = { exports: {} }
  runInNewContext(outputFiles[0].text, {
    module, exports: module.exports, require, console, localStorage, sessionStorage,
    window: { __TAURI_INTERNALS__: { metadata: { currentWindow: { label } } }, __JC_WORKSPACE__: workspace },
  })
  return module.exports.useProjectStore()
}

test('a reused new-window label never restores a closed window project', () => {
  const local = storage({ 'jc_project_dir:win-1': '/old-project', jc_project_dir: '/main-project' })
  assert.equal(open('win-1', local).projectDir.value, '')
  assert.equal(local.getItem('jc_project_dir:win-1'), '/old-project', 'do not clear other persisted state')
})

test('new-window selection survives reload but not a new window session', async () => {
  const local = storage({ 'jc_project_dir:main': '/main-project' })
  const session = storage()
  const first = open('win-1', local, session)
  first.projectDir.value = '/chosen-project'
  await first.selectProject('/chosen-project')
  assert.equal(open('win-1', local, session).projectDir.value, '/chosen-project')
  assert.equal(open('win-1', local).projectDir.value, '')
  assert.equal(open('win-2', local).projectDir.value, '')
  assert.equal(open('main', local).projectDir.value, '/main-project')
  first.clearProject()
  assert.equal(open('win-1', local, session).projectDir.value, '')
})

test('main restoration and explicitly opened workspaces retain their existing precedence', () => {
  const local = storage({ jc_project_dir: '/legacy-main', 'jc_project_dir:ws-existing': '/saved-project' })
  assert.equal(open('main', local).projectDir.value, '/legacy-main')
  assert.equal(open('ws-existing', local).projectDir.value, '/saved-project')
  assert.equal(open('ws-existing', local, storage(), '/requested-project').projectDir.value, '/requested-project')
})

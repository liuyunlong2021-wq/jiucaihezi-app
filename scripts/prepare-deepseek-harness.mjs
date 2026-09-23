import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const version = '0.1.7-alpha.1'
const root = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src-tauri',
  'resources',
  'deepseek-harness',
)
const installed = join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
const bundledNode = join(
  root,
  'node_modules',
  'node',
  'bin',
  process.platform === 'win32' ? 'node.exe' : 'node',
)
if (
  existsSync(bundledNode) &&
  existsSync(installed) &&
  JSON.parse(readFileSync(installed, 'utf8')).version === version
)
  process.exit(0)

const result = spawnSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (result.status !== 0) process.exit(result.status || 1)

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const sourceSvg = join(root, 'src-tauri', 'icons', 'app-icon.svg')

const result = spawnSync('pnpm', ['tauri', 'icon', sourceSvg], {
  cwd: root,
  encoding: 'utf8',
  stdio: 'inherit',
})

if (result.status !== 0) {
  process.exit(result.status || 1)
}

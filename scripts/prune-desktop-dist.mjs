import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const desktopExcludedPaths = [
  'dist/landing',
]

for (const relativePath of desktopExcludedPaths) {
  const target = resolve(relativePath)
  if (!existsSync(target)) {
    continue
  }
  rmSync(target, { recursive: true, force: true })
  console.log(`[desktop-dist] removed ${relativePath}`)
}

import { existsSync, readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const distDir = resolve(process.env.DESKTOP_DIST_DIR || 'dist')

const desktopExcludedPaths = [
  '404.html',
  'landing',
  'legal.css',
  'privacy',
  'support',
  'terms',
  '_headers',
  '_redirects',
]

for (const relativePath of desktopExcludedPaths) {
  const target = resolve(distDir, relativePath)
  if (!existsSync(target)) {
    continue
  }
  rmSync(target, { recursive: true, force: true })
  console.log(`[desktop-dist] removed ${relativePath}`)
}

function removeSystemJunk(directory) {
  if (!existsSync(directory)) return

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = resolve(directory, entry.name)
    if (entry.name === '.DS_Store' || entry.name === 'Thumbs.db' || entry.name.endsWith('.map')) {
      rmSync(target, { force: true })
      console.log(`[desktop-dist] removed ${target.replace(`${distDir}/`, '')}`)
      continue
    }
    if (entry.isDirectory()) {
      removeSystemJunk(target)
    }
  }
}

removeSystemJunk(distDir)

import { existsSync, readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const distDir = resolve(process.env.WEB_DIST_DIR || 'dist')

function removeSystemJunk(directory) {
  if (!existsSync(directory)) return

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = resolve(directory, entry.name)
    if (entry.name === '.DS_Store' || entry.name === 'Thumbs.db') {
      rmSync(target, { force: true })
      console.log(`[web-dist] removed ${target.replace(`${distDir}/`, '')}`)
      continue
    }
    if (entry.isDirectory()) {
      removeSystemJunk(target)
    }
  }
}

removeSystemJunk(distDir)

const redirectsFile = resolve(distDir, '_redirects')
if (existsSync(redirectsFile)) {
  rmSync(redirectsFile, { force: true })
  console.log('[web-dist] removed _redirects')
}

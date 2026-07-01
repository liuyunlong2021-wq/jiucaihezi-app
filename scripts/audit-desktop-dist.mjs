import { existsSync, readdirSync, statSync } from 'node:fs'
import { extname, relative, resolve, sep } from 'node:path'

const distDir = resolve(process.env.DESKTOP_DIST_DIR || 'dist')

const forbiddenExact = new Set([
  '.DS_Store',
  'Thumbs.db',
  '_headers',
  '_redirects',
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'vite.config.ts',
])

const forbiddenTopLevelDirs = new Set([
  '.git',
  '.github',
  'docs',
  'landing',
  'node_modules',
  'scripts',
  'src',
  'src-tauri',
  'tests',
])

const forbiddenExtensions = new Set([
  '.map',
])

const allowedRootFiles = new Set([
  'boot-diagnostics.js',
  'community-qr.jpg',
  'favicon.svg',
  'icons.svg',
  'index.html',
  'jiucaihua-balance.svg',
  'logo.svg',
  'logo-solid.svg',
])

const allowedTopLevelDirs = new Set([
  'assets',
  'skills',
])

function walk(directory) {
  const results = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = resolve(directory, entry.name)
    results.push(target)
    if (entry.isDirectory()) {
      results.push(...walk(target))
    }
  }
  return results
}

function isRootPath(path) {
  return !path.includes('/')
}

function auditPath(path) {
  const normalizedPath = path.split(sep).join('/')
  const parts = normalizedPath.split('/')
  const basename = parts.at(-1) || ''
  const topLevel = parts[0] || ''

  if (forbiddenExact.has(basename) || forbiddenExact.has(normalizedPath)) {
    return 'forbidden desktop artifact'
  }

  if (forbiddenTopLevelDirs.has(topLevel)) {
    return `forbidden top-level directory: ${topLevel}`
  }

  if (forbiddenExtensions.has(extname(basename))) {
    return `forbidden extension: ${extname(basename)}`
  }

  if (isRootPath(normalizedPath)) {
    const stats = statSync(resolve(distDir, normalizedPath))
    if (stats.isDirectory() && !allowedTopLevelDirs.has(normalizedPath)) {
      return `unexpected top-level directory: ${normalizedPath}`
    }
    if (stats.isFile() && !allowedRootFiles.has(normalizedPath)) {
      return `unexpected root file: ${normalizedPath}`
    }
  }

  return null
}

if (!existsSync(distDir)) {
  throw new Error(`[desktop-dist] ${distDir} does not exist. Run vite build first.`)
}

const failures = []
for (const absolutePath of walk(distDir)) {
  const relativePath = relative(distDir, absolutePath)
  const reason = auditPath(relativePath)
  if (reason) {
    failures.push({ path: relativePath.split(sep).join('/'), reason })
  }
}

if (failures.length > 0) {
  console.error('[desktop-dist] audit failed:')
  for (const failure of failures.slice(0, 80)) {
    console.error(`  - ${failure.path} (${failure.reason})`)
  }
  if (failures.length > 80) {
    console.error(`  ... and ${failures.length - 80} more`)
  }
  process.exit(1)
}

console.log('[desktop-dist] audit passed')

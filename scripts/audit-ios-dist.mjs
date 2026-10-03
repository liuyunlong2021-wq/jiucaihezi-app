import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'

const distDir = resolve(process.env.IOS_DIST_DIR || 'dist')

const allowedRootNames = new Set(['assets', 'favicon.svg', 'index.html'])
const forbiddenExtensions = new Set(['.map', '.pyc'])

// 控制器不得携带 Runtime（合同 §3.2、§13.4）。这些标记只可能来自桌面侧代码：
// 一旦出现在 iOS 产物里，说明打包链把工作台或 Harness 及其资源又带了回来。
const forbiddenMarkers = [
  'deepseek-harness',
  'deepseekHarness',
  'mcp_spawn_stdio',
  'creation-mcp',
]
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.svg', '.txt'])

if (!existsSync(distDir)) {
  throw new Error(`[ios-dist] ${distDir} does not exist. Run vite build first.`)
}

function walk(directory) {
  const results = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = resolve(directory, entry.name)
    results.push(target)
    if (entry.isDirectory()) results.push(...walk(target))
  }
  return results
}

const failures = []

for (const absolutePath of walk(distDir)) {
  const relativePath = relative(distDir, absolutePath).split(sep).join('/')
  const topLevel = relativePath.split('/')[0] || ''
  const stats = statSync(absolutePath)

  if (!relativePath.includes('/') && !allowedRootNames.has(relativePath)) {
    failures.push({ path: relativePath, reason: 'unexpected root entry' })
    continue
  }
  if (forbiddenExtensions.has(extname(relativePath))) {
    failures.push({ path: relativePath, reason: `forbidden extension: ${extname(relativePath)}` })
    continue
  }
  if (topLevel !== 'assets' || !stats.isFile()) continue
  if (!textExtensions.has(extname(relativePath))) continue

  const content = readFileSync(absolutePath, 'utf8')
  for (const marker of forbiddenMarkers) {
    if (content.includes(marker)) {
      failures.push({ path: relativePath, reason: `desktop runtime marker: ${marker}` })
      break
    }
  }
}

// 入口引用的资源必须真的在安装包里。删错一个 chunk 比多打一个文件严重得多。
const indexHtml = resolve(distDir, 'index.html')
if (!existsSync(indexHtml)) {
  // 入口缺失时整个安装包都没有界面，必须失败——不能只当作「没有引用要查」。
  failures.push({ path: 'index.html', reason: 'controller entry is missing' })
} else {
  const html = readFileSync(indexHtml, 'utf8')
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const reference = match[1]
    if (/^(?:[a-z]+:|#|\/\/)/i.test(reference)) continue
    const target = reference.replace(/^\.\//, '').split(/[?#]/)[0]
    if (target && !existsSync(join(distDir, target))) {
      failures.push({ path: 'index.html', reason: `dangling reference: ${reference}` })
    }
  }
}

if (failures.length > 0) {
  console.error('[ios-dist] audit failed:')
  for (const failure of failures.slice(0, 40)) {
    console.error(`  - ${failure.path} (${failure.reason})`)
  }
  process.exit(1)
}

console.log('[ios-dist] audit passed')

import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const distDir = resolve(process.env.DESKTOP_DIST_DIR || 'dist')

// Vite 把落地页放在 dist/index.html，工作台在 dist/try/index.html。Tauri 的
// frontendDist 指向 dist/，所以要把工作台提回根，否则 App 打开的是下载页。
// base: './' 让 try/index.html 引用了 ../assets/，提到根之后要改回 ./assets/。
const appHtml = resolve(distDir, 'try/index.html')
if (existsSync(appHtml)) {
  writeFileSync(
    resolve(distDir, 'index.html'),
    readFileSync(appHtml, 'utf8').replaceAll('../', './'),
  )
  rmSync(resolve(distDir, 'try'), { recursive: true, force: true })
  console.log('[desktop-dist] promoted try/index.html to index.html and removed try/')
}

const desktopExcludedPaths = [
  '404.html',
  'apple-touch-icon.png',
  'landing',
  'legal.css',
  'privacy',
  'robots.txt',
  'sitemap.xml',
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
    if (entry.name === '.DS_Store' || entry.name === 'Thumbs.db' || entry.name === '__pycache__' || entry.name.endsWith('.map') || entry.name.endsWith('.pyc')) {
      rmSync(target, { recursive: true, force: true })
      console.log(`[desktop-dist] removed ${target.replace(`${distDir}/`, '')}`)
      continue
    }
    if (entry.isDirectory()) {
      removeSystemJunk(target)
    }
  }
}

removeSystemJunk(distDir)

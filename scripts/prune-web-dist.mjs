import { existsSync, readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const distDir = resolve(process.env.WEB_DIST_DIR || 'dist')

function removeSystemJunk(directory) {
  if (!existsSync(directory)) return

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = resolve(directory, entry.name)
    if (entry.name === '.DS_Store' || entry.name === 'Thumbs.db' || entry.name === '__pycache__' || entry.name.endsWith('.pyc')) {
      rmSync(target, { recursive: true, force: true })
      console.log(`[web-dist] removed ${target.replace(`${distDir}/`, '')}`)
      continue
    }
    if (entry.isDirectory()) {
      removeSystemJunk(target)
    }
  }
}

removeSystemJunk(distDir)

// Web 只保留落地页与下载：/try/ 是记忆工作台本体，不再随 Web 发布。
// ponytail: 只删产物，不改 vite 入口 —— 桌面/iOS 构建靠 try/index.html 提升为根页面。
// 代价是 dist/assets 仍会构建出无人引用的 app 包；要清掉就在 web 构建里单入口出落地页。
const webAppDir = resolve(distDir, 'try')
if (existsSync(webAppDir)) {
  rmSync(webAppDir, { recursive: true, force: true })
  console.log('[web-dist] removed try/')
}

const redirectsFile = resolve(distDir, '_redirects')
if (existsSync(redirectsFile)) {
  rmSync(redirectsFile, { force: true })
  console.log('[web-dist] removed _redirects')
}

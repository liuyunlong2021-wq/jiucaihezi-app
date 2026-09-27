import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const distDir = resolve(process.env.IOS_DIST_DIR || 'dist')

// iOS 构建（JC_BUILD_TARGET=mobile）只编 /mobile/ 入口，rollup 产物里就只有控制器的
// chunk；但 vite 仍会把整个 public/ 拷进 dist，而 public/ 是给 Web 和桌面用的
// （landing、help、terms、1.2M 的 skills 等）。安装包里只留控制器真正会加载的东西。
const keptRootNames = new Set(['assets', 'favicon.svg', 'index.html'])

if (!existsSync(distDir)) {
  throw new Error(`[ios-dist] ${distDir} does not exist. Run vite build first.`)
}

// vite 按源路径把 HTML 落在 dist/mobile/index.html，Tauri 的 frontendDist 指向 dist/，
// 所以要把控制器入口提回根。base: './' 让它引用了 ../assets/，需要改回 ./assets/。
const entryHtml = resolve(distDir, 'mobile/index.html')
if (!existsSync(entryHtml)) {
  throw new Error('[ios-dist] 找不到控制器入口 dist/mobile/index.html，检查 JC_BUILD_TARGET=mobile 是否生效')
}
writeFileSync(
  resolve(distDir, 'index.html'),
  readFileSync(entryHtml, 'utf8').replaceAll('../', './'),
)
console.log('[ios-dist] promoted mobile/index.html to index.html')

for (const name of readdirSync(distDir)) {
  if (keptRootNames.has(name)) continue
  rmSync(resolve(distDir, name), { recursive: true, force: true })
  console.log(`[ios-dist] removed ${name}`)
}

function removeSystemJunk(directory) {
  if (!existsSync(directory)) return

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = resolve(directory, entry.name)
    if (entry.name === '.DS_Store' || entry.name === 'Thumbs.db' || entry.name === '__pycache__' || entry.name.endsWith('.map') || entry.name.endsWith('.pyc')) {
      rmSync(target, { recursive: true, force: true })
      console.log(`[ios-dist] removed ${target.replace(`${distDir}/`, '')}`)
      continue
    }
    if (entry.isDirectory()) {
      removeSystemJunk(target)
    }
  }
}

removeSystemJunk(distDir)

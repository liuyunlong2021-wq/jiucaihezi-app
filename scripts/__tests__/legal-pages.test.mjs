import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = path => readFileSync(path, 'utf8')
const page = name => source(`public/${name}/index.html`)

// App Store 审核指南 1.5 就是在这条上被拒的：支持页当时整页只有第三方 issue 区，
// 没有任何自有的联系方式，审核员判定「没有用户能用来提问和求支持的信息」。
//
// email_off 注释是必须的：Cloudflare 的邮箱混淆会把裸 mailto 换成
// /cdn-cgi/l/email-protection#…，响应里只剩 “[email protected]” 占位符，要等
// email-decode.min.js 解码才显示真地址。审核看的是原始响应，看到占位符就等于没有
// 联系方式。包在 email_off 里 Cloudflare 就跳过改写（已线上实测）。
test('support page exposes a contact channel that does not sit behind a third-party account', () => {
  const support = page('support')

  assert.match(support, /<!--email_off-->\s*<p>[^<]*<a href="mailto:[^"]+@[^"]+"/)
  assert.match(support, /常见问题/)
})

test('privacy and terms route questions to the same support page', () => {
  for (const name of ['privacy', 'terms']) {
    assert.match(page(name), /href="\/support\/"/)
  }
})

// 根路径只放落地页：Web 从 2026-09-25 起不再发布工作台，/try/ 只服务桌面与 iOS 打包
// （prune-desktop-dist.mjs 把 try/index.html 提回根，Tauri 的 frontendDist 就是
// dist/index.html）。搞反了不会报错，只会让所有人一进站就撞上工作台。
test('web landing page never links the workbench entry', () => {
  const landing = source('index.html')
  const workbench = source('try/index.html')

  assert.doesNotMatch(landing, /\/src\/main\.ts/, '落地页不能挂 app 脚本')
  assert.doesNotMatch(landing, /\/try\//, 'Web 不再发布工作台，落地页不能链接 /try/')
  assert.match(workbench, /\/src\/main\.ts/, '/try/ 必须挂 app 脚本，桌面打包靠它')

  // App Review 会顺着官网找隐私与支持入口，三个法务页都得能从落地页走到。
  for (const legal of ['/support/', '/privacy/', '/terms/']) {
    assert.match(landing, new RegExp(`href="${legal}"`), `落地页缺少 ${legal} 链接`)
  }
})

// 上面那条只证明「落地页不链接」，这条证明「产物真被删掉且再进不来」。
test('web dist drops the workbench and rejects it if it comes back', () => {
  assert.match(source('scripts/prune-web-dist.mjs'), /rmSync\(webAppDir/)
  assert.doesNotMatch(source('scripts/audit-web-dist.mjs'), /^\s*'try',$/m)
})

test('landing page ships a share card WeChat can render', () => {
  const image = source('index.html').match(/<meta property="og:image" content="([^"]+)"/)?.[1]

  assert.ok(image, 'og:image 缺失，微信分享出去是一张空卡片')
  // 微信卡片不渲染 WebP 和 SVG
  assert.match(image, /\.(jpe?g|png)$/i)
})

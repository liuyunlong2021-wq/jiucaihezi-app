import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const page = name => readFileSync(`public/${name}/index.html`, 'utf8')

// App Store 审核指南 1.5 就是在这条上被拒的：支持页当时整页只有第三方 issue 区，
// 没有任何自有的联系方式，审核员判定「没有用户能用来提问和求支持的信息」。
//
// 地址里的 @ 写成 &#64; 是必须的：Cloudflare 的 Email Obfuscation 会把裸邮箱换成
// /cdn-cgi/l/email-protection#…，响应里只剩 “[email protected]” 占位符，要等
// email-decode.min.js 解码才显示真地址。审核看的是原始响应，看到占位符就等于没有
// 联系方式。实体写法绕开它的匹配，浏览器渲染出来仍是正常的 mailto 链接。
test('support page exposes a contact channel that does not sit behind a third-party account', () => {
  const support = page('support')

  assert.match(support, /href="mailto:[^"]+&#64;[^"]+"/)
  assert.match(support, /liuyunlongsaner&#64;gmail\.com/)
  assert.match(support, /常见问题/)
})

test('privacy and terms route questions to the same support page', () => {
  for (const name of ['privacy', 'terms']) {
    assert.match(page(name), /href="\/support\/"/)
  }
})

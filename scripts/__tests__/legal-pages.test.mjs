import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const page = name => readFileSync(`public/${name}/index.html`, 'utf8')

// App Store 审核指南 1.5 就是在这条上被拒的：支持页当时整页只有第三方 issue 区，
// 没有任何自有的联系方式，审核员判定「没有用户能用来提问和求支持的信息」。
test('support page exposes a contact channel that does not sit behind a third-party account', () => {
  const support = page('support')

  assert.match(support, /href="mailto:[^"]+@[^"]+"/)
  assert.match(support, /常见问题/)
})

test('privacy and terms route questions to the same support page', () => {
  for (const name of ['privacy', 'terms']) {
    assert.match(page(name), /href="\/support\/"/)
  }
})

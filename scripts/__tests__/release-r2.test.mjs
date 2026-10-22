import test from 'node:test'
import { execFileSync } from 'node:child_process'

test('release R2 upload immutability, complete inventory and exact legacy redirects', () => {
  execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['scripts/release_r2_test.py'], { stdio: 'pipe' })
})

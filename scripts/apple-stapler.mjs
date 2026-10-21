// Apple ticket service can drop the connection after notarization was accepted.
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { setTimeout } from 'node:timers/promises'

export async function runStapler(action, path, { run = execFileSync, wait = setTimeout } = {}) {
  if (!['staple', 'validate'].includes(action) || !path) throw new Error('Expected staple|validate and an artifact path')
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      run('xcrun', ['stapler', action, path], { stdio: 'inherit' })
      return
    } catch (error) {
      // Exit 68 is the service/network failure; never retry a rejected ticket as success.
      if (error.status !== 68 || attempt === 3) throw error
      console.warn(`Apple ticket service failed; retry ${attempt}/2`)
      await wait(attempt * 10000)
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runStapler(...process.argv.slice(2))
}

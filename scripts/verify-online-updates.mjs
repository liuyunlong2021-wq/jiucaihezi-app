import { createHash } from 'node:crypto'
import { createReadStream, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
const [version, dir] = process.argv.slice(2)
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid version')
for (const filename of readdirSync(dir).filter(name => /\.(dmg|exe|tar\.gz|sig)$/.test(name))) {
  const local = createHash('sha256')
  for await (const chunk of createReadStream(join(dir, filename))) local.update(chunk)
  const response = await fetch(`https://api.jiucaihezi.studio/updates/${version}/${encodeURIComponent(filename)}`, { signal: AbortSignal.timeout(20 * 60 * 1000), cache: 'no-store' })
  if (!response.ok || !response.body) throw new Error(`Online asset missing: ${filename}`)
  const online = createHash('sha256')
  for await (const chunk of response.body) online.update(chunk)
  if (online.digest('hex') !== local.digest('hex')) throw new Error(`Online SHA256 mismatch: ${filename}`)
  console.log(`Verified online SHA256: ${basename(filename)}`)
}

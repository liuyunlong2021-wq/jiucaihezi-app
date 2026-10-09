import { createHash } from 'node:crypto'
import { createReadStream, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'

// 小块重试只重传失败区间，完整 SHA256 仍覆盖全部公网字节。
export async function onlineDigest(url, size, { chunkSize = 4 * 1024 * 1024, timeout = 120000 } = {}) {
  const hash = createHash('sha256')
  for (let start = 0; start < size; start += chunkSize) {
    const end = Math.min(start + chunkSize, size) - 1
    let bytes
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const response = await fetch(url, {
          headers: { Range: `bytes=${start}-${end}`, 'Accept-Encoding': 'identity' },
          signal: AbortSignal.timeout(timeout), cache: 'no-store',
        })
        if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${size}`) {
          await response.body?.cancel()
          throw new Error(`Invalid public byte range: ${response.status}`)
        }
        bytes = Buffer.from(await response.arrayBuffer())
        if (bytes.length !== end - start + 1) throw new Error('Truncated public byte range')
        break
      } catch (error) {
        if (attempt === 3) throw error
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
      }
    }
    hash.update(bytes)
  }
  return hash.digest('hex')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [version, dir] = process.argv.slice(2)
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid version')
  for (const filename of readdirSync(dir).filter(name => /\.(dmg|exe|tar\.gz|sig)$/.test(name))) {
    const path = join(dir, filename)
    const local = createHash('sha256')
    for await (const chunk of createReadStream(path)) local.update(chunk)
    const online = await onlineDigest(`https://api.jiucaihezi.studio/updates/${version}/${encodeURIComponent(filename)}`, statSync(path).size)
    if (online !== local.digest('hex')) throw new Error(`Online SHA256 mismatch: ${filename}`)
    console.log(`Verified online SHA256: ${basename(filename)}`)
  }
}

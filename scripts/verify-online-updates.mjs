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
          signal: AbortSignal.timeout(timeout),
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

export function releaseFiles(dir) {
  return readdirSync(dir).filter(name => /\.(dmg|exe|zip|tar\.gz|sig)$/.test(name) || ['SHA256SUMS', 'R2-SHA256SUMS'].includes(name)).sort()
}

export async function verifyOnlineRelease(dir, base, options = {}) {
  const files = releaseFiles(dir)
  if (!files.length) throw new Error('No release assets')
  for (const filename of files) {
    const path = join(dir, filename), size = statSync(path).size
    const url = `${base}/${encodeURIComponent(filename)}`
    const head = await fetch(url, { method: 'HEAD', headers: { 'Accept-Encoding': 'identity' }, signal: AbortSignal.timeout(60000) })
    if (!head.ok || Number(head.headers.get('content-length')) !== size) throw new Error(`Online size mismatch: ${filename}`)
    if (options.checkResume && /\.(dmg|exe|zip|tar\.gz)$/.test(filename)) {
      const etag = head.headers.get('etag')
      if (!etag || etag.startsWith('W/') || !head.headers.get('last-modified')) throw new Error(`Missing resume validators: ${filename}`)
      const end = Math.min(size, 16) - 1
      const resumed = await fetch(url, { headers: { Range: `bytes=0-${end}`, 'If-Range': etag, 'Accept-Encoding': 'identity' }, signal: AbortSignal.timeout(60000) })
      const bytes = Buffer.from(await resumed.arrayBuffer())
      if (resumed.status !== 206 || resumed.headers.get('content-range') !== `bytes 0-${end}/${size}` || bytes.length !== end + 1) throw new Error(`Invalid If-Range resume: ${filename}`)
      const changed = await fetch(url, { headers: { Range: 'bytes=0-0', 'If-Range': '"jc-deliberately-different-etag"', 'Accept-Encoding': 'identity' }, signal: AbortSignal.timeout(60000) })
      await changed.body?.cancel()
      if (changed.status !== 200) throw new Error(`Invalid changed If-Range response: ${filename}`)
    }
    const local = createHash('sha256')
    for await (const chunk of createReadStream(path)) local.update(chunk)
    const online = await onlineDigest(url, size, options)
    if (online !== local.digest('hex')) throw new Error(`Online SHA256 mismatch: ${filename}`)
    console.log(`Verified online SHA256: ${basename(filename)}`)
  }
}

export async function verifyLegacyRedirects(dir, version, legacyBase = 'https://api.jiucaihezi.studio/updates', publicBase = 'https://downloads.jiucaihezi.studio') {
  for (const name of releaseFiles(dir)) {
    const path = `${version}/${encodeURIComponent(name)}`
    const response = await fetch(`${legacyBase}/${path}`, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(60000) })
    if (response.status !== 302 || response.headers.get('location') !== `${publicBase}/${path}`) throw new Error(`Legacy R2 redirect mismatch: ${name}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [version, dir, target = 'legacy'] = process.argv.slice(2)
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid version')
  if (!['legacy', 'r2', 'redirects'].includes(target)) throw new Error('Invalid verification target')
  if (target === 'redirects') await verifyLegacyRedirects(dir, version)
  else await verifyOnlineRelease(dir, `${target === 'r2' ? 'https://downloads.jiucaihezi.studio' : 'https://api.jiucaihezi.studio/updates'}/${version}`, { checkResume: target === 'r2' })
}

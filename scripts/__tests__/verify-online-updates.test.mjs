import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onlineDigest, verifyOnlineRelease, verifyLegacyRedirects } from '../verify-online-updates.mjs'

test('public checksum retries only failed ranges and hashes all bytes', async () => {
  const data = Buffer.from('signed release with Chinese 中文 data')
  const requests = []
  let failed = false
  const server = createServer((req, res) => {
    const [, start, end] = req.headers.range.match(/bytes=(\d+)-(\d+)/).map(Number)
    requests.push(start)
    if (start === 4 && !failed) { failed = true; res.writeHead(503); res.end(); return }
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${data.length}` })
    res.end(data.subarray(start, end + 1))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const digest = await onlineDigest(`http://127.0.0.1:${server.address().port}/asset`, data.length, { chunkSize: 4 })
    assert.equal(digest, createHash('sha256').update(data).digest('hex'))
    assert.equal(requests.filter(n => n === 0).length, 1)
    assert.equal(requests.filter(n => n === 4).length, 2)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('public checksum rejects a successful response with the wrong range', async () => {
  const server = createServer((_req, res) => { res.writeHead(206, { 'Content-Range': 'bytes 0-2/4' }); res.end('bad') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await assert.rejects(onlineDigest(`http://127.0.0.1:${server.address().port}/asset`, 4), /Invalid public byte range/)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('R2 verification covers ZIP/checksums, resume validators, all bytes and exact legacy redirects', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jc-r2-online-'))
  const files = new Map([['中文.dmg', Buffer.from('signed disk image')], ['portable.zip', Buffer.from('portable binary')], ['SHA256SUMS', Buffer.from('checksum fixture')]])
  for (const [name, bytes] of files) writeFileSync(join(dir, name), bytes)
  let corrupt = false, badRedirect = false
  const seen = new Set()
  const server = createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('/').at(-1))
    const data = files.get(name)
    if (req.url.startsWith('/legacy/')) {
      res.writeHead(302, { Location: `http://127.0.0.1:${server.address().port}/${badRedirect ? 'wrong' : 'r2'}/2.2.38/${encodeURIComponent(name)}` })
      res.end(); return
    }
    seen.add(name)
    res.setHeader('ETag', '"signed-immutable"')
    res.setHeader('Last-Modified', 'Wed, 21 Oct 2026 19:58:52 GMT')
    if (req.method === 'HEAD') { res.setHeader('Content-Length', data.length); res.end(); return }
    // R2 metadata is uncached; only binary payloads need conditional resume.
    if (req.headers['if-range'] && req.headers['if-range'] !== '"signed-immutable"' && name !== 'SHA256SUMS') { res.end(data); return }
    const [, start, end] = req.headers.range.match(/bytes=(\d+)-(\d+)/).map(Number)
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${data.length}` })
    const bytes = Buffer.from(data.subarray(start, end + 1))
    if (corrupt) bytes.fill(0)
    res.end(bytes)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  try {
    await verifyOnlineRelease(dir, `${origin}/r2/2.2.38`, { chunkSize: 4, checkResume: true })
    assert.deepEqual(seen, new Set(files.keys()))
    await verifyLegacyRedirects(dir, '2.2.38', `${origin}/legacy`, `${origin}/r2`)
    corrupt = true
    await assert.rejects(verifyOnlineRelease(dir, `${origin}/r2/2.2.38`, { chunkSize: 4 }), /SHA256 mismatch/)
    badRedirect = true
    await assert.rejects(verifyLegacyRedirects(dir, '2.2.38', `${origin}/legacy`, `${origin}/r2`), /redirect mismatch/)
  } finally {
    await new Promise(resolve => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
})

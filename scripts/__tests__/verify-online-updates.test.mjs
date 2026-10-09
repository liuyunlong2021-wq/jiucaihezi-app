import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { onlineDigest } from '../verify-online-updates.mjs'

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

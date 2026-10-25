import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  REMOTE_FILE_CHUNK_BYTES,
  listRemoteFiles,
  readRemoteFile,
  remoteFileKind,
  remoteFilePath,
} from '@/services/desktopRemoteFiles'

test('看成果：手机只能看 wiki/ 与 .raw/jc-media/，跳出目录、隐藏文件、反斜杠一律拒绝', () => {
  for (const ok of ['', 'wiki', 'wiki/项目资料/分集剧本/第1集分集剧本.md', '.raw/jc-media', '.raw/jc-media/视频/a.mp4', ' wiki/index.md '])
    assert.doesNotThrow(() => remoteFilePath(ok), ok)
  assert.equal(remoteFilePath(' wiki/index.md '), 'wiki/index.md')
  for (const bad of ['../etc/passwd', '/Users/x/wiki/a.md', 'wiki/../.env', '.harness-conversations/a.md',
    '.raw/other/a.png', 'src/main.ts', 'wiki/.secret.md', 'wiki\\a.md', 'wiki//a.md', 'C:/wiki/a.md'])
    assert.throws(() => remoteFilePath(bad), /FILE_PATH_INVALID/, bad)
})

test('看成果：按扩展名决定怎么看，其余类型不下发', () => {
  assert.deepEqual(remoteFileKind('wiki/a.md'), { kind: 'text', mime: 'text/markdown' })
  assert.deepEqual(remoteFileKind('wiki/a.JSON'), { kind: 'text', mime: 'application/json' })
  assert.deepEqual(remoteFileKind('.raw/jc-media/图片/a.png'), { kind: 'image', mime: 'image/png' })
  assert.deepEqual(remoteFileKind('.raw/jc-media/视频/a.mp4'), { kind: 'video', mime: 'video/mp4' })
  assert.equal(remoteFileKind('wiki/a.exe'), null)
})

function fakeInvoke(tree: Record<string, Array<{ path: string; isDir: boolean; size?: number }>>, file?: Uint8Array) {
  const calls: Array<[string, Record<string, unknown>]> = []
  const invoke = async (command: string, args: Record<string, unknown>) => {
    calls.push([command, args])
    const input = args.input as { relativePath?: string; offset?: number; maxBytes?: number }
    if (command === 'dev_list_directory') {
      const entries = tree[input.relativePath || '.']
      if (!entries) throw new Error('项目内路径不可访问')
      return entries
    }
    if (command === 'dev_read_file') {
      const offset = input.offset ?? 0
      const slice = file!.slice(offset, offset + (input.maxBytes ?? 0))
      return { base64: Buffer.from(slice).toString('base64'), size: file!.length, truncated: offset + slice.length < file!.length }
    }
    throw new Error(`unexpected ${command}`)
  }
  return { invoke, calls }
}

test('看成果：根目录只列存在的两个成果目录，子目录隐藏点文件并标出文件类型', async () => {
  const { invoke } = fakeInvoke({
    wiki: [{ path: 'wiki/index.md', isDir: false, size: 10 }, { path: 'wiki/.DS_Store', isDir: false }, { path: 'wiki/项目资料', isDir: true }],
  })
  assert.deepEqual((await listRemoteFiles('/p', '', invoke)).map(entry => entry.path), ['wiki'])
  const listed = await listRemoteFiles('/p', 'wiki', invoke)
  assert.deepEqual(listed.map(entry => [entry.name, entry.isDir, entry.kind]), [
    ['项目资料', true, undefined],
    ['index.md', false, 'text'],
  ], '目录在前，点文件不出现')
})

test('看成果：分段读取——每段不超过上限，告诉手机总大小与是否读完', async () => {
  const file = new Uint8Array(REMOTE_FILE_CHUNK_BYTES + 10).map((_, index) => index % 251)
  const { invoke, calls } = fakeInvoke({}, file)
  const first = await readRemoteFile('/p', '.raw/jc-media/视频/a.mp4', 0, invoke)
  assert.equal(first.kind, 'video')
  assert.equal(first.size, file.length)
  assert.equal(first.done, false)
  assert.equal(Buffer.from(first.base64, 'base64').length, REMOTE_FILE_CHUNK_BYTES)
  const second = await readRemoteFile('/p', '.raw/jc-media/视频/a.mp4', REMOTE_FILE_CHUNK_BYTES, invoke)
  assert.equal(second.done, true)
  assert.equal(Buffer.from(second.base64, 'base64').length, 10)
  assert.deepEqual(calls[1]?.[1], { input: { root: '/p', relativePath: '.raw/jc-media/视频/a.mp4', maxBytes: REMOTE_FILE_CHUNK_BYTES, offset: REMOTE_FILE_CHUNK_BYTES } })
  await assert.rejects(() => readRemoteFile('/p', 'wiki/a.exe', 0, invoke), /FILE_TYPE_NOT_ALLOWED/)
  await assert.rejects(() => readRemoteFile('/p', '../a.md', 0, invoke), /FILE_PATH_INVALID/)
})

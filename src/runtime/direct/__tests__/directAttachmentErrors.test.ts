import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildDirectAttachmentHttpError } from '../directAttachmentErrors'

const messages = [{
  role: 'user',
  content: [{ type: 'file', file: { filename: 'clip.mp4', file_data: 'data:video/mp4;base64,AAA' } }],
}]

test('maps native attachment HTTP failures to explicit user-facing errors', () => {
  assert.match(buildDirectAttachmentHttpError(413, messages) || '', /超过当前直传上限/)
  assert.match(buildDirectAttachmentHttpError(415, messages) || '', /不支持该附件协议/)
  assert.match(buildDirectAttachmentHttpError(524, messages) || '', /处理附件超时/)
  assert.equal(buildDirectAttachmentHttpError(500, messages), null)
  assert.equal(buildDirectAttachmentHttpError(413, [{ role: 'user', content: 'hello' }]), null)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeRemoteError } from '@/mobile/describeRemoteError'

test('把 Desktop 的错误码翻成能照做的话', () => {
  assert.equal(describeRemoteError('PAIRING_REJECTED'), '电脑上拒绝了这次连接')
  assert.equal(describeRemoteError('SESSION_BUSY'), '电脑上这个对话正在运行，请先停止')
  assert.equal(describeRemoteError('DESKTOP_KEY_MISMATCH'), '对方不是那台电脑，已中止连接')
})

test('未知错误码原样显示，不吞掉信息', () => {
  assert.equal(describeRemoteError('SOMETHING_NEW_FROM_DESKTOP'), 'SOMETHING_NEW_FROM_DESKTOP')
})

test('对象型异常也能读出来，不再出现 [object Object]', () => {
  // 扫码插件取消时抛的就是这种普通对象（2026-09-27 真机所见）。
  assert.equal(describeRemoteError({ message: 'user cancelled' }), '已取消扫码')
  assert.equal(describeRemoteError({ error: 'Camera permission denied' }), '相机权限被拒绝，请在系统设置里允许「韭菜盒子遥控」使用相机')
  assert.equal(describeRemoteError({ code: 'PAIRING_OFFER_EXPIRED' }), '二维码已过期，请在电脑上重新生成')
  assert.equal(describeRemoteError({ detail: 'x' }), '{"detail":"x"}')
  assert.notEqual(describeRemoteError({}), '[object Object]')
})

test('Error、字符串与空值都有兜底', () => {
  assert.equal(describeRemoteError(new Error('REMOTE_CONNECTION_CLOSED')), '与电脑的连接已断开')
  assert.equal(describeRemoteError('  '), '连接失败')
  assert.equal(describeRemoteError(null), '连接失败')
  assert.equal(describeRemoteError(undefined), '连接失败')
})

test('相机权限与取消按关键词兜住', () => {
  assert.equal(
    describeRemoteError('camera permission denied by user'),
    '相机权限被拒绝，请在系统设置里允许「韭菜盒子遥控」使用相机',
  )
  assert.equal(describeRemoteError('Scan cancelled'), '已取消扫码')
})

test('真机上的断连原文翻成能照做的话', () => {
  // 2026-09-27 真机：TCP 通了但电脑端没确认，std::io 的原文直接曝到界面上。
  assert.match(describeRemoteError('failed to fill whole buffer'), /电脑上点「允许」/)
  assert.match(describeRemoteError('Connection reset by peer (os error 54)'), /被断开/)
  assert.match(describeRemoteError('No route to host (os error 65)'), /同一个 Wi/)
})

test('电脑返回的对话信息不完整时，把原始返回一起显示出来', () => {
  // 这个错只可能是两端对不上，光看错误码查不出来（2026-09-27 真机）。
  const shown = describeRemoteError('INVALID_CONTEXT 电脑返回：{"sessionId":""}')
  assert.match(shown, /INVALID_CONTEXT/)
  assert.match(shown, /sessionId/)
})

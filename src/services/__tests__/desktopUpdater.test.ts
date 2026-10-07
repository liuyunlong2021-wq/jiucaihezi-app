import assert from 'node:assert/strict'
import test from 'node:test'
import { bindDesktopUpdater, desktopUpdateStatus, registerUpdateParticipant, updateWaiting, waitForUpdateInstall } from '../desktopUpdater'

test('actual updater service revokes queued consent, has one timer owner, and reports preparation errors', async t => {
  const callbacks = new Map<number, (event: unknown) => unknown>()
  const listeners = new Map<string, (event: unknown) => unknown>()
  const calls: { command: string; args: any }[] = []
  const timers: (() => void)[] = []
  let nextId = 1
  const snapshot = { phase: 'ready', currentVersion: '2.2.19', version: '2.2.20', downloaded: 10 }
  const emit = async (event: string, payload: unknown) => listeners.get(event)?.({ payload })
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const previousElement = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    __TAURI_INTERNALS__: {
      metadata: { currentWindow: { label: 'main' } },
      transformCallback(callback: (event: unknown) => unknown) { const id = nextId++; callbacks.set(id, callback); return id },
      async invoke(command: string, args: any) {
        calls.push({ command, args })
        if (command === 'plugin:event|listen') { listeners.set(args.event, callbacks.get(args.handler)!); return nextId++ }
        if (command === 'plugin:event|emit') { await emit(args.event, args.payload); return }
        if (command === 'desktop_update_status') return snapshot
        if (command === 'desktop_update_install' || command === 'desktop_update_ack') return
        throw new Error(`Unexpected command ${command}`)
      },
    },
  } })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { activeElement: null } })
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: class {} })
  t.mock.method(globalThis, 'setInterval', (callback: () => void) => { timers.push(callback); return timers.length as any })
  t.mock.method(globalThis, 'clearInterval', () => {})
  let stop = () => {}
  try {
    await bindDesktopUpdater()
    assert.equal(desktopUpdateStatus.value.phase, 'ready')
    await waitForUpdateInstall(true)
    assert.equal(updateWaiting.value, true)
    assert.equal(timers.length, 1)
    await waitForUpdateInstall(false)
    timers[0]() // 已进入事件队列的旧 tick 也不得安装。
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(calls.filter(call => call.command === 'desktop_update_install').length, 0)
    await emit('desktop-update:waiting', { version: '2.2.20', owner: 'ws-other' })
    assert.equal(updateWaiting.value, true)
    assert.equal(timers.length, 1) // 非拥有者不创建安装定时器。
    await waitForUpdateInstall(true)
    await emit('desktop-update:status', { ...snapshot, version: '2.2.21' })
    timers.at(-1)!()
    assert.equal(updateWaiting.value, false)
    assert.equal(calls.filter(call => call.command === 'desktop_update_install').length, 0)
    stop = registerUpdateParticipant({ busy: () => '媒体还在保存', save: async () => { throw new Error('must not save') }, close: async () => {} })
    await emit('desktop-update:prepare', { id: 'save-one', stage: 'save' })
    assert.deepEqual(calls.find(call => call.command === 'desktop_update_ack')?.args, { id: 'save-one', error: '媒体还在保存' })
  } finally {
    stop()
    await waitForUpdateInstall(false)
    for (const [name, descriptor] of [['window', previousWindow], ['document', previousDocument], ['HTMLElement', previousElement]] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
})

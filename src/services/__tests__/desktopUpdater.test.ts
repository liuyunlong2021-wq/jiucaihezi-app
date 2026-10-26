import assert from 'node:assert/strict'
import test from 'node:test'
import { beginDesktopUpdateTask, bindDesktopUpdater, desktopUpdateStatus, describeUpdateTask, loadUpdateTasks, registerUpdateParticipant, updaterAction, updateTasks, updateWaiting, waitForUpdateInstall } from '../desktopUpdater'

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

test('blocking tasks are named for the user and stopping them is an explicit install option', async () => {
  const calls: { command: string; args: any }[] = []
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const tasks = [{ owner: 'main', kind: 'AI 对话', startedAt: 1_000 }, { owner: 'native', kind: '媒体处理', startedAt: 61_000 }]
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    __TAURI_INTERNALS__: {
      metadata: { currentWindow: { label: 'main' } },
      async invoke(command: string, args: any) {
        calls.push({ command, args })
        if (command === 'desktop_update_task_begin') return 'lease-1'
        if (command === 'desktop_update_tasks') return tasks
        if (command === 'desktop_update_status') return { phase: 'ready', currentVersion: '2.2.40', version: '2.3.0', downloaded: 1 }
        if (command === 'desktop_update_task_end' || command === 'desktop_update_install') return
        throw new Error(`Unexpected command ${command}`)
      },
    },
  } })
  try {
    const release = await beginDesktopUpdateTask('AI 对话')
    assert.deepEqual(calls.at(-1), { command: 'desktop_update_task_begin', args: { kind: 'AI 对话' } })
    await release()
    await loadUpdateTasks()
    assert.deepEqual(updateTasks.value, tasks)
    assert.equal(describeUpdateTask(tasks[0], 'main', 181_000), 'AI 对话 · 当前窗口 · 已运行 3 分钟')
    assert.equal(describeUpdateTask(tasks[1], 'main', 91_000), '媒体处理 · 后台 · 已运行不到 1 分钟')
    assert.equal(describeUpdateTask({ owner: 'ws-1', kind: 'DeepSeek 运行', startedAt: 0 }, 'main', 0), 'DeepSeek 运行 · 其他窗口 · 已运行不到 1 分钟')
    await updaterAction('install')
    assert.deepEqual(calls.filter(call => call.command === 'desktop_update_install').at(-1)?.args, { force: false })
    await updaterAction('install', true)
    assert.deepEqual(calls.filter(call => call.command === 'desktop_update_install').at(-1)?.args, { force: true })
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})

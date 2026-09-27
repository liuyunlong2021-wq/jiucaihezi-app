import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextDesktopRemoteEventSeq } from '@/services/desktopRemoteEventSeq'

test('同一进程内严格递增，同一毫秒也要顶开', () => {
  const first = nextDesktopRemoteEventSeq(1_700_000_000_000)
  const sameMs = nextDesktopRemoteEventSeq(1_700_000_000_000)
  const backToNow = nextDesktopRemoteEventSeq(1_700_000_000_000)

  assert.equal(first, 1_700_000_000_000)
  assert.equal(sameMs, first + 1)
  assert.equal(backToNow, sameMs + 1, '时钟回拨也不能倒退')
})

test('页面重载后发出的序号仍大于重载前的任何序号', () => {
  // 重载（Vite 热更新 / 刷新 / 窗口重开）会把模块状态清空。
  // 若序号来自「页面内自增计数器」，重载后就会从 1 重新开始，
  // 手机端（要求严格递增）会把之后所有事件当成旧事件丢掉 —— 2026-09-27 真机故障。
  // 这里模拟重载后的第一次发布：时钟打底，天然大于重载前发出去的任何序号。
  const issuedBeforeReload = nextDesktopRemoteEventSeq(1_700_000_000_000)
  const afterReload = nextDesktopRemoteEventSeq(1_700_000_060_000)

  assert.ok(afterReload > issuedBeforeReload)
})

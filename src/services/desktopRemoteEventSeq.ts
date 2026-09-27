/**
 * Desktop → Mobile 事件序号。
 *
 * 手机端要求序号严格递增，收到 `seq ≤ 上次` 的事件会直接丢弃（防止乱序覆盖新状态）。
 * 因此这里不能用「页面内自增计数器」：页面一重载（Vite 热更新、手动刷新、窗口重开、
 * 应用重启）计数器就归零，之后所有事件都会被手机静默丢掉 ——
 * 2026-09-27 真机就是这样：电脑明明跑了 run，手机界面一直不更新。
 *
 * 用当前时钟打底，并把「同毫秒内的多次发布」也顶开，保证单进程内严格递增、
 * 且重载后一定大于重载前发出去的任何序号。
 */
let lastIssued = 0

export function nextDesktopRemoteEventSeq(now: number = Date.now()): number {
  lastIssued = Math.max(lastIssued + 1, now)
  return lastIssued
}

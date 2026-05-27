/**
 * timeFormat.ts — 消息时间格式化工具
 */

/**
 * 相对时间格式化（中文）
 * 刚刚 / X分钟前 / X小时前 / 昨天 HH:mm / MM-DD HH:mm / YYYY-MM-DD
 */
export function formatRelativeTime(ts: number): string {
  const now = Date.now()
  const diff = now - ts
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (seconds < 60) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`

  const date = new Date(ts)
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) {
    return `昨天 ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }

  const mm = pad(date.getMonth() + 1)
  const dd = pad(date.getDate())
  const HH = pad(date.getHours())
  const MM = pad(date.getMinutes())

  if (date.getFullYear() === new Date().getFullYear()) {
    return `${mm}-${dd} ${HH}:${MM}`
  }
  return `${date.getFullYear()}-${mm}-${dd} ${HH}:${MM}`
}

/**
 * 完整时间格式化
 * YYYY-MM-DD HH:mm:ss
 */
export function formatFullTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

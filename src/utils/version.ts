/** 按数字段比较版本号（字符串比较会把 2.1.9 误判成比 2.1.56 新）。 */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = latest.split('.').map(Number)
  const b = current.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] || 0) - (b[i] || 0)
    if (diff !== 0) return diff > 0
  }
  return false
}

export interface UsageLogRow {
  timeText: string
  title: string
  detailText: string
  modelName: string
  flowersText: string
}

export function normalizeTopupAmount(value: unknown): number {
  const amount = Math.round(Number(value || 0))
  if (!Number.isFinite(amount) || amount <= 0) return 0
  return amount
}

export function buildInviteUrl(baseUrl: string, inviteCode: string): string {
  const fallback = typeof window !== 'undefined' ? window.location.href : 'https://jiucaihezi.studio/'
  const url = new URL(String(baseUrl || fallback))
  url.searchParams.set('aff', String(inviteCode || '').trim())
  url.hash = 'register'
  return url.toString()
}

function formatLogTime(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 100000000000 ? value : value * 1000
    const date = new Date(millis)
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    }
  }
  const raw = String(value || '').trim()
  if (!raw) return '-'
  const numeric = Number(raw)
  const date = Number.isFinite(numeric) && /^\d{10,13}$/.test(raw)
    ? new Date(numeric > 100000000000 ? numeric : numeric * 1000)
    : new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatUsageLogItem(item: any): UsageLogRow {
  const type = String(item?.type || item?.channel || '').toLowerCase()
  const modelName = String(item?.model || item?.modelName || item?.channel || item?.type || '未知模型').trim()
  const title = String(item?.title || '').trim() || (
    type.includes('checkin') ? '签到奖励'
      : type.includes('redeem') ? '兑换码到账'
        : type.includes('topup') ? '充值到账'
          : modelName || '模型消耗'
  )
  const detailText = String(item?.subtitle || item?.content || '').trim() || (
    String(item?.direction || '').toLowerCase() === 'credit' ? 'NewAPI 已同步' : '模型调用消耗'
  )
  const signed = Number(item?.signedFlowers)
  const flowers = Number.isFinite(signed)
    ? Math.round(signed)
    : (String(item?.direction || '').toLowerCase() === 'credit'
      ? Math.round(Number(item?.flowers || 0))
      : -Math.round(Number(item?.flowers || 0)))
  return {
    timeText: formatLogTime(item?.createdAt || item?.created_at || item?.time),
    title,
    detailText,
    modelName: modelName || '未知模型',
    flowersText: `${flowers > 0 ? `+${flowers}` : String(flowers)} 韭菜花`,
  }
}

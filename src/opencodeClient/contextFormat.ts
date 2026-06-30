export function createSessionContextFormatter(locale: string = 'zh-CN') {
  return {
    number(value: number | null | undefined) { if (value === undefined || value === null) return '—'; return value.toLocaleString(locale) },
    percent(value: number | null | undefined) { if (value === undefined || value === null) return '—'; return value.toLocaleString(locale) + '%' },
    time(value: number | undefined) { if (!value) return '—'; try { return new Date(value).toLocaleString(locale, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) } catch { return new Date(value).toLocaleString() } }
  }
}

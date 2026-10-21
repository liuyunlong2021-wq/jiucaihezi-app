// Keep the existing private deployment target; grants cannot choose an arbitrary upload host.
const origin = 'https://d055e5deea504cb25551755cc486a61a.r2.cloudflarestorage.com'
const objectPath = /^\/jiucaihezi-media-test\/creation-temp\/[1-9]\d*\/[a-f0-9]{32}\.[a-z0-9]+$/

export function validateCreationR2Grant(value: unknown, contentType: string) {
  const fail = (): never => { throw new Error('R2 上传授权地址或字段无效') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  const grant = value as Record<string, unknown>
  if (Object.keys(grant).some(key => !['method', 'headers', 'upload_url', 'asset_url', 'head_url'].includes(key))) return fail()
  if (grant.method !== 'PUT' || !grant.headers || typeof grant.headers !== 'object' || Array.isArray(grant.headers)) return fail()
  const headers = grant.headers as Record<string, unknown>
  if (Object.keys(headers).length !== 1 || headers['Content-Type'] !== contentType) return fail()
  const urls = ['upload_url', 'asset_url', 'head_url'].map((key, index) => {
    if (typeof grant[key] !== 'string') return fail()
    let url: URL
    try { url = new URL(grant[key]) } catch { return fail() }
    if (url.origin !== origin || url.username || url.password || url.hash || !objectPath.test(url.pathname)
      || /%(?:2e|2f|5c)/i.test(String(grant[key]).split('?')[0]!) || url.searchParams.get('X-Amz-Algorithm') !== 'AWS4-HMAC-SHA256'
      || !/^[a-f0-9]{64}$/.test(url.searchParams.get('X-Amz-Signature') || '')
      || !/^\d{8}T\d{6}Z$/.test(url.searchParams.get('X-Amz-Date') || '')
      || !url.searchParams.get('X-Amz-Credential')
      || url.searchParams.get('X-Amz-Expires') !== (index === 0 ? '300' : '21600')
      || url.searchParams.get('X-Amz-SignedHeaders') !== (index === 0 ? 'content-length;content-type;host' : 'host')
      || [...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1)) return fail()
    return url
  })
  if (urls.some(url => url.pathname !== urls[0]!.pathname) || urls[1]!.searchParams.get('X-Amz-Signature') === urls[2]!.searchParams.get('X-Amz-Signature')) return fail()
  return { uploadUrl: urls[0]!.href, assetUrl: urls[1]!.href, headers: { 'Content-Type': contentType } }
}

export function isLegacyCreationOssUrl(source: string): boolean {
  try {
    const url = new URL(source)
    // Identify platform temporary uploads, not unrelated vendor objects on Aliyun.
    return /^[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(url.hostname)
      && /^\/creation-temp\/[1-9]\d*\/[a-f0-9]{32}\.[a-z0-9]+$/.test(url.pathname)
      && url.searchParams.has('OSSAccessKeyId') && url.searchParams.has('Signature')
  } catch { return false }
}

export function assertNoLegacyCreationOssReference(source: string): void {
  if (isLegacyCreationOssUrl(source)) throw new Error('历史 OSS 参考素材需恢复或选择本地原件后重新上传 R2')
}

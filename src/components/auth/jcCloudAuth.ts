export interface JcCloudLoginPayload {
  username: string
  password: string
}

export interface JcCloudLoginUser {
  id?: string
  username?: string
  email?: string
}

export interface JcCloudLoginResult {
  user?: JcCloudLoginUser
  baseUrl?: string
  raw?: unknown
}

function readNestedString(source: any, paths: string[][]): string {
  for (const path of paths) {
    let current = source
    for (const key of path) current = current?.[key]
    if (typeof current === 'string' && current.trim()) return current.trim()
  }
  return ''
}

export function extractJcCloudUser(payload: any): JcCloudLoginUser | undefined {
  const user = payload?.user || payload?.data?.user || payload?.data?.account || payload?.account
  return user && typeof user === 'object' ? user : undefined
}

export async function loginToJcCloud(
  apiBase: string,
  credentials: JcCloudLoginPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<JcCloudLoginResult> {
  const base = apiBase.replace(/\/+$/, '')
  const response = await fetchImpl(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : {}
  if (!response.ok) {
    const message = data?.message || data?.error?.message || data?.error || text || `HTTP ${response.status}`
    throw new Error(String(message))
  }
  return {
    user: extractJcCloudUser(data),
    baseUrl: readNestedString(data, [['baseUrl'], ['base_url'], ['data', 'baseUrl'], ['data', 'base_url']]) || base,
    raw: data,
  }
}

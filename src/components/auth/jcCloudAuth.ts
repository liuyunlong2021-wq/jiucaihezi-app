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
  apiKey: string
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

export function extractJcCloudApiKey(payload: any): string {
  return readNestedString(payload, [
    ['apiKey'],
    ['api_key'],
    ['key'],
    ['token'],
    ['data', 'apiKey'],
    ['data', 'api_key'],
    ['data', 'key'],
    ['data', 'token'],
    ['data', 'user', 'apiKey'],
    ['data', 'user', 'api_key'],
    ['user', 'apiKey'],
    ['user', 'api_key'],
  ])
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
  const apiKey = extractJcCloudApiKey(data)
  if (!apiKey) throw new Error('登录响应缺少 API Key')
  return {
    apiKey,
    user: extractJcCloudUser(data),
    baseUrl: readNestedString(data, [['baseUrl'], ['base_url'], ['data', 'baseUrl'], ['data', 'base_url']]) || base,
    raw: data,
  }
}

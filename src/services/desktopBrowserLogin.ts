import { openExternal } from '@/utils/httpClient'
import { prepareApiKeyCallbackIntent } from './apiKeyCallback'
import { getGatewayBaseUrl } from './newApiClient'

export const DESKTOP_LOGIN_CALLBACK_URL = 'jiucaihezi://auth/callback'

export interface BuildDesktopBrowserLoginUrlInput {
  gatewayBase?: string
  callbackUrl?: string
  storage?: Storage
}

export function buildDesktopBrowserLoginUrl(input: BuildDesktopBrowserLoginUrlInput = {}): string {
  const gatewayBase = String(input.gatewayBase || getGatewayBaseUrl()).replace(/\/+$/, '')
  const callbackUrl = String(input.callbackUrl || DESKTOP_LOGIN_CALLBACK_URL)
  const state = prepareApiKeyCallbackIntent(input.storage)
  const url = new URL('/auth/desktop/start', gatewayBase)
  url.searchParams.set('state', state)
  url.searchParams.set('redirect', callbackUrl)
  return url.href
}

export async function beginDesktopBrowserLogin(input: BuildDesktopBrowserLoginUrlInput = {}): Promise<string> {
  const url = buildDesktopBrowserLoginUrl(input)
  await openExternal(url)
  return url
}

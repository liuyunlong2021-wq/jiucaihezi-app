import { getApiKey } from '@/services/newApiClient'
import {
  DEFAULT_PROVIDER_ID,
  DEFAULT_PROVIDER_HOST,
  rotateProviderKey,
} from '@/utils/providerConfig'
import { runAndCacheProviderCapabilityProbe, type ProviderCapabilityProbe } from '@/utils/providerCapabilityProbe'

export async function warmDefaultProviderCapabilityProbe(): Promise<ProviderCapabilityProbe | null> {
  const key = String(getApiKey() || '').trim()
  if (!key) return null
  const model = localStorage.getItem('jcModel') || 'gpt-5.5'
  return runAndCacheProviderCapabilityProbe({
    providerId: DEFAULT_PROVIDER_ID,
    apiHost: DEFAULT_PROVIDER_HOST,
    apiKey: rotateProviderKey(DEFAULT_PROVIDER_ID, key),
    testModel: model,
    timeoutMs: 8000,
  })
}


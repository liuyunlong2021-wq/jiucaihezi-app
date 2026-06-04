import { readFirstEnv, trimBaseUrl } from './env.js';
import { upstreamError } from './errors.js';
import { ensureLegacyManagedTokenKey } from './auth-service.js';

function sanitizePayload(payload) {
  const next = { ...(payload || {}) };
  delete next.apiKey;
  delete next.api_key;
  delete next.baseUrl;
  delete next.base_url;
  if (next.stream === undefined) next.stream = false;
  return next;
}

function newApiBase(env) {
  return trimBaseUrl(readFirstEnv(env, ['NEWAPI_BASE_URL', 'NEW_API_BASE_URL', 'NEWAPI_API_URL'], 'https://api.jiucaihezi.studio'));
}

function requestFor(baseUrl, token, payload, { userId = '', stream = false } = {}) {
  const safePayload = sanitizePayload({ ...(payload || {}), ...(stream ? { stream: true } : {}) });
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'x-api-key': token,
    'X-API-Key': token
  };
  if (userId) {
    headers['New-API-User'] = userId;
    headers['X-New-Api-User'] = userId;
  }
  return {
    url: `${String(baseUrl || '').replace(/\/+$/, '')}/v1/chat/completions`,
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify(safePayload)
    }
  };
}

async function parseUpstreamError(response, fallback) {
  const text = await response.text();
  try {
    const payload = text ? JSON.parse(text) : {};
    return payload && (payload.message || payload.error && payload.error.message) || fallback;
  } catch {
    return text || fallback;
  }
}

export async function submitManualChatCompletion({ env, token, payload }) {
  const request = requestFor(newApiBase(env), token, payload);
  const response = await fetch(request.url, request.init);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw upstreamError(data && (data.message || data.error && data.error.message) || `NewAPI HTTP ${response.status}`);
  return data;
}

export async function submitManualChatCompletionStream({ env, token, payload }) {
  const request = requestFor(newApiBase(env), token, payload, { stream: true });
  const response = await fetch(request.url, request.init);
  if (!response.ok) throw upstreamError(await parseUpstreamError(response, `NewAPI HTTP ${response.status}`));
  return response;
}

export async function submitUserChatCompletion({ env, user, payload }) {
  const token = await ensureLegacyManagedTokenKey(env, user);
  const userId = String(user && (user.legacyUserId || user.userId || user.id) || '').replace(/^user_web_/, '');
  const request = requestFor(newApiBase(env), token, payload, { userId });
  const response = await fetch(request.url, request.init);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw upstreamError(data && (data.message || data.error && data.error.message) || `NewAPI HTTP ${response.status}`);
  return data;
}

export async function submitUserChatCompletionStream({ env, user, payload }) {
  const token = await ensureLegacyManagedTokenKey(env, user);
  const userId = String(user && (user.legacyUserId || user.userId || user.id) || '').replace(/^user_web_/, '');
  const request = requestFor(newApiBase(env), token, payload, { userId, stream: true });
  const response = await fetch(request.url, request.init);
  if (!response.ok) throw upstreamError(await parseUpstreamError(response, `NewAPI HTTP ${response.status}`));
  return response;
}

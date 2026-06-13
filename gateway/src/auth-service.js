import { badRequest, unauthorized } from './errors.js';
import { NEWAPI_ADMIN_TOKEN_ENV_NAMES, readFirstEnv, trimBaseUrl } from './env.js';

export const SESSION_COOKIE_NAME = 'jc_session';

export function legacyApiBase(env) {
  return trimBaseUrl(readFirstEnv(env, ['NEWAPI_BASE_URL', 'NEW_API_BASE_URL', 'NEWAPI_API_URL'], 'https://api.jiucaihezi.studio'));
}

function bearer(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return /^Bearer\s+/i.test(text) ? text : `Bearer ${text}`;
}

function withGatewaySecret(env, headers = {}) {
  const secret = readFirstEnv(env, ['GATEWAY_SECRET', 'NEWAPI_GATEWAY_SECRET'], '');
  const next = { ...headers };
  if (secret) {
    next['X-Gateway-Secret'] = secret;
    next['X-Gateway-Source'] = 'jiucaihezi-gateway';
  }
  return next;
}

function buildLegacyUserHeaders(userId, accessToken = '', withJson = false) {
  const headers = {
    'New-API-User': String(userId || '').trim(),
    'X-New-Api-User': String(userId || '').trim()
  };
  if (withJson) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = bearer(accessToken);
  return headers;
}

function parseCookie(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index < 0) return;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  });
  return out;
}

function randomId(prefix) {
  const id = globalThis.crypto && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${String(id).replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

function compactTimestamp(now = new Date()) {
  return now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
}

function browserTokenName(now = new Date()) {
  return `jc-desk-${compactTimestamp(now)}-${randomId('k').slice(0, 6)}`;
}

function normalizeApiKey(value) {
  const text = String(value || '').trim();
  const key = text.startsWith('sk-') ? text : `sk-${text}`;
  return /^sk-[A-Za-z0-9._~+/=-]{20,}$/.test(key) ? key : '';
}

async function readJsonPayload(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function browserCookieHeaders(request, withJson = false) {
  const headers = {};
  const cookie = request.headers.get('Cookie') || request.headers.get('cookie') || '';
  if (cookie) headers.Cookie = cookie;
  const userId = String(
    request.headers.get('New-Api-User')
    || request.headers.get('new-api-user')
    || request.headers.get('X-New-Api-User')
    || request.headers.get('x-new-api-user')
    || ''
  ).trim();
  if (/^[0-9A-Za-z_-]{1,128}$/.test(userId)) {
    headers['New-Api-User'] = userId;
    headers['X-New-Api-User'] = userId;
  }
  if (withJson) headers['Content-Type'] = 'application/json';
  return headers;
}

function extractTokenId(payload) {
  return payload && (
    payload.id
    || payload.data && payload.data.id
    || payload.token && payload.token.id
  );
}

async function findBrowserTokenId(env, request, tokenName) {
  const paths = [
    `/api/token/search?keyword=${encodeURIComponent(tokenName)}&p=1&page_size=10`,
    '/api/token/?p=1&page_size=100'
  ];
  for (const path of paths) {
    const response = await fetch(`${legacyApiBase(env)}${path}`, {
      method: 'GET',
      headers: withGatewaySecret(env, browserCookieHeaders(request))
    });
    if (!response.ok) continue;
    const payload = await readJsonPayload(response);
    const data = payload && payload.data;
    const items = Array.isArray(data && data.items) ? data.items
      : Array.isArray(data && data.data) ? data.data
        : Array.isArray(data) ? data
          : Array.isArray(payload && payload.items) ? payload.items
            : [];
    const match = items.find((item) => item && item.name === tokenName && item.id != null);
    if (match) return match.id;
  }
  return '';
}

export async function createDesktopManagedTokenKeyFromBrowserCookie(env, request) {
  const cookie = request.headers.get('Cookie') || request.headers.get('cookie') || '';
  if (!cookie) throw unauthorized('请先在浏览器登录韭菜盒子账号');

  const tokenName = browserTokenName();
  const group = String(env.NEWAPI_AUTO_GROUP || env.NEWAPI_DEFAULT_GROUP || 'auto').trim() || 'auto';
  const createResponse = await fetch(`${legacyApiBase(env)}/api/token/`, {
    method: 'POST',
    headers: withGatewaySecret(env, browserCookieHeaders(request, true)),
    body: JSON.stringify({
      name: tokenName,
      remain_quota: 0,
      expired_time: -1,
      unlimited_quota: true,
      model_limits_enabled: false,
      model_limits: '',
      allow_ips: '',
      group,
      cross_group_retry: true
    })
  });
  if (createResponse.status === 401 || createResponse.status === 403) {
    throw unauthorized('请先在浏览器登录韭菜盒子账号');
  }
  const createPayload = await readJsonPayload(createResponse);
  if (!createResponse.ok || createPayload && createPayload.success === false) {
    throw badRequest(createPayload && createPayload.message || `创建 Key 失败：HTTP ${createResponse.status}`);
  }

  const tokenId = extractTokenId(createPayload) || await findBrowserTokenId(env, request, tokenName);
  if (tokenId == null || tokenId === '') throw badRequest('创建成功但没有返回 Key ID');

  const keyResponse = await fetch(`${legacyApiBase(env)}/api/token/${encodeURIComponent(String(tokenId))}/key`, {
    method: 'POST',
    headers: withGatewaySecret(env, browserCookieHeaders(request, true))
  });
  if (keyResponse.status === 401 || keyResponse.status === 403) {
    throw unauthorized('请先在浏览器登录韭菜盒子账号');
  }
  const keyPayload = await readJsonPayload(keyResponse);
  if (!keyResponse.ok || keyPayload && keyPayload.success === false) {
    throw badRequest(keyPayload && keyPayload.message || `获取 Key 失败：HTTP ${keyResponse.status}`);
  }
  const apiKey = normalizeApiKey(keyPayload && keyPayload.data && keyPayload.data.key || keyPayload && keyPayload.key || keyPayload && keyPayload.data);
  if (!apiKey) throw badRequest('NewAPI 没有返回有效的 sk- Key');
  return apiKey;
}

async function safeKvPut(env, key, value, options) {
  if (!env || !env.PLUGIN_KV || typeof env.PLUGIN_KV.put !== 'function') return false;
  try {
    await env.PLUGIN_KV.put(key, value, options);
    return true;
  } catch (error) {
    console.warn('[Gateway Auth] KV write skipped', error && error.message);
    return false;
  }
}

async function safeKvGet(env, key) {
  if (!env || !env.PLUGIN_KV || typeof env.PLUGIN_KV.get !== 'function') return null;
  try {
    return await env.PLUGIN_KV.get(key);
  } catch (error) {
    console.warn('[Gateway Auth] KV read skipped', error && error.message);
    return null;
  }
}

async function safeKvDelete(env, key) {
  if (!env || !env.PLUGIN_KV || typeof env.PLUGIN_KV.delete !== 'function') return false;
  try {
    await env.PLUGIN_KV.delete(key);
    return true;
  } catch (error) {
    console.warn('[Gateway Auth] KV delete skipped', error && error.message);
    return false;
  }
}

function hasDb(env) {
  return !!(env && env.DB && typeof env.DB.prepare === 'function');
}

async function saveUserToDb(env, user) {
  if (!hasDb(env)) return false;
  try {
    await env.DB.prepare(
      `INSERT INTO users (id, username, email, user_json, updated_at)
       VALUES (?1,?2,?3,?4,?5)
       ON CONFLICT(id) DO UPDATE SET
         username=excluded.username,
         email=excluded.email,
         user_json=excluded.user_json,
         updated_at=excluded.updated_at`
    ).bind(user.id, user.username || '', user.email || '', JSON.stringify(user), new Date().toISOString()).run();
    return true;
  } catch (error) {
    console.warn('[Gateway Auth] D1 user write skipped', error && error.message);
    return false;
  }
}

async function readUserFromDb(env, id) {
  if (!hasDb(env)) return null;
  try {
    const row = await env.DB.prepare('SELECT user_json FROM users WHERE id = ?1').bind(String(id || '')).first();
    return row && row.user_json ? JSON.parse(row.user_json) : null;
  } catch (error) {
    console.warn('[Gateway Auth] D1 user read skipped', error && error.message);
    return null;
  }
}

async function saveSessionToDb(env, session) {
  if (!hasDb(env)) return false;
  try {
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, created_at, expires_at)
       VALUES (?1,?2,?3,?4)
       ON CONFLICT(id) DO UPDATE SET
         user_id=excluded.user_id,
         created_at=excluded.created_at,
         expires_at=excluded.expires_at`
    ).bind(session.id, session.userId, session.createdAt, session.expiresAt).run();
    return true;
  } catch (error) {
    console.warn('[Gateway Auth] D1 session write skipped', error && error.message);
    return false;
  }
}

async function readSessionFromDb(env, sessionId) {
  if (!hasDb(env)) return null;
  try {
    const row = await env.DB.prepare('SELECT id, user_id, created_at, expires_at FROM sessions WHERE id = ?1')
      .bind(String(sessionId || ''))
      .first();
    if (!row) return null;
    const expiresAt = String(row.expires_at || row.expiresAt || '');
    if (expiresAt && expiresAt <= new Date().toISOString()) return null;
    return {
      id: String(row.id || sessionId),
      userId: String(row.user_id || row.userId || ''),
      createdAt: String(row.created_at || row.createdAt || ''),
      expiresAt
    };
  } catch (error) {
    console.warn('[Gateway Auth] D1 session read skipped', error && error.message);
    return null;
  }
}

async function revokeSessionInDb(env, sessionId) {
  if (!hasDb(env)) return false;
  try {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, created_at, expires_at)
       VALUES (?1,'',?2,?2)
       ON CONFLICT(id) DO UPDATE SET user_id='', expires_at=excluded.expires_at`
    ).bind(String(sessionId || ''), now).run();
    return true;
  } catch (error) {
    console.warn('[Gateway Auth] D1 session delete skipped', error && error.message);
    return false;
  }
}

export async function saveUser(env, user) {
  const dbSuccess = await saveUserToDb(env, user);
  const kvSuccess = await safeKvPut(env, `user:${user.id}`, JSON.stringify(user));
  if (!dbSuccess && !kvSuccess) throw new Error('无法保存用户数据：D1 和 KV 存储均不可用');
  if (user.username) await safeKvPut(env, `user:username:${String(user.username).toLowerCase()}`, user.id);
  if (user.email) await safeKvPut(env, `user:email:${String(user.email).toLowerCase()}`, user.id);
  return user;
}

export async function readUser(env, id) {
  const dbUser = await readUserFromDb(env, id);
  if (dbUser) return dbUser;
  const raw = await safeKvGet(env, `user:${id}`);
  return raw ? JSON.parse(raw) : null;
}

function normalizeLegacyUser(input, payload, legacySessionCookie = '') {
  const data = payload && payload.data || payload && payload.user || {};
  const loginName = String(input && (input.username || input.email || input.login) || '').trim();
  const externalId = String(data.id || data.user_id || data.userId || '').trim();
  const email = String(data.email || (loginName.includes('@') ? loginName : '') || '').trim().toLowerCase();
  const username = String(
    data.username ||
    data.name ||
    (!loginName.includes('@') ? loginName : '') ||
    (email ? email.split('@')[0] : '') ||
    (externalId ? `web_${externalId}` : `web_${Date.now()}`)
  ).trim();
  return {
    id: externalId ? `user_web_${String(externalId).replace(/[^a-zA-Z0-9_-]/g, '')}` : randomId('user_web'),
    username,
    email,
    role: 'member',
    authProvider: 'web',
    legacyUserId: externalId,
    legacyAccessToken: String(data.access_token || data.accessToken || data.token || ''),
    legacySessionCookie: String(legacySessionCookie || '').trim(),
    balanceFlowers: Number(data.balanceFlowers || data.balance_flowers || data.quota || 0),
    request_count: Number(data.request_count || data.requestCount || 0),
    plan: String(data.plan || 'web'),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function fetchJsonPayload(response, fallbackMessage) {
  const text = await response.text();
  if (!text) throw new Error(fallbackMessage || '服务无响应');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(fallbackMessage || '返回格式错误');
  }
}

export async function loginWithWebAccount(env, input) {
  const loginName = String(input && (input.username || input.email || input.login) || '').trim();
  const password = String(input && input.password || '');
  if (!loginName || !password || typeof fetch !== 'function') return null;
  const response = await fetch(`${legacyApiBase(env)}/api/user/login`, {
    method: 'POST',
    headers: withGatewaySecret(env, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ username: loginName, password })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.success !== true) {
    const message = payload && payload.message ? String(payload.message) : '账号或密码不正确';
    console.warn('[Gateway Auth] legacy login failed', {
      baseUrl: legacyApiBase(env),
      status: response.status,
      ok: response.ok,
      success: payload && payload.success,
      code: payload && payload.code,
      message
    });
    if (message && !/账号|密码|username|password/i.test(message)) throw badRequest(message);
    return null;
  }
  const user = normalizeLegacyUser(input, payload, response.headers.get('set-cookie') || '');
  return saveUser(env, user);
}

export function publicUser(user) {
  return {
    id: String(user && user.id || ''),
    username: String(user && user.username || ''),
    email: String(user && user.email || ''),
    balanceFlowers: Number(user && user.balanceFlowers || 0),
    request_count: Number(user && (user.request_count || user.requestCount) || 0),
    plan: String(user && user.plan || 'web')
  };
}

export async function createSession(env, user) {
  const session = {
    id: randomId('sess'),
    userId: user.id,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60 * 24 * 30 * 1000).toISOString()
  };
  await saveSessionToDb(env, session);
  await safeKvPut(env, `session:${session.id}`, JSON.stringify(session), { expirationTtl: 60 * 60 * 24 * 30 });
  return session;
}

export function getSessionId(request) {
  const authorization = request.headers.get('Authorization') || request.headers.get('authorization') || '';
  const bearerMatch = String(authorization || '').match(/^Bearer\s+(.+)$/i);
  if (bearerMatch && bearerMatch[1]) return bearerMatch[1].trim();
  const desktopSession = request.headers.get('X-JC-Session') || request.headers.get('x-jc-session') || '';
  if (desktopSession) return String(desktopSession).trim();
  const cookies = parseCookie(request.headers.get('Cookie') || request.headers.get('cookie') || '');
  return cookies[SESSION_COOKIE_NAME] || '';
}

export function sessionCookie(session) {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(session.id)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=2592000`;
}

export function expiredSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`;
}

export async function destroySession(env, request) {
  const sessionId = getSessionId(request);
  if (!sessionId) return;
  await revokeSessionInDb(env, sessionId);
  await safeKvDelete(env, `session:${sessionId}`);
}

export async function getSessionUser(request, env) {
  const sessionId = getSessionId(request);
  if (!sessionId) return null;
  let session = await readSessionFromDb(env, sessionId);
  if (!session) {
    const raw = await safeKvGet(env, `session:${sessionId}`);
    if (!raw) return null;
    session = JSON.parse(raw);
  }
  if (session.expiresAt && session.expiresAt <= new Date().toISOString()) return null;
  return readUser(env, session.userId);
}

export async function requireWebUser(request, env) {
  const user = await getSessionUser(request, env);
  if (!user || user.authProvider !== 'web') throw unauthorized('请重新登录韭菜盒子账号');
  return user;
}

function legacyUserIdFrom(user) {
  const id = String(user && (user.legacyUserId || user.userId || user.id) || '').trim();
  return id.replace(/^user_web_/, '');
}

async function fetchLegacyAccessToken(env, user) {
  const legacyUserId = legacyUserIdFrom(user);
  if (!legacyUserId) return '';
  const headers = buildLegacyUserHeaders(legacyUserId, '', false);
  if (user.legacySessionCookie) headers.Cookie = user.legacySessionCookie;
  const response = await fetch(`${legacyApiBase(env)}/api/user/token`, {
    method: 'GET',
    headers: withGatewaySecret(env, headers)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.success === false) return '';
  return String(payload.data || payload.access_token || payload.accessToken || payload.token || '').trim();
}

function extractNewApiItems(payload) {
  const data = payload && payload.data ? payload.data : null;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

async function fetchLegacyTokenKeyById(env, userId, tokenId, accessToken) {
  const response = await fetch(`${legacyApiBase(env)}/api/token/${encodeURIComponent(tokenId)}/key`, {
    method: 'POST',
    headers: withGatewaySecret(env, buildLegacyUserHeaders(userId, accessToken, false))
  });
  const payload = await fetchJsonPayload(response, '读取账号对话令牌失败');
  const key = String(payload && payload.data && payload.data.key || payload && payload.key || '').trim();
  if (!response.ok || !payload || payload.success === false || !key) throw new Error(payload && payload.message ? payload.message : '读取账号对话令牌失败');
  return key;
}

async function fetchOrCreateLegacyManagedTokenKey(env, userId, accessToken, targetGroup = 'auto') {
  const tokenName = '韭菜盒子工作台';
  const group = String(targetGroup || 'auto').trim() || 'auto';
  const listResponse = await fetch(`${legacyApiBase(env)}/api/token/?p=0&size=20`, {
    method: 'GET',
    headers: withGatewaySecret(env, buildLegacyUserHeaders(userId, accessToken, false))
  });
  const listPayload = await fetchJsonPayload(listResponse, '读取账号对话令牌失败');
  if (!listResponse.ok || !listPayload || listPayload.success === false) throw new Error(listPayload && listPayload.message ? listPayload.message : '读取账号对话令牌失败');
  let items = extractNewApiItems(listPayload);
  let found = items.find((item) => item && item.name === tokenName);
  if (!found) {
    const createResponse = await fetch(`${legacyApiBase(env)}/api/token/`, {
      method: 'POST',
      headers: withGatewaySecret(env, buildLegacyUserHeaders(userId, accessToken, true)),
      body: JSON.stringify({
        name: tokenName,
        remain_quota: 50000000,
        expired_time: -1,
        unlimited_quota: true,
        group
      })
    });
    const createPayload = await fetchJsonPayload(createResponse, '创建账号对话令牌失败');
    if (!createResponse.ok || !createPayload || createPayload.success === false) throw new Error(createPayload && createPayload.message ? createPayload.message : '创建账号对话令牌失败');
    const relistResponse = await fetch(`${legacyApiBase(env)}/api/token/?p=0&size=20`, {
      method: 'GET',
      headers: withGatewaySecret(env, buildLegacyUserHeaders(userId, accessToken, false))
    });
    const relistPayload = await fetchJsonPayload(relistResponse, '刷新账号对话令牌失败');
    items = extractNewApiItems(relistPayload);
    found = items.find((item) => item && item.name === tokenName);
  }
  if (!found || !found.id) throw new Error('账号对话令牌创建后未找到');
  return fetchLegacyTokenKeyById(env, userId, found.id, accessToken);
}

export async function ensureLegacyManagedTokenKey(env, user) {
  const legacyUserId = legacyUserIdFrom(user);
  if (!legacyUserId) return '';
  const targetGroup = String(env.NEWAPI_AUTO_GROUP || env.NEWAPI_DEFAULT_GROUP || 'auto').trim() || 'auto';
  const cached = String(user.legacyManagedTokenKey || '').trim();
  const cachedGroup = String(user.legacyManagedTokenGroup || '').trim();
  if (cached && cachedGroup === targetGroup) return cached;
  const accessToken = String(user.legacyAccessToken || '').trim() || await fetchLegacyAccessToken(env, user);
  if (!accessToken) throw new Error('账号对话通道初始化失败，请重新登录后再试。');
  const managedTokenKey = await fetchOrCreateLegacyManagedTokenKey(env, legacyUserId, accessToken, targetGroup);
  await saveUser(env, {
    ...user,
    legacyAccessToken: accessToken,
    legacyManagedTokenKey: managedTokenKey,
    legacyManagedTokenGroup: targetGroup,
    updatedAt: new Date().toISOString()
  });
  return managedTokenKey;
}

export function extractManualApiKey(request) {
  const desktopSession = request.headers.get('X-JC-Session') || request.headers.get('x-jc-session') || '';
  if (desktopSession) return '';
  const authorization = request.headers.get('Authorization') || request.headers.get('authorization') || '';
  const bearerMatch = String(authorization || '').match(/^Bearer\s+(.+)$/i);
  const token = String((bearerMatch && bearerMatch[1]) || request.headers.get('x-api-key') || request.headers.get('X-API-Key') || '').trim();
  return /^sk-[A-Za-z0-9._~+/=-]{8,}$/i.test(token) ? token : '';
}

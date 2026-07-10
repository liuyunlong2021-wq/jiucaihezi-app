import { corsHeaders, dedupeCorsOrigin, handleOptions, resolveOrigin } from './cors.js';
import { badRequest } from './errors.js';
import { errorResponse, jsonResponse, notFound, readJson } from './http.js';
import {
  createDesktopManagedTokenKeyFromBrowserCookie,
  destroySession,
  expiredSessionCookie,
  ensureLegacyManagedTokenKey,
  getSessionUser,
  loginWithWebAccount,
  publicUser
} from './auth-service.js';

async function handleLogin(request, env) {
  const body = await readJson(request);
  const user = await loginWithWebAccount(env, body);
  if (!user) {
    return jsonResponse({
      success: false,
      code: 'unauthorized',
      message: '账号或密码不正确',
      status: 401
    }, 401, request);
  }
  const apiKey = await ensureLegacyManagedTokenKey(env, user);
  return jsonResponse({
    success: true,
    api_key: apiKey,
    base_url: 'https://api.jiucaihezi.studio/v1',
    username: publicUser(user).username,
    user: publicUser(user),
  }, 200, request);
}

async function handleLogout(request, env) {
  await destroySession(env, request);
  return jsonResponse({ success: true }, 200, request, { 'Set-Cookie': expiredSessionCookie() });
}

async function handleSession(request, env) {
  const user = await getSessionUser(request, env);
  return jsonResponse({
    authenticated: !!user,
    user: user ? publicUser(user) : null
  }, 200, request);
}

function readDesktopAuthParams(request) {
  const url = new URL(request.url);
  const state = String(url.searchParams.get('state') || '').trim();
  const redirect = String(url.searchParams.get('redirect') || '').trim();
  return validateDesktopAuthParams(state, redirect);
}

function desktopAuthNoStoreHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff'
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function compactTimestamp(now = new Date()) {
  return now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
}

function buildDesktopDeepLink(redirect, state, apiKey) {
  const callback = new URL(redirect);
  callback.searchParams.set('key', apiKey);
  callback.searchParams.set('state', state);
  return callback.href;
}

function desktopAuthBridgeHtml({ tokenUrl, signInUrl }) {
  const safeTokenUrl = JSON.stringify(tokenUrl);
  const safeSignInUrl = JSON.stringify(signInUrl);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>韭菜盒子登录</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; background: #f6f7f2; color: #1f2a21; }
    .bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 18px; border-bottom: 1px solid rgba(31,42,33,.12); background: #fff; }
    .title { font-weight: 700; }
    .status { color: #5b6b5e; font-size: 14px; }
    .actions { display: none; align-items: center; gap: 10px; padding: 12px 18px; border-bottom: 1px solid rgba(31,42,33,.1); background: #f8fbf6; }
    .actions.visible { display: flex; }
    .hint { color: #5b6b5e; font-size: 14px; }
    button { border: 0; border-radius: 8px; background: #2f7d3b; color: #fff; cursor: pointer; font-weight: 700; padding: 10px 14px; }
    button:disabled { cursor: not-allowed; opacity: .62; }
    .frame { width: 100%; height: calc(100vh - 107px); border: 0; display: block; background: #fff; }
    .fallback { display: none; padding: 16px 18px; border-bottom: 1px solid rgba(31,42,33,.1); }
    a { color: #2f7d3b; }
  </style>
</head>
<body>
  <div class="bar">
    <div>
      <div class="title">韭菜盒子桌面登录</div>
      <div id="status" class="status">请在下方完成网页账号登录，完成后会自动返回 App。</div>
    </div>
  </div>
  <div id="actions" class="actions">
    <button id="authorize" type="button">授权桌面端登录</button>
    <span id="authorizeHint" class="hint">检测到网页登录状态，请确认授权韭菜盒子桌面端使用你的账号。</span>
  </div>
  <iframe id="signin" class="frame" src="${escapeHtml(signInUrl)}" title="韭菜盒子网页登录"></iframe>
  <div id="fallback" class="fallback">
    如果登录页没有显示，请 <a id="signinLink" rel="noreferrer">打开登录页</a>，登录完成后回到此页等待自动返回。
  </div>
  <script>
    const tokenUrl = ${safeTokenUrl};
    const signInUrl = ${safeSignInUrl};
    const callbackUrl = new URL(tokenUrl).searchParams.get('redirect') || '';
    const state = new URL(tokenUrl).searchParams.get('state') || '';
    const statusEl = document.getElementById('status');
    const actionsEl = document.getElementById('actions');
    const authorizeEl = document.getElementById('authorize');
    const authorizeHintEl = document.getElementById('authorizeHint');
    const fallbackEl = document.getElementById('fallback');
    const signinLink = document.getElementById('signinLink');
    signinLink.href = signInUrl;
    let returned = false;
    let attempts = 0;

    function readWebUserId() {
      try {
        const uid = String(window.localStorage.getItem('uid') || '').trim();
        return uid && /^[0-9A-Za-z_-]{1,128}$/.test(uid) ? uid : '';
      } catch (_) {
        return '';
      }
    }

    async function readJson(response) {
      const text = await response.text();
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch (_) {
        return {};
      }
    }

    async function createDesktopKeyFromWebSession() {
      const uid = readWebUserId();
      if (!uid) throw new Error('还没有检测到网页账号登录状态');
      const response = await fetch('/auth/desktop/authorize', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'New-Api-User': uid,
          'X-New-Api-User': uid,
          'Cache-Control': 'no-store'
        },
        body: JSON.stringify({ state, redirect: callbackUrl })
      });
      const payload = await readJson(response);
      if (!response.ok || payload && payload.success === false) {
        throw new Error(payload && payload.message || '授权桌面端失败');
      }
      if (!payload || !payload.deep_link) throw new Error('授权成功但没有返回桌面端回调地址');
      return payload.deep_link;
    }

    async function authorizeDesktop() {
      if (returned) return;
      authorizeEl.disabled = true;
      authorizeHintEl.textContent = '正在为桌面端生成登录凭证...';
      try {
        const deepLink = await createDesktopKeyFromWebSession();
        returned = true;
        statusEl.textContent = '登录成功，正在返回 App...';
        authorizeHintEl.textContent = '授权成功，正在打开韭菜盒子。';
        window.location.href = deepLink;
      } catch (err) {
        authorizeEl.disabled = false;
        authorizeHintEl.textContent = err && err.message ? err.message : '授权失败，请刷新后重试。';
      }
    }

    function refreshAuthorizeState() {
      if (returned) return;
      const uid = readWebUserId();
      if (uid) {
        actionsEl.classList.add('visible');
        statusEl.textContent = '检测到网页账号已登录，请确认授权桌面端。';
      }
    }

    async function pollDesktopToken() {
      if (returned) return;
      attempts += 1;
      try {
        const response = await fetch(tokenUrl, {
          credentials: 'include',
          cache: 'no-store',
          headers: { Accept: 'application/json' }
        });
        if (response.ok) {
          const payload = await response.json();
          if (payload && payload.success && payload.deep_link) {
            returned = true;
            statusEl.textContent = '登录成功，正在返回 App...';
            window.location.href = payload.deep_link;
            return;
          }
        }
      } catch (_) {}
      if (attempts > 3) fallbackEl.style.display = 'block';
      window.setTimeout(pollDesktopToken, attempts < 10 ? 1500 : 3000);
    }

    authorizeEl.addEventListener('click', authorizeDesktop);
    refreshAuthorizeState();
    window.setInterval(refreshAuthorizeState, 1200);
    pollDesktopToken();
  </script>
</body>
</html>`;
}

function desktopAuthJsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: desktopAuthNoStoreHeaders('application/json; charset=utf-8')
  });
}

async function readDesktopAuthBodyParams(request) {
  const body = await readJson(request);
  const state = String(body.state || '').trim();
  const redirect = String(body.redirect || '').trim();
  return validateDesktopAuthParams(state, redirect);
}

function validateDesktopAuthParams(state, redirect) {
  if (!/^[a-zA-Z0-9_-]{24,128}$/.test(state)) throw badRequest('登录 state 无效');
  let redirectUrl;
  try {
    redirectUrl = new URL(redirect);
  } catch {
    throw badRequest('登录回调地址无效');
  }
  const isDesktopDeepLink = redirectUrl.protocol === 'jiucaihezi:' && redirectUrl.hostname === 'auth' && redirectUrl.pathname === '/callback';
  const isTauriDev = redirectUrl.protocol === 'tauri:' && redirectUrl.hostname === 'localhost';
  if (!isDesktopDeepLink && !isTauriDev) throw badRequest('登录回调地址不受信任');
  return { state, redirect: redirectUrl.href };
}

async function handleDesktopAuthAuthorize(request, env) {
  const { state, redirect } = await readDesktopAuthBodyParams(request);
  const apiKey = await createDesktopManagedTokenKeyFromBrowserCookie(env, request);
  return desktopAuthJsonResponse({
    success: true,
    state,
    deep_link: buildDesktopDeepLink(redirect, state, apiKey)
  });
}

async function handleDesktopAuthStart(request, env) {
  const { state, redirect } = readDesktopAuthParams(request);
  const tokenUrl = new URL('/auth/desktop/token', request.url);
  tokenUrl.searchParams.set('state', state);
  tokenUrl.searchParams.set('redirect', redirect);
  const signIn = new URL('/sign-in', request.url);
  return new Response(desktopAuthBridgeHtml({ tokenUrl: tokenUrl.href, signInUrl: signIn.href }), {
    status: 200,
    headers: desktopAuthNoStoreHeaders('text/html; charset=utf-8')
  });
}

async function handleDesktopAuthCallback(request, env) {
  const { state, redirect } = readDesktopAuthParams(request);
  const apiKey = await createDesktopManagedTokenKeyFromBrowserCookie(env, request);
  const callback = buildDesktopDeepLink(redirect, state, apiKey);
  return new Response(null, {
    status: 302,
    headers: { Location: callback, 'Cache-Control': 'no-store' }
  });
}

async function handleDesktopAuthToken(request, env) {
  const { state, redirect } = readDesktopAuthParams(request);
  const apiKey = await createDesktopManagedTokenKeyFromBrowserCookie(env, request);
  return new Response(JSON.stringify({
    success: true,
    key: apiKey,
    state,
    deep_link: buildDesktopDeepLink(redirect, state, apiKey)
  }, null, 2), {
    status: 200,
    headers: desktopAuthNoStoreHeaders('application/json; charset=utf-8')
  });
}

function handleHealth(request) {
  return jsonResponse({
    success: true,
    service: 'jiucaihezi-studio-login-gateway',
    capabilities: ['auth.login', 'auth.desktop', 'auth.session', 'auth.logout']
  }, 200, request);
}

const LANDING_ASSETS = new Set([
  'index.html',
  'logo.svg',
  'favicon.svg',
  'apple-touch-icon.svg',
  'IMG_5114.JPG',
  'IMG_5107.JPG',
  'IMG_5110.JPG',
  'IMG_5113.JPG',
  'IMG_5108.JPG',
  'IMG_5111.JPG',
  'douyinerweima.jpg',
  'guanfangweixin.jpg',
  '韭菜盒子_0.1.6_aarch64.dmg',
  '韭菜盒子_0.1.6_x64.dmg',
]);

const ROOT_ICON_REDIRECTS = new Map([
  ['/favicon.svg', 'favicon.svg'],
  ['/favicon.ico', 'favicon.svg'],
  ['/apple-touch-icon.svg', 'apple-touch-icon.svg'],
  ['/apple-touch-icon.png', 'apple-touch-icon.svg'],
]);

async function handleLandingHome(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return notFound(request);

  const assetBase = String(env.LANDING_ASSET_BASE_URL || 'https://jiucaihezi.studio/landing').replace(/\/+$/, '');
  const upstream = await fetch(`${assetBase}/index.html`, {
    method: request.method,
    headers: {
      Accept: 'text/html,application/xhtml+xml'
    }
  });
  if (!upstream.ok) return notFound(request);

  const headers = new Headers(upstream.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-cache');
  headers.delete('Content-Encoding');
  headers.delete('Content-Length');

  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: 200,
    headers
  });
}

async function handleLandingAsset(request, env, pathname) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return notFound(request);
  let assetName = '';
  try {
    assetName = decodeURIComponent(pathname.slice('/landing/'.length));
  } catch {
    return notFound(request);
  }
  if (!LANDING_ASSETS.has(assetName) || assetName.includes('/')) return notFound(request);

  const assetBase = String(env.LANDING_ASSET_BASE_URL || 'https://jiucaihezi.studio/landing').replace(/\/+$/, '');
  const headers = new Headers({ Location: `${assetBase}/${encodeURIComponent(assetName)}` });
  headers.set('Cache-Control', 'public, max-age=3600, must-revalidate');
  headers.set('Access-Control-Allow-Origin', '*');

  return new Response(null, { status: 302, headers });
}

async function handleRootIcon(request, env, pathname) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return notFound(request);
  const assetName = ROOT_ICON_REDIRECTS.get(pathname);
  if (!assetName) return notFound(request);

  const assetBase = String(env.LANDING_ASSET_BASE_URL || 'https://jiucaihezi.studio/landing').replace(/\/+$/, '');
  const headers = new Headers({ Location: `${assetBase}/${assetName}` });
  headers.set('Cache-Control', 'public, max-age=3600, must-revalidate');
  headers.set('Access-Control-Allow-Origin', '*');

  return new Response(null, { status: 302, headers });
}

export default {
  async fetch(request, env) {
    try {
      if (request.method === 'OPTIONS') return handleOptions(request);
      const url = new URL(request.url);
      if (url.pathname === '/') return Response.redirect('https://api.jiucaihezi.studio/sign-in', 302);
      if (ROOT_ICON_REDIRECTS.has(url.pathname)) return await handleRootIcon(request, env, url.pathname);
      if (request.method === 'GET' && url.pathname === '/health') return handleHealth(request);
      if (url.pathname.startsWith('/landing/')) return await handleLandingAsset(request, env, url.pathname);
      if (request.method === 'GET' && url.pathname === '/auth/desktop/start') return await handleDesktopAuthStart(request, env);
      if (request.method === 'GET' && url.pathname === '/auth/desktop/callback') return await handleDesktopAuthCallback(request, env);
      if (request.method === 'GET' && url.pathname === '/auth/desktop/token') return await handleDesktopAuthToken(request, env);
      if (request.method === 'POST' && url.pathname === '/auth/desktop/authorize') return await handleDesktopAuthAuthorize(request, env);
      if (request.method === 'POST' && url.pathname === '/auth/login') return await handleLogin(request, env);
      if (request.method === 'POST' && url.pathname === '/auth/logout') return await handleLogout(request, env);
      if (request.method === 'GET' && url.pathname === '/auth/session') return await handleSession(request, env);

      // ★ API 代理（CORS 去重）：浏览器同源请求 Gateway，Gateway 转发到 api.jiucaihezi.studio
      if (url.pathname.startsWith('/api/')) {
        const upstreamUrl = `https://api.jiucaihezi.studio${url.pathname}${url.search}`;
        const upstream = await fetch(upstreamUrl, {
          method: request.method,
          headers: request.headers,
          body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
        });
        const respHeaders = new Headers(upstream.headers);
        dedupeCorsOrigin(respHeaders);
        respHeaders.set('Access-Control-Allow-Origin', resolveOrigin(request));
        respHeaders.set('Access-Control-Allow-Credentials', 'true');
        return new Response(upstream.body, {
          status: upstream.status,
          headers: respHeaders,
        });
      }

      // ★ SPA fallback：非 /auth/、/landing/、/api/ 的 GET 返回 index.html
      if (request.method === 'GET'
        && !url.pathname.startsWith('/auth/')
        && !url.pathname.startsWith('/landing/')
        && !url.pathname.startsWith('/api/')) {
        return await handleLandingHome(request, env);
      }

      return notFound(request);
    } catch (error) {
      return errorResponse(error, request);
    }
  }
};

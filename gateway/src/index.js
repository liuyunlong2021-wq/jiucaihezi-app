import { handleOptions } from './cors.js';
import { errorResponse, jsonResponse, notFound, readJson } from './http.js';
import {
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

function handleHealth(request) {
  return jsonResponse({
    success: true,
    service: 'jiucaihezi-studio-login-gateway',
    capabilities: ['auth.login', 'auth.session', 'auth.logout']
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
  '韭菜盒子_0.1.0_aarch64.dmg',
  '韭菜盒子_0.1.0_x64.dmg',
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
      if (url.pathname === '/') return await handleLandingHome(request, env);
      if (ROOT_ICON_REDIRECTS.has(url.pathname)) return await handleRootIcon(request, env, url.pathname);
      if (request.method === 'GET' && url.pathname === '/health') return handleHealth(request);
      if (url.pathname.startsWith('/landing/')) return await handleLandingAsset(request, env, url.pathname);
      if (request.method === 'POST' && url.pathname === '/auth/login') return await handleLogin(request, env);
      if (request.method === 'POST' && url.pathname === '/auth/logout') return await handleLogout(request, env);
      if (request.method === 'GET' && url.pathname === '/auth/session') return await handleSession(request, env);
      return notFound(request);
    } catch (error) {
      return errorResponse(error, request);
    }
  }
};

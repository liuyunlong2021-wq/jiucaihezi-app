import assert from 'node:assert/strict';
import test from 'node:test';
import gateway from '../src/index.js';

function createKv() {
  const map = new Map();
  return {
    map,
    async put(key, value) { map.set(key, value); },
    async get(key) { return map.get(key) || null; },
    async delete(key) { map.delete(key); }
  };
}

function createEnv() {
  return {
    NEWAPI_BASE_URL: 'https://newapi.example.com',
    NEWAPI_DEFAULT_GROUP: 'auto',
    PLUGIN_KV: createKv(),
    LANDING_ASSET_BASE_URL: 'https://static.example.com/landing'
  };
}

function request(path, init = {}) {
  return new Request(`https://gateway.test${path}`, init);
}

async function readJson(response) {
  return response.json();
}

test('health exposes only auth broker capabilities', async () => {
  const response = await gateway.fetch(request('/health'), createEnv());
  const payload = await readJson(response);
  assert.equal(response.status, 200);
  assert.deepEqual(payload.capabilities, [
    'auth.login',
    'auth.desktop',
    'auth.session',
    'auth.logout'
  ]);
});

test('desktop auth start serves a bridge page that polls for a safe app callback', async () => {
  const response = await gateway.fetch(request('/auth/desktop/start?state=abc123456789012345678901234&redirect=jiucaihezi%3A%2F%2Fauth%2Fcallback'), createEnv());

  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type'), /text\/html/);
  const html = await response.text();
  assert.match(html, /韭菜盒子桌面登录/);
  assert.match(html, /https:\/\/gateway\.test\/sign-in/);
  assert.match(html, /https:\/\/gateway\.test\/auth\/desktop\/token\?state=abc123456789012345678901234/);
  assert.match(html, /redirect=jiucaihezi%3A%2F%2Fauth%2Fcallback/);
  assert.match(html, /授权桌面端登录/);
  assert.match(html, /localStorage\.getItem\('uid'\)/);
  assert.match(html, /'New-Api-User': uid/);
  assert.match(html, /fetch\('\/auth\/desktop\/authorize'/);
  assert.doesNotMatch(html, /fetch\('\/api\/token\/'/);
  assert.doesNotMatch(html, /jiucaihezi-studio-desktop/);
});

test('desktop auth callback creates a token using browser cookies and returns to app deep link', async () => {
  const env = createEnv();
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    assert.equal(init.headers.Cookie, 'session=newapi-browser-session');
    if (String(url).endsWith('/api/token/')) {
      return Response.json({ success: true, data: { id: 901 } });
    }
    if (String(url).endsWith('/api/token/901/key')) {
      return Response.json({ success: true, data: { key: 'sk-desktop-browser-key-1234567890' } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const response = await gateway.fetch(request('/auth/desktop/callback?state=abc123456789012345678901234&redirect=jiucaihezi%3A%2F%2Fauth%2Fcallback', {
      headers: { Cookie: 'session=newapi-browser-session' }
    }), env);

    assert.equal(response.status, 302);
    const location = new URL(response.headers.get('Location'));
    assert.equal(location.protocol, 'jiucaihezi:');
    assert.equal(location.hostname, 'auth');
    assert.equal(location.pathname, '/callback');
    assert.equal(location.searchParams.get('key'), 'sk-desktop-browser-key-1234567890');
    assert.equal(location.searchParams.get('state'), 'abc123456789012345678901234');
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('desktop auth token creates a token using browser cookies and returns a deep link payload', async () => {
  const env = createEnv();
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    assert.equal(init.headers.Cookie, 'session=newapi-browser-session');
    if (String(url).endsWith('/api/token/')) {
      return Response.json({ success: true, data: { id: 902 } });
    }
    if (String(url).endsWith('/api/token/902/key')) {
      return Response.json({ success: true, data: { key: 'sk-desktop-browser-key-abcdefghij' } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const response = await gateway.fetch(request('/auth/desktop/token?state=abc123456789012345678901234&redirect=jiucaihezi%3A%2F%2Fauth%2Fcallback', {
      headers: { Cookie: 'session=newapi-browser-session' }
    }), env);
    const payload = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.key, 'sk-desktop-browser-key-abcdefghij');
    assert.equal(payload.state, 'abc123456789012345678901234');
    const deepLink = new URL(payload.deep_link);
    assert.equal(deepLink.protocol, 'jiucaihezi:');
    assert.equal(deepLink.searchParams.get('key'), 'sk-desktop-browser-key-abcdefghij');
    assert.equal(deepLink.searchParams.get('state'), 'abc123456789012345678901234');
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('desktop auth authorize creates a token server-side using browser user header and cookies', async () => {
  const env = createEnv();
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    assert.equal(init.headers.Cookie, 'session=newapi-browser-session');
    assert.equal(init.headers['New-Api-User'], '42');
    assert.equal(init.headers['X-New-Api-User'], '42');
    if (String(url).endsWith('/api/token/')) {
      return Response.json({ success: true, data: { id: 903 } });
    }
    if (String(url).endsWith('/api/token/903/key')) {
      return Response.json({ success: true, data: { key: 'sk-desktop-browser-key-serverflow' } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const response = await gateway.fetch(request('/auth/desktop/authorize', {
      method: 'POST',
      headers: {
        Cookie: 'session=newapi-browser-session',
        'Content-Type': 'application/json',
        'New-Api-User': '42'
      },
      body: JSON.stringify({
        state: 'abc123456789012345678901234',
        redirect: 'jiucaihezi://auth/callback'
      })
    }), env);
    const payload = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.state, 'abc123456789012345678901234');
    const deepLink = new URL(payload.deep_link);
    assert.equal(deepLink.protocol, 'jiucaihezi:');
    assert.equal(deepLink.searchParams.get('key'), 'sk-desktop-browser-key-serverflow');
    assert.equal(deepLink.searchParams.get('state'), 'abc123456789012345678901234');
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('desktop auth start rejects unsafe redirects', async () => {
  const response = await gateway.fetch(request('/auth/desktop/start?state=abc123456789012345678901234&redirect=https%3A%2F%2Fevil.example%2Fcallback'), createEnv());
  const payload = await readJson(response);

  assert.equal(response.status, 400);
  assert.equal(payload.code, 'bad_request');
});

test('MCP OAuth callback returns the authorization code to the matching app deep link', async () => {
  const response = await gateway.fetch(request('/auth/mcp/github/callback?code=github-code&state=state-123'), createEnv());

  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('Location'));
  assert.equal(location.href, 'jiucaihezi://mcp/oauth/callback?server=github&code=github-code&state=state-123');
});

test('GitHub MCP token exchange keeps the OAuth App secret in the gateway', async () => {
  const env = {
    ...createEnv(),
    GITHUB_OAUTH_CLIENT_ID: 'github-client-id',
    GITHUB_OAUTH_CLIENT_SECRET: 'github-client-secret'
  };
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return Response.json({ access_token: 'github-access-token', token_type: 'bearer' });
  };

  try {
    const response = await gateway.fetch(request('/auth/mcp/github/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'github-code',
        code_verifier: 'pkce-verifier',
        redirect_uri: 'https://api.jiucaihezi.studio/auth/mcp/github/callback'
      })
    }), env);

    assert.equal(response.status, 200);
    const payload = await readJson(response);
    assert.deepEqual(payload, { access_token: 'github-access-token', token_type: 'bearer' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://github.com/login/oauth/access_token');
    const upstream = new URLSearchParams(calls[0].init.body);
    assert.equal(upstream.get('client_id'), 'github-client-id');
    assert.equal(upstream.get('client_secret'), 'github-client-secret');
    assert.equal(upstream.get('code'), 'github-code');
    assert.equal(upstream.get('code_verifier'), 'pkce-verifier');
    assert.equal(JSON.stringify(payload).includes('github-client-secret'), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('options keeps current App auth headers available', async () => {
  const response = await gateway.fetch(request('/auth/login', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://jiucaihezi.studio',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type,x-api-key'
    }
  }), createEnv());
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://jiucaihezi.studio');
  assert.match(response.headers.get('Access-Control-Allow-Headers'), /x-api-key/i);
});

test('auth login rejects invalid NewAPI credentials with JSON 401', async () => {
  const env = createEnv();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    success: false,
    message: '账号或密码不正确'
  }, { status: 401 });

  try {
    const response = await gateway.fetch(request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'wrong' })
    }), env);
    const payload = await readJson(response);

    assert.equal(response.status, 401);
    assert.equal(payload.success, false);
    assert.equal(payload.code, 'unauthorized');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('chat completions are no longer handled by the login gateway', async () => {
  const env = createEnv();
  const previousFetch = globalThis.fetch;
  let upstreamCalled = false;
  globalThis.fetch = async () => {
    upstreamCalled = true;
    return Response.json({ ok: true });
  };

  try {
    const response = await gateway.fetch(request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer sk-manual-web',
        'x-api-key': 'sk-manual-web'
      },
      body: JSON.stringify({ model: 'gpt-5.5', messages: [{ role: 'user', content: 'ping' }] })
    }), env);
    const payload = await readJson(response);

    assert.equal(response.status, 404);
    assert.equal(payload.code, 'not_found');
    assert.equal(upstreamCalled, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('landing assets redirect only approved download files to static hosting', async () => {
  const env = createEnv();
  const response = await gateway.fetch(request('/landing/%E9%9F%AD%E8%8F%9C%E7%9B%92%E5%AD%90_0.1.6_aarch64.dmg'), env);

  assert.equal(response.status, 302);
  assert.equal(
    response.headers.get('Location'),
    'https://static.example.com/landing/%E9%9F%AD%E8%8F%9C%E7%9B%92%E5%AD%90_0.1.6_aarch64.dmg'
  );

  const missing = await gateway.fetch(request('/landing/other.dmg'), env);
  assert.equal(missing.status, 404);
});

test('root landing page is served from static hosting', async () => {
  const env = createEnv();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://static.example.com/landing/index.html');
    assert.equal(init.method, 'GET');
    return new Response('<!doctype html><title>韭菜盒子 Studio</title>', {
      headers: { 'Content-Type': 'text/html' }
    });
  };

  try {
    const response = await gateway.fetch(request('/'), env);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('Content-Type'), /text\/html/);
    assert.match(html, /韭菜盒子 Studio/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('landing image and logo paths redirect to static hosting', async () => {
  const response = await gateway.fetch(request('/landing/logo.svg', { method: 'HEAD' }), createEnv());
  const screenshot = await gateway.fetch(request('/landing/IMG_5114.JPG'), createEnv());

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), 'https://static.example.com/landing/logo.svg');
  assert.equal(screenshot.status, 302);
  assert.equal(screenshot.headers.get('Location'), 'https://static.example.com/landing/IMG_5114.JPG');
});

test('browser tab icons redirect to the shared landing logo', async () => {
  const env = createEnv();
  const favicon = await gateway.fetch(request('/favicon.ico', { method: 'HEAD' }), env);
  const svg = await gateway.fetch(request('/favicon.svg'), env);
  const touchIcon = await gateway.fetch(request('/apple-touch-icon.png'), env);

  assert.equal(favicon.status, 302);
  assert.equal(favicon.headers.get('Location'), 'https://static.example.com/landing/favicon.svg');
  assert.equal(svg.status, 302);
  assert.equal(svg.headers.get('Location'), 'https://static.example.com/landing/favicon.svg');
  assert.equal(touchIcon.status, 302);
  assert.equal(touchIcon.headers.get('Location'), 'https://static.example.com/landing/apple-touch-icon.svg');
});

test('unrelated old gateway routes are removed', async () => {
  const env = createEnv();
  for (const path of ['/api/models', '/api/me/membership/subscribe', '/api/billing', '/api/creations/uploads', '/api/market']) {
    const response = await gateway.fetch(request(path, { method: 'POST' }), env);
    const payload = await readJson(response);
    assert.equal(response.status, 404);
    assert.equal(payload.code, 'not_found');
  }
});

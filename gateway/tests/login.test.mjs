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
    'auth.session',
    'auth.logout'
  ]);
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
  const response = await gateway.fetch(request('/landing/%E9%9F%AD%E8%8F%9C%E7%9B%92%E5%AD%90_0.1.0_aarch64.dmg'), env);

  assert.equal(response.status, 302);
  assert.equal(
    response.headers.get('Location'),
    'https://static.example.com/landing/%E9%9F%AD%E8%8F%9C%E7%9B%92%E5%AD%90_0.1.0_aarch64.dmg'
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

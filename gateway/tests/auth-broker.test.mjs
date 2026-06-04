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
    PLUGIN_KV: createKv()
  };
}

function request(path, init = {}) {
  return new Request(`https://gateway.test${path}`, init);
}

async function readJson(response) {
  return response.json();
}

test('auth login returns an ordinary NewAPI key and base_url', async () => {
  const env = createEnv();
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/api/user/login')) {
      return Response.json({
        success: true,
        data: { id: 88, username: 'alice', email: 'alice@example.com', access_token: 'user_access_88' }
      });
    }
    if (String(url).includes('/api/token/?')) {
      return Response.json({ success: true, data: [{ id: 701, name: '韭菜盒子工作台' }] });
    }
    if (String(url).endsWith('/api/token/701/key')) {
      return Response.json({ success: true, data: { key: 'sk-existing-workbench-key' } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const response = await gateway.fetch(request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'tauri://localhost' },
      body: JSON.stringify({ username: 'alice', password: 'secret' })
    }), env);
    const payload = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.api_key, 'sk-existing-workbench-key');
    assert.equal(payload.base_url, 'https://api.jiucaihezi.studio/v1');
    assert.equal(payload.username, 'alice');
    assert.equal(payload.sessionToken, undefined);
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.equal(calls.some((call) => call.url.endsWith('/api/token/701/key')), true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('auth login creates and reads a workbench key when none exists', async () => {
  const env = createEnv();
  const previousFetch = globalThis.fetch;
  const calls = [];
  let listedAfterCreate = false;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/api/user/login')) {
      return Response.json({ success: true, data: { id: 88, username: 'alice', access_token: 'user_access_88' } });
    }
    if (String(url).includes('/api/token/?')) {
      if (!listedAfterCreate) return Response.json({ success: true, data: [] });
      return Response.json({ success: true, data: [{ id: 702, name: '韭菜盒子工作台' }] });
    }
    if (String(url).endsWith('/api/token/')) {
      const body = JSON.parse(String(init.body || '{}'));
      assert.equal(body.name, '韭菜盒子工作台');
      assert.equal(body.group, 'auto');
      listedAfterCreate = true;
      return Response.json({ success: true, data: { id: 702 } });
    }
    if (String(url).endsWith('/api/token/702/key')) {
      return Response.json({ success: true, data: { key: 'sk-created-workbench-key' } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const response = await gateway.fetch(request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'secret' })
    }), env);
    const payload = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(payload.api_key, 'sk-created-workbench-key');
    assert.equal(calls.some((call) => call.url.endsWith('/api/token/')), true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('auth login failure returns 401 JSON', async () => {
  const env = createEnv();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: false, message: '账号或密码不正确' }, { status: 401 });

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

test('chat completions are not handled by the Auth Broker', async () => {
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
    assert.equal(payload.success, false);
    assert.equal(upstreamCalled, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

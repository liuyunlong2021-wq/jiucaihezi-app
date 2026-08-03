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

test('auth login returns an ordinary NewAPI key plus a dedicated sync session', async () => {
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
      return Response.json({ success: true, data: [{ id: 701, name: '韭菜盒子工作台', group: 'auto', status: 1 }] });
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
    assert.match(payload.sync_session, /^sess_/);
    assert.match(response.headers.get('Set-Cookie'), /^jc_session=sess_/);
    assert.equal(calls.some((call) => call.url.endsWith('/api/token/701/key')), true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('account deletion requires the sync session and removes only its account data', async () => {
  const env = createEnv();
  const syncCalls = [];
  env.SYNC_DB = {
    prepare(sql) {
      return {
        bind(...values) {
          return { async run() { syncCalls.push({ sql, values }); } };
        }
      };
    }
  };
  await env.PLUGIN_KV.put('user:user_web_88', JSON.stringify({
    id: 'user_web_88',
    username: 'alice',
    email: 'alice@example.com',
    authProvider: 'web',
    legacyUserId: '88',
    legacyAccessToken: 'user_access_88',
    legacySessionCookie: 'session=newapi-session-88'
  }));
  await env.PLUGIN_KV.put('user:username:alice', 'user_web_88');
  await env.PLUGIN_KV.put('user:email:alice@example.com', 'user_web_88');
  await env.PLUGIN_KV.put('session:sess_delete_alice', JSON.stringify({
    id: 'sess_delete_alice',
    userId: 'user_web_88',
    expiresAt: '2099-01-01T00:00:00.000Z'
  }));
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), 'https://newapi.example.com/api/user/self');
    assert.equal(init.method, 'DELETE');
    assert.equal(init.headers.Cookie, 'session=newapi-session-88');
    return Response.json({ success: true });
  };

  try {
    const response = await gateway.fetch(request('/auth/account', {
      method: 'DELETE',
      headers: { 'X-JC-Session': 'sess_delete_alice' }
    }), env);
    const payload = await readJson(response);

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(syncCalls.length, 1);
    assert.match(syncCalls[0].sql, /DELETE FROM projects WHERE user_id/);
    assert.deepEqual(syncCalls[0].values, ['user_web_88']);
    assert.equal(await env.PLUGIN_KV.get('user:user_web_88'), null);
    assert.equal(await env.PLUGIN_KV.get('user:username:alice'), null);
    assert.equal(await env.PLUGIN_KV.get('user:email:alice@example.com'), null);
    assert.equal(await env.PLUGIN_KV.get('session:sess_delete_alice'), null);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('account deletion rejects requests without a sync session', async () => {
  const env = createEnv();
  const response = await gateway.fetch(request('/auth/account', { method: 'DELETE' }), env);
  assert.equal(response.status, 401);
  assert.equal((await readJson(response)).success, false);
});

test('auth login ignores a same-name token outside the auto group', async () => {
  const env = createEnv();
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/api/user/login')) {
      return Response.json({ success: true, data: { id: 88, username: 'alice', access_token: 'user_access_88' } });
    }
    if (String(url).includes('/api/token/?')) {
      return Response.json({
        success: true,
        data: [
          { id: 700, name: '韭菜盒子工作台', group: 'site_member', status: 1 },
          { id: 701, name: '韭菜盒子工作台', group: 'auto', status: 1 }
        ]
      });
    }
    if (String(url).endsWith('/api/token/701/key')) {
      return Response.json({ success: true, data: { key: 'sk-auto-workbench-key' } });
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
    assert.equal(payload.api_key, 'sk-auto-workbench-key');
    assert.equal(calls.some((call) => call.url.endsWith('/api/token/700/key')), false);
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
      return Response.json({ success: true, data: [{ id: 702, name: '韭菜盒子工作台', group: 'auto', status: 1 }] });
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

import assert from 'node:assert/strict';
import test from 'node:test';
import gateway from '../src/index.js';
import { validateSyncPath } from '../src/sync-service.js';

function createKv() {
  const map = new Map();
  return {
    map,
    async put(key, value) { map.set(key, value); },
    async get(key) { return map.get(key) || null; },
    async delete(key) { map.delete(key); },
  };
}

function createDb(handler = () => null) {
  const calls = [];
  const batches = [];
  return {
    calls,
    batches,
    prepare(sql) {
      return {
        sql,
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() { calls.push({ method: 'first', sql, args: this.args }); return handler('first', sql, this.args); },
        async all() { calls.push({ method: 'all', sql, args: this.args }); return handler('all', sql, this.args) || { results: [] }; },
        async run() { calls.push({ method: 'run', sql, args: this.args }); return handler('run', sql, this.args) || { success: true }; },
      };
    },
    async batch(statements) {
      batches.push(statements.map((statement) => ({ sql: statement.sql, args: statement.args })));
      const result = handler('batch', '', statements);
      if (result instanceof Error) throw result;
      return statements.map(() => ({ success: true }));
    },
  };
}

async function authenticatedEnv(db, userId = 'user_web_42', sessionId = 'sess_sync_alice') {
  const kv = createKv();
  await kv.put(`session:${sessionId}`, JSON.stringify({
    id: sessionId,
    userId,
    expiresAt: '2999-01-01T00:00:00.000Z',
  }));
  await kv.put(`user:${userId}`, JSON.stringify({ id: userId, username: 'alice', authProvider: 'web' }));
  return { PLUGIN_KV: kv, SYNC_DB: db };
}

function request(path, init = {}, sessionId = 'sess_sync_alice') {
  const headers = new Headers(init.headers);
  if (sessionId) headers.set('X-JC-Session', sessionId);
  return new Request(`https://gateway.test${path}`, { ...init, headers });
}

test('sync endpoints reject requests without a logged-in account', async () => {
  const response = await gateway.fetch(request('/sync/projects', {}, ''), { PLUGIN_KV: createKv(), SYNC_DB: createDb() });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'unauthorized');
});

test('project listing derives account ownership from the session', async () => {
  const db = createDb((method, sql) => method === 'all' && sql.includes('FROM projects')
    ? { results: [{ id: 'project_12345678', name: '记忆空间', created_at: 1, updated_at: 2, deleted_at: null }] }
    : null);
  const env = await authenticatedEnv(db);
  const response = await gateway.fetch(request('/sync/projects'), env);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.projects[0].id, 'project_12345678');
  const query = db.calls.find((call) => call.method === 'all' && call.sql.includes('FROM projects'));
  assert.equal(query.args[0], 'user_web_42');
  assert.match(query.sql, /user_id = \?1/);
});

test('another account cannot discover or read a project', async () => {
  const db = createDb((method, sql, args) => {
    if (method === 'first' && sql.includes('FROM projects')) {
      assert.deepEqual(args, ['project_12345678', 'user_web_42']);
      return null;
    }
    throw new Error('file query must not run without project ownership');
  });
  const env = await authenticatedEnv(db);
  const response = await gateway.fetch(request('/sync/projects/project_12345678/files?cursor=0'), env);
  const payload = await response.json();

  assert.equal(response.status, 404);
  assert.equal(payload.code, 'not_found');
});

test('project creation ignores client user_id and stores the logged-in owner', async () => {
  const db = createDb();
  const env = await authenticatedEnv(db);
  const response = await gateway.fetch(request('/sync/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '我的记忆', user_id: 'user_web_attacker' }),
  }), env);
  const payload = await response.json();

  assert.equal(response.status, 201);
  assert.match(payload.project.id, /^project_/);
  const insert = db.calls.find((call) => call.method === 'run' && call.sql.includes('INSERT INTO projects'));
  assert.equal(insert.args[1], 'user_web_42');
  assert.equal(insert.args.includes('user_web_attacker'), false);
});

test('fresh file push writes the file, mutation and project timestamp in one D1 batch', async () => {
  const db = createDb((method, sql) => {
    if (method === 'first' && sql.includes('FROM projects')) return { id: 'project_12345678', name: '记忆空间', created_at: 1, updated_at: 1, deleted_at: null };
    if (method === 'first' && sql.includes('FROM sync_mutations')) return null;
    if (method === 'first' && sql.includes('FROM text_files')) return null;
    return null;
  });
  const env = await authenticatedEnv(db);
  const response = await gateway.fetch(request('/sync/projects/project_12345678/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_id: 'device_mac_1234',
      mutations: [{
        mutation_id: 'mutation_12345678',
        path: '.raw/对话记录/第一章.md',
        operation: 'upsert',
        expected_revision: 0,
        content: '# 第一章',
      }],
    }),
  }), env);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload.results.map(({ revision, duplicate }) => ({ revision, duplicate })), [{ revision: 1, duplicate: false }]);
  assert.equal(db.batches.length, 1);
  assert.equal(db.batches[0].length, 3);
  assert.match(db.batches[0][0].sql, /INSERT INTO text_files/);
  assert.match(db.batches[0][1].sql, /INSERT INTO sync_mutations/);
  assert.match(db.batches[0][2].sql, /UPDATE projects/);
});

test('repeating the same mutation is idempotent and performs no second write', async () => {
  const db = createDb((method, sql) => {
    if (method === 'first' && sql.includes('FROM projects')) return { id: 'project_12345678', name: '记忆空间', created_at: 1, updated_at: 2, deleted_at: null };
    if (method === 'first' && sql.includes('FROM sync_mutations')) {
      return { mutation_id: 'mutation_12345678', device_id: 'device_mac_1234', path: 'wiki/人物.md', revision: 2, operation: 'upsert' };
    }
    return null;
  });
  const env = await authenticatedEnv(db);
  const response = await gateway.fetch(request('/sync/projects/project_12345678/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_id: 'device_mac_1234',
      mutations: [{
        mutation_id: 'mutation_12345678',
        path: 'wiki/人物.md',
        operation: 'upsert',
        expected_revision: 1,
        content: '# 人物',
      }],
    }),
  }), env);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.results[0].revision, 2);
  assert.equal(payload.results[0].duplicate, true);
  assert.equal(db.batches.length, 0);
});

test('revision conflict returns 409 before writing', async () => {
  const db = createDb((method, sql) => {
    if (method === 'first' && sql.includes('FROM projects')) return { id: 'project_12345678', name: '记忆空间', created_at: 1, updated_at: 2, deleted_at: null };
    if (method === 'first' && sql.includes('FROM sync_mutations')) return null;
    if (method === 'first' && sql.includes('FROM text_files')) return { revision: 3 };
    return null;
  });
  const env = await authenticatedEnv(db);
  const response = await gateway.fetch(request('/sync/projects/project_12345678/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_id: 'device_mac_1234',
      mutations: [{ mutation_id: 'mutation_87654321', path: 'wiki/人物.md', operation: 'delete', expected_revision: 2 }],
    }),
  }), env);

  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'sync_conflict');
  assert.equal(db.batches.length, 0);
});

test('database revision guard is translated to a 409 conflict', async () => {
  const db = createDb((method, sql) => {
    if (method === 'first' && sql.includes('FROM projects')) return { id: 'project_12345678', name: '记忆空间', created_at: 1, updated_at: 2, deleted_at: null };
    if (method === 'first' && sql.includes('FROM sync_mutations')) return null;
    if (method === 'first' && sql.includes('FROM text_files')) return { revision: 2 };
    if (method === 'batch') return new Error('UNIQUE constraint failed: sync_mutations.project_id, sync_mutations.path, sync_mutations.revision');
    return null;
  });
  const env = await authenticatedEnv(db);
  const response = await gateway.fetch(request('/sync/projects/project_12345678/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_id: 'device_mac_1234',
      mutations: [{ mutation_id: 'mutation_99999999', path: 'wiki/人物.md', operation: 'delete', expected_revision: 2 }],
    }),
  }), env);

  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'sync_conflict');
});

test('incremental pull returns the latest text state and tombstones', async () => {
  const db = createDb((method, sql) => {
    if (method === 'first' && sql.includes('FROM projects')) return { id: 'project_12345678', name: '记忆空间', created_at: 1, updated_at: 4, deleted_at: null };
    if (method === 'all' && sql.includes('FROM sync_mutations m')) return { results: [
      { seq: 4, path: 'wiki/人物.md', content: '# 人物', content_hash: 'abc', revision: 2, updated_at: 4, deleted_at: null },
      { seq: 5, path: 'wiki/旧稿.md', content: '# 旧稿', content_hash: 'def', revision: 3, updated_at: 5, deleted_at: 5 },
    ] };
    if (method === 'first' && sql.includes('SELECT 1 AS present')) return null;
    return null;
  });
  const env = await authenticatedEnv(db);
  const response = await gateway.fetch(request('/sync/projects/project_12345678/files?cursor=3'), env);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.cursor, 5);
  assert.equal(payload.has_more, false);
  assert.equal(payload.files[0].content, '# 人物');
  assert.equal(payload.files[1].content, null);
});

test('sync path validation rejects traversal, media and credential files', () => {
  assert.equal(validateSyncPath('.raw/对话记录/今天.md'), '.raw/对话记录/今天.md');
  for (const path of ['../secret.md', '/absolute.md', '.raw/.sync/state.json', 'jc-media/images/a.txt', '.env', 'credentials.json', '.claude/skills/demo.md', 'wiki/image.png']) {
    assert.throws(() => validateSyncPath(path));
  }
});

test('explicit desktop sync session wins over an ordinary API key header', async () => {
  const db = createDb((method, sql) => method === 'all' && sql.includes('FROM projects') ? { results: [] } : null);
  const env = await authenticatedEnv(db);
  const response = await gateway.fetch(request('/sync/projects', {
    headers: { Authorization: 'Bearer sk-ordinary-model-key' },
  }), env);
  assert.equal(response.status, 200);
});

test('web sync cookie wins over an ordinary API key header', async () => {
  const db = createDb((method, sql) => method === 'all' && sql.includes('FROM projects') ? { results: [] } : null);
  const env = await authenticatedEnv(db);
  const response = await gateway.fetch(new Request('https://gateway.test/sync/projects', {
    headers: {
      Authorization: 'Bearer sk-ordinary-model-key',
      Cookie: 'jc_session=sess_sync_alice',
    },
  }), env);
  assert.equal(response.status, 200);
});

test('project delete and restore keep the owner condition on every write', async () => {
  const db = createDb((method, sql) => method === 'first' && sql.includes('FROM projects')
    ? { id: 'project_12345678', name: '记忆空间', created_at: 1, updated_at: 2, deleted_at: null }
    : null);
  const env = await authenticatedEnv(db);

  const deleted = await gateway.fetch(request('/sync/projects/project_12345678/delete', { method: 'POST' }), env);
  const restored = await gateway.fetch(request('/sync/projects/project_12345678/restore', { method: 'POST' }), env);
  assert.equal(deleted.status, 200);
  assert.equal(restored.status, 200);
  const updates = db.calls.filter((call) => call.method === 'run' && call.sql.includes('UPDATE projects'));
  assert.equal(updates.length, 2);
  assert.equal(updates.every((call) => call.args[1] === 'user_web_42'), true);
  assert.equal(updates[0].args[3] != null, true);
  assert.equal(updates[1].args[3], null);
});

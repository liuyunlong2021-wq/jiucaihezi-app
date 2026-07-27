import { GatewayError, badRequest } from './errors.js';
import { jsonResponse, readJson, routeMethod } from './http.js';
import { requireWebUser } from './auth-service.js';

const MAX_PROJECT_NAME_BYTES = 240;
const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_MUTATIONS = 100;
const MAX_PULL_FILES = 200;
const TEXT_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'json', 'yaml', 'yml', 'csv', 'tsv', 'srt', 'vtt']);
const BLOCKED_PATH_PARTS = new Set(['.sync', '.git', '.ssh', '.aws', '.config', '.claude', '.codex', '.agents', 'node_modules', 'skills', 'jc-media']);
const BLOCKED_FILE_NAMES = new Set(['credentials.json', 'secrets.json', 'secrets.yaml', 'secrets.yml', 'api-keys.json', 'mcp.json']);

function syncError(message, status, code) {
  return new GatewayError(message, status, code);
}

function requireSyncDb(env) {
  if (!env || !env.SYNC_DB || typeof env.SYNC_DB.prepare !== 'function') {
    throw syncError('文字同步服务尚未配置', 503, 'sync_unavailable');
  }
  return env.SYNC_DB;
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function requiredId(value, label) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(text)) throw badRequest(`${label}无效`);
  return text;
}

function projectName(value) {
  const text = String(value || '').trim();
  if (!text || byteLength(text) > MAX_PROJECT_NAME_BYTES) throw badRequest('项目名称无效');
  return text;
}

export function validateSyncPath(value) {
  const path = String(value || '');
  if (!path || path.length > 512 || path !== path.trim() || path.includes('\\') || path.includes('\0') || path.startsWith('/')) {
    throw badRequest('同步文件路径无效');
  }
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) throw badRequest('同步文件路径无效');
  const lowerParts = parts.map((part) => part.toLowerCase());
  const fileName = lowerParts.at(-1);
  if (lowerParts.some((part) => BLOCKED_PATH_PARTS.has(part) || part === '.env' || part.startsWith('.env.')) || BLOCKED_FILE_NAMES.has(fileName)) {
    throw badRequest('该路径不允许同步');
  }
  const extension = fileName.split('.').pop();
  if (!TEXT_EXTENSIONS.has(extension)) throw badRequest('只允许同步安全文本文件');
  return path;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function rows(result) {
  return Array.isArray(result && result.results) ? result.results : [];
}

function publicProject(row) {
  return {
    id: String(row.id),
    name: String(row.name),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    deleted_at: row.deleted_at == null ? null : Number(row.deleted_at),
  };
}

async function ownedProject(db, projectId, userId) {
  const row = await db.prepare(
    'SELECT id, name, created_at, updated_at, deleted_at FROM projects WHERE id = ?1 AND user_id = ?2'
  ).bind(projectId, userId).first();
  if (!row) throw syncError('同步项目不存在', 404, 'not_found');
  return row;
}

async function listProjects(request, db, userId) {
  const includeDeleted = new URL(request.url).searchParams.get('include_deleted') === '1';
  const result = await db.prepare(
    `SELECT id, name, created_at, updated_at, deleted_at
     FROM projects
     WHERE user_id = ?1 AND (?2 = 1 OR deleted_at IS NULL)
     ORDER BY updated_at DESC`
  ).bind(userId, includeDeleted ? 1 : 0).all();
  return jsonResponse({ success: true, projects: rows(result).map(publicProject) }, 200, request);
}

async function createProject(request, db, userId) {
  const body = await readJson(request);
  const id = `project_${crypto.randomUUID().replace(/-/g, '')}`;
  const name = projectName(body.name);
  const now = Date.now();
  await db.prepare(
    'INSERT INTO projects (id, user_id, name, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?4, NULL)'
  ).bind(id, userId, name, now).run();
  return jsonResponse({ success: true, project: { id, name, created_at: now, updated_at: now, deleted_at: null } }, 201, request);
}

function readCursor(request) {
  const raw = new URL(request.url).searchParams.get('cursor') || '0';
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw badRequest('同步游标无效');
  return Number(raw);
}

async function pullFiles(request, db, projectId, userId) {
  await ownedProject(db, projectId, userId);
  const cursor = readCursor(request);
  const count = await db.prepare(
    'SELECT COUNT(DISTINCT path) AS total FROM sync_mutations WHERE project_id = ?1 AND seq > ?2'
  ).bind(projectId, cursor).first();
  const result = await db.prepare(
    `SELECT m.seq, f.path, f.content, f.content_hash, f.revision, f.updated_at, f.deleted_at
     FROM sync_mutations m
     JOIN text_files f ON f.project_id = m.project_id AND f.path = m.path
     WHERE m.project_id = ?1 AND m.seq > ?2
       AND m.seq = (
         SELECT MAX(latest.seq) FROM sync_mutations latest
         WHERE latest.project_id = m.project_id AND latest.path = m.path AND latest.seq > ?2
       )
     ORDER BY m.seq ASC
     LIMIT ?3`
  ).bind(projectId, cursor, MAX_PULL_FILES).all();
  const pulled = rows(result);
  const nextCursor = pulled.length ? Number(pulled.at(-1).seq) : cursor;
  const more = await db.prepare(
    'SELECT 1 AS present FROM sync_mutations WHERE project_id = ?1 AND seq > ?2 LIMIT 1'
  ).bind(projectId, nextCursor).first();
  return jsonResponse({
    success: true,
    cursor: nextCursor,
    has_more: !!more,
    total: Number(count?.total || 0),
    files: pulled.map((row) => ({
      path: String(row.path),
      content: row.deleted_at == null ? String(row.content || '') : null,
      content_hash: String(row.content_hash),
      revision: Number(row.revision),
      updated_at: Number(row.updated_at),
      deleted_at: row.deleted_at == null ? null : Number(row.deleted_at),
    })),
  }, 200, request);
}

async function normalizeMutation(input, deviceId) {
  const mutationId = requiredId(input && input.mutation_id, 'mutation_id');
  const path = validateSyncPath(input && input.path);
  const operation = String(input && input.operation || '');
  if (operation !== 'upsert' && operation !== 'delete') throw badRequest('同步操作无效');
  const expectedRevision = Number(input && input.expected_revision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw badRequest('expected_revision 无效');
  const content = operation === 'upsert' ? String(input?.content ?? '') : '';
  if (byteLength(content) > MAX_TEXT_FILE_BYTES) throw badRequest('同步文件不能超过 2MB');
  const contentHash = await sha256(content);
  const suppliedHash = String(input && input.content_hash || '').toLowerCase();
  if (suppliedHash && suppliedHash !== contentHash) throw badRequest('content_hash 与文件内容不一致');
  return { mutationId, deviceId, path, operation, expectedRevision, content, contentHash };
}

async function pushFiles(request, db, projectId, userId) {
  const body = await readJson(request);
  const deviceId = requiredId(body.device_id, 'device_id');
  if (!Array.isArray(body.mutations) || !body.mutations.length || body.mutations.length > MAX_MUTATIONS) {
    throw badRequest('mutations 必须包含 1-100 项');
  }
  const mutations = await Promise.all(body.mutations.map((item) => normalizeMutation(item, deviceId)));
  if (new Set(mutations.map((item) => item.mutationId)).size !== mutations.length) throw badRequest('mutation_id 不能重复');
  if (new Set(mutations.map((item) => item.path)).size !== mutations.length) throw badRequest('同一批次不能重复修改同一路径');
  const project = await ownedProject(db, projectId, userId);
  if (project.deleted_at != null) throw syncError('同步项目已删除', 409, 'sync_conflict');

  const writes = [];
  const results = [];
  const now = Date.now();
  for (const mutation of mutations) {
    const duplicate = await db.prepare(
      `SELECT mutation_id, device_id, path, revision, operation
       FROM sync_mutations WHERE mutation_id = ?1`
    ).bind(mutation.mutationId).first();
    if (duplicate) {
      const matches = duplicate.device_id === mutation.deviceId
        && duplicate.path === mutation.path
        && duplicate.operation === mutation.operation
        && Number(duplicate.revision) === mutation.expectedRevision + 1;
      if (!matches) throw syncError('mutation_id 已被其他变更使用', 409, 'sync_conflict');
      results.push({ mutation_id: mutation.mutationId, path: mutation.path, revision: Number(duplicate.revision), duplicate: true });
      continue;
    }

    const current = await db.prepare(
      'SELECT revision FROM text_files WHERE project_id = ?1 AND path = ?2'
    ).bind(projectId, mutation.path).first();
    const currentRevision = current ? Number(current.revision) : 0;
    if (currentRevision !== mutation.expectedRevision) {
      throw syncError(`文件版本冲突：${mutation.path}`, 409, 'sync_conflict');
    }
    const revision = currentRevision + 1;
    if (mutation.operation === 'upsert') {
      writes.push(db.prepare(
        `INSERT INTO text_files (project_id, path, content, content_hash, revision, updated_at, deleted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)
         ON CONFLICT(project_id, path) DO UPDATE SET
           content = excluded.content,
           content_hash = excluded.content_hash,
           revision = excluded.revision,
           updated_at = excluded.updated_at,
           deleted_at = NULL`
      ).bind(projectId, mutation.path, mutation.content, mutation.contentHash, revision, now));
    } else if (current) {
      writes.push(db.prepare(
        'UPDATE text_files SET revision = ?3, updated_at = ?4, deleted_at = ?4 WHERE project_id = ?1 AND path = ?2'
      ).bind(projectId, mutation.path, revision, now));
    } else {
      writes.push(db.prepare(
        `INSERT INTO text_files (project_id, path, content, content_hash, revision, updated_at, deleted_at)
         VALUES (?1, ?2, '', ?3, ?4, ?5, ?5)`
      ).bind(projectId, mutation.path, mutation.contentHash, revision, now));
    }
    writes.push(db.prepare(
      `INSERT INTO sync_mutations (mutation_id, project_id, device_id, path, revision, operation, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
    ).bind(mutation.mutationId, projectId, deviceId, mutation.path, revision, mutation.operation, now));
    results.push({ mutation_id: mutation.mutationId, path: mutation.path, revision, duplicate: false });
  }
  if (writes.length) {
    writes.push(db.prepare('UPDATE projects SET updated_at = ?3 WHERE id = ?1 AND user_id = ?2').bind(projectId, userId, now));
    try {
      await db.batch(writes);
    } catch (error) {
      if (/UNIQUE constraint failed|idx_sync_mutations_project_path_revision/i.test(String(error && error.message || error))) {
        throw syncError('文件版本冲突，请拉取最新版本后重试', 409, 'sync_conflict');
      }
      throw error;
    }
  }
  return jsonResponse({ success: true, results }, 200, request);
}

async function setProjectDeleted(request, db, projectId, userId, deleted) {
  const project = await ownedProject(db, projectId, userId);
  const now = Date.now();
  await db.prepare(
    'UPDATE projects SET updated_at = ?3, deleted_at = ?4 WHERE id = ?1 AND user_id = ?2'
  ).bind(projectId, userId, now, deleted ? now : null).run();
  return jsonResponse({
    success: true,
    project: publicProject({ ...project, updated_at: now, deleted_at: deleted ? now : null }),
  }, 200, request);
}

export async function handleSync(request, env) {
  const user = await requireWebUser(request, env);
  const userId = String(user.id);
  const db = requireSyncDb(env);
  const pathname = new URL(request.url).pathname;

  if (pathname === '/sync/projects') {
    return routeMethod(request, {
      GET: () => listProjects(request, db, userId),
      POST: () => createProject(request, db, userId),
    });
  }
  const files = pathname.match(/^\/sync\/projects\/([A-Za-z0-9_-]{8,128})\/files$/);
  if (files) {
    const projectId = requiredId(files[1], 'project_id');
    return routeMethod(request, {
      GET: () => pullFiles(request, db, projectId, userId),
      POST: () => pushFiles(request, db, projectId, userId),
    });
  }
  const action = pathname.match(/^\/sync\/projects\/([A-Za-z0-9_-]{8,128})\/(delete|restore)$/);
  if (action) {
    const projectId = requiredId(action[1], 'project_id');
    return routeMethod(request, {
      POST: () => setProjectDeleted(request, db, projectId, userId, action[2] === 'delete'),
    });
  }
  throw syncError('接口不存在', 404, 'not_found');
}

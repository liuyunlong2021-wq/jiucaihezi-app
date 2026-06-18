/**
 * creation-models — creation model availability endpoint
 *
 * GET /api/creation/models
 * Returns a normalized model availability list derived from NewAPI channels.
 * This service is intentionally read-only and uses no upstream provider keys.
 */

import http from 'node:http'
import { execFileSync } from 'node:child_process'

const HOST = process.env.CREATION_MODELS_HOST || '127.0.0.1'
const PORT = Number(process.env.CREATION_MODELS_PORT || '8790')
const PSQL_PASSWORD = process.env.NEWAPI_PSQL_PASSWORD || ''
const PSQL_USER = process.env.NEWAPI_PSQL_USER || 'newapi'
const PSQL_DB = process.env.NEWAPI_PSQL_DB || 'new-api'

export const CREATION_MODEL_ROUTES = [
  { id: 'gpt-image-2', aliases: ['gpt-image-2'] },
  { id: '普gpt-image-2', aliases: ['gpt-image-2'] },
  { id: '普gemini-3-pro-image-preview', aliases: ['gemini-3-pro-image-preview'] },
  { id: '普gemini-3.1-flash-image-preview', aliases: ['gemini-3.1-flash-image-preview'] },
  { id: 'nano-banana-4k', aliases: ['nano-banana-4k', 'nano-banana-pro-4k'] },
  { id: 'rh-pro-image', aliases: ['rh-pro-image'] },
  { id: 'rh-image-v2', aliases: ['rh-image-v2'] },
  { id: 'rh-gpt2-image', aliases: ['rh-gpt2-image'] },
  { id: 'rh-gpt2-text', aliases: ['rh-gpt2-text'] },
  { id: 'z-image-turbo', aliases: ['z-image-turbo'] },
  { id: 'rh-video-v31-fast', aliases: ['rh-video-v31-fast'] },
  { id: 'rh-seedance2-text-video', aliases: ['rh-seedance2-text-video'] },
  { id: 'rh-seedance2-image-video', aliases: ['rh-seedance2-image-video'] },
  { id: 'rh-seedance2-multimodal-video', aliases: ['rh-seedance2-multimodal-video'] },
  { id: '普seedance2.0', aliases: ['seedance-2.0'] },
  { id: '普seedance2.0-fast', aliases: ['seedance-2.0-fast'] },
  { id: 'grok-video-3', aliases: ['rh-grok-text-video', 'rh-grok-image-video'] },
  { id: 'rh-grok-text-video', aliases: ['rh-grok-text-video'] },
  { id: 'rh-grok-image-video', aliases: ['rh-grok-image-video'] },
  { id: 'rh-aiapp-fast-digital-human', aliases: ['rh-aiapp-fast-digital-human'] },
  { id: 'rh-suno-v55-single', aliases: ['rh-suno-v55-single'] },
  { id: 'rh-suno-v55-custom', aliases: ['rh-suno-v55-custom'] },
  { id: 'rh-suno-lyrics', aliases: ['rh-suno-lyrics'] },
]

export function parseChannelRows(text) {
  return String(text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [id, name, status, baseUrl, models] = line.split('\t')
      return {
        id: Number(id),
        name: name || '',
        status: Number(status),
        baseUrl: baseUrl || '',
        models: String(models || '')
          .split(',')
          .map(model => model.trim())
          .filter(Boolean),
      }
    })
    .filter(channel => Number.isFinite(channel.id))
}

export function buildCreationModelAvailability(channels, now = new Date()) {
  return CREATION_MODEL_ROUTES.map(route => {
    const matches = channels.filter(channel =>
      channel.models.some(model => route.aliases.includes(model))
    )

    if (!matches.length) {
      return {
        id: route.id,
        status: 'disabled',
        reason: 'NewAPI 未配置该模型渠道',
      }
    }

    const enabled = matches.find(channel => channel.status === 1)
    if (enabled) {
      return {
        id: route.id,
        status: 'enabled',
        lastSuccessAt: now.toISOString(),
      }
    }

    const autoDisabled = matches.find(channel => channel.status === 3)
    return {
      id: route.id,
      status: 'disabled',
      reason: autoDisabled ? 'NewAPI 渠道已自动禁用' : 'NewAPI 渠道未启用',
    }
  })
}

function queryChannels() {
  if (!PSQL_PASSWORD) {
    throw new Error('NEWAPI_PSQL_PASSWORD is not configured')
  }

  const postgresContainer = execFileSync('docker', ['ps', '-q', '-f', 'name=postgres'], {
    encoding: 'utf8',
  }).split('\n').map(value => value.trim()).find(Boolean)

  if (!postgresContainer) throw new Error('Postgres container not found')

  const sql = 'SELECT id,name,status,base_url,models FROM channels ORDER BY id;'
  const output = execFileSync('docker', [
    'exec',
    postgresContainer,
    'psql',
    '-h',
    'localhost',
    '-U',
    PSQL_USER,
    '-d',
    PSQL_DB,
    '-At',
    '-F',
    '\t',
    '-c',
    sql,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PGPASSWORD: PSQL_PASSWORD,
    },
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  })

  return parseChannelRows(output)
}

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': 'https://jiucaihezi.studio',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-api-key',
  })
  res.end(JSON.stringify(body))
}

export function sanitizeErrorForLog(error) {
  const raw = error instanceof Error
    ? `${error.message}\n${error.stack || ''}`
    : typeof error === 'object'
      ? JSON.stringify(error)
      : String(error || '')
  return raw
    .replace(/PGPASSWORD=([^\s'"\\]+)/g, 'PGPASSWORD=***')
    .replace(/PGPASSWORD=['"][^'"]+['"]/g, 'PGPASSWORD=***')
}

export function publicErrorPayload(error, log = console.error) {
  if (error) log('[creation-models] availability query failed:', sanitizeErrorForLog(error))
  return {
    success: false,
    error: {
      message: '模型可用性服务暂不可用',
    },
  }
}

export function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

    if (req.method === 'OPTIONS') {
      return json(res, 204, {})
    }

    if (req.method !== 'GET' || url.pathname !== '/api/creation/models') {
      return json(res, 404, { error: { message: 'Not found' } })
    }

    try {
      const channels = queryChannels()
      return json(res, 200, {
        success: true,
        data: {
          models: buildCreationModelAvailability(channels),
        },
      })
    } catch (e) {
      return json(res, 500, publicErrorPayload(e))
    }
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createServer().listen(PORT, HOST, () => {
    console.log(`[creation-models] listening on http://${HOST}:${PORT}`)
  })
}

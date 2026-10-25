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

// 源流公开模型名 → 上游 model ID；与 newapi-plugins/yuanliu-model-mapping.json 一致。
const YUANLIU_MODEL_MAPPING = {
  'Seedance 2.5(HD)': 'yl_seedance-2-5_6caffaca7390',
  'Seedance 2.5 480p (QN-10)': 'yl_pp_sz_sd25_30010',
  'Seedance2.0(HD)': 'yl_seedance-2-0_ba0687ff09f2',
  'Seedance2.5full (LJ-04)': 'yl_g7zy_seedance_v2_5_full_s',
  'Wan3.0视频Prime官渠稳定(WP-01)': 'yl_fy_wan3_0_video_prime',
  'Wan3.0官渠(WP-02)': 'yl_fy_wan3_0_video',
}

export const CREATION_MODEL_ROUTES = [
  { id: 'newapi/yihong/yh-minimax H3', aliases: ['yh-minimax H3'] },
  { id: 'newapi/yihong/yh-seedance2.5 Ultra', aliases: ['yh-seedance2.5 Ultra'] },
  { id: 'newapi/yihong/yh-wan3.0-video', aliases: ['yh-wan3.0-video'] },
  ...Object.entries(YUANLIU_MODEL_MAPPING).map(([publicName, upstream]) => ({ id: `newapi/yuanliu/${upstream}`, aliases: [publicName, upstream] })),
  ...['ld-2.5特价-1-720', 'ld-gpt-image-2.5-flare'].map(model => ({ id: `newapi/lingdong/${model}`, aliases: [model, model.slice(3)] })),
  ...['yihong-gpt-image-2', 'yihong-gpt-image-2.5-flare', 'yihong-gpt-image-2.5-sunburst'].map(model => ({ id: `newapi/yihong/${model}`, aliases: [model] })),
  // 小易 0.3.0 起渠道公开名带 xy- 前缀，历史内部名保留兼容。
  { id: 'gpt-image-2.5-1k', aliases: ['xy-gpt-image-2.5-1k', 'gpt-image-2.5-1k'] },
  { id: 'gpt-image-2.5-flare-1k', aliases: ['xy-gpt-image-2.5-flare-1k', 'gpt-image-2.5-flare-1k'] },
  { id: 'gpt-image-2.5-sunburst-1k', aliases: ['xy-gpt-image-2.5-sunburst-1k', 'gpt-image-2.5-sunburst-1k'] },
  { id: 'gpt-image-2-1k', aliases: ['xy-gpt-image-2-1k', 'gpt-image-2-1k'] },
  { id: 'gpt-image-2-超分', aliases: ['gpt-image-2-超分'] },
  { id: 'gpt-image-2.5-官方', aliases: ['gpt-image-2.5-官方'] },
  { id: 'gpt-image-2.5-flare-官方', aliases: ['gpt-image-2.5-flare-官方'] },
  { id: 'gpt-image-2.5-sunburst-官方', aliases: ['gpt-image-2.5-sunburst-官方'] },
  { id: 'gpt-image-2-低质量', aliases: ['gpt-image-2-低质量'] },
  { id: 'gpt-image-2-中质量', aliases: ['gpt-image-2-中质量'] },
  { id: 'gpt-image-2-vip', aliases: ['gpt-image-2-vip'] },
  { id: 'gpt-image-2-官方', aliases: ['gpt-image-2-官方'] },
  { id: 'gemini-3-pro-image-preview', aliases: ['gemini-3-pro-image-preview'] },
  { id: 'gemini-3.1-flash-image-preview', aliases: ['gemini-3.1-flash-image-preview'] },
  { id: 'newapi/xiaoyi/MiniMaxH3-2k-pro-sec', aliases: ['MiniMaxH3-2k-pro-sec'] },
  { id: 'newapi/xiaoyi/MiniMaxH3-2k-sec', aliases: ['MiniMaxH3-2k-sec'] },
  { id: 'newapi/xiaoyi/MiniMaxH3-720p-sec', aliases: ['MiniMaxH3-720p-sec'] },
  { id: 'newapi/boluo/minimax_h3_image_audio_to_video_v2_15s', aliases: ['minimax_h3_image_audio_to_video_v2_15s'] },
  { id: 'newapi/boluo/minimax_h3_zm_u24', aliases: ['minimax_h3_zm_u24'] },
  { id: 'newapi/shanhai/shanhai-dola-seedance-v2-5-30-9-0-7', aliases: ['山seedance2.5'] },
  { id: 'newapi/shanhai/oc-model-r5cfh8', aliases: ['海seedance2.5'] },
  { id: 'Wan 3.0 720-1080p', aliases: ['Wan 3.0 720-1080p', 'ft-video-v1-9cf6b90d6d04866453951fc3a26720aa'] },
  { id: '特价渠道 Seedance 2.0 满血 480p (933)', aliases: ['特价渠道 Seedance 2.0 满血 480p (933)', 'ft-video-v1-43644108aaba72b7cbad4cd322737f6c'] },
  { id: 'Seedance 2.5 满血 480-720p', aliases: ['Seedance 2.5 满血 480-720p'] },
  { id: 'XN2-Seedance 2.5 满血 480-720p', aliases: ['XN2-Seedance 2.5 满血 480-720p'] },
  { id: '官方渠道-Seedance 2.5 满血 720p', aliases: ['官方渠道-Seedance 2.5 满血 720p'] },
  { id: '特价渠道 MiniMax H3 480p-1080p', aliases: ['特价渠道 MiniMax H3 480p-1080p', 'ft-video-v1-77e8ee7a636f15dac27b2ce6d6fcd746'] },
  { id: '特价渠道 Seedance 2.5 满血 720p（可过真人）', aliases: ['特价渠道 Seedance 2.5 满血 720p（可过真人）', 'ft-video-v1-99d13a482c1f6f0e71db1e36c4154b70'] },
  { id: 'newapi/zx/mj_fast_imagine', aliases: ['mj_fast_imagine'] },
  { id: 'newapi/t8/mj_relax_imagine', aliases: ['mj_relax_imagine'] },
  { id: 'veo-3.1-generate-preview', aliases: ['veo-3.1-generate-preview'] },
  { id: 'veo-3.1-fast-generate-preview', aliases: ['veo-3.1-fast-generate-preview'] },
  { id: 'nano-banana-4k', aliases: ['nano-banana-4k', 'nano-banana-pro-4k'] },
  { id: 'seed-audio-1.0', aliases: ['seed-audio-1.0'] },
  { id: 'rh-pro-image', aliases: ['rh-pro-image'] },
  { id: 'rh-image-v2', aliases: ['rh-image-v2'] },
  { id: 'rh-gpt2-official', aliases: ['rh-gpt2-official'] },
  { id: 'rh-gpt2-image', aliases: ['rh-gpt2-image'] },
  { id: 'rh-gpt2-text', aliases: ['rh-gpt2-text'] },
  { id: 'z-image-turbo', aliases: ['z-image-turbo'] },
  { id: 'rh-video-v31-fast', aliases: ['rh-video-v31-fast'] },
  { id: 'rh-3d-text', aliases: ['rh-3d-text'] },
  { id: 'rh-3d-image', aliases: ['rh-3d-image'] },
  { id: 'rh-seedance2-text-video', aliases: ['rh-seedance2-text-video'] },
  { id: 'rh-seedance2-image-video', aliases: ['rh-seedance2-image-video'] },
  { id: 'rh-seedance2-multimodal-video', aliases: ['rh-seedance2-multimodal-video'] },
  { id: '普seedance2.0', aliases: ['seedance-2.0'] },
  { id: '普seedance2.0-fast', aliases: ['seedance-2.0-fast'] },
  { id: 'newapi/kik/doubao-seedance-2', aliases: ['doubao-seedance-2'] },
  { id: 'newapi/kik/doubao-seedance-2-0-fast-260128', aliases: ['doubao-seedance-2-0-fast-260128'] },
  { id: 'newapi/kik/doubao-seedance-2-mini', aliases: ['doubao-seedance-2-mini'] },
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

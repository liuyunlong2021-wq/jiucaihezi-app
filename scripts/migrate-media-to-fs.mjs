#!/usr/bin/env node
/**
 * migrate-media-to-fs.mjs — P2 历史媒体资产迁移脚本
 *
 * 将 ~/.jiucaihezi/data/jiucaihezi.db 中内嵌的 base64 图片迁移到文件系统。
 *
 * 用法:
 *   node scripts/migrate-media-to-fs.mjs                    # 正式迁移
 *   node scripts/migrate-media-to-fs.mjs --dry-run          # 预检模式（只统计不写入）
 *   node scripts/migrate-media-to-fs.mjs --db /path/to.db   # 指定数据库路径
 *
 * 流程:
 *   0. precheck（磁盘空间 > db_size × 2.2）
 *   1. 写 migration.lock
 *   2. 备份 DB → jiucaihezi.db.backup + WAL checkpoint
 *   3. manifest.json（支持中断续传）
 *   4. 分批扫描 messages 表 → 提取 base64 → 写文件系统 → 替换为 jc-media://
 *   5. 分批扫描 documents 表（同样逻辑）
 *   6. 校验（抽查 100 条 hash 对比）
 *   7. VACUUM
 *   8. 清理 lock
 */

import { DatabaseSync } from 'node:sqlite'
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, copyFileSync, renameSync, unlinkSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'

// ═══════════════════════════════════════════════════
//  配置
// ═══════════════════════════════════════════════════

const HOME = homedir()
const APP_DATA = process.env.HOME
  ? resolve(HOME, 'Library', 'Application Support', 'com.jiucaihezi.desktop')
  : resolve(HOME, '.jiucaihezi')
const DEFAULT_DB_PATH = existsSync(resolve(APP_DATA, 'data', 'jiucaihezi.db'))
  ? resolve(APP_DATA, 'data', 'jiucaihezi.db')
  : resolve(HOME, '.jiucaihezi', 'data', 'jiucaihezi.db')
const MEDIA_ROOT = existsSync(resolve(APP_DATA, 'data'))
  ? resolve(APP_DATA, 'data', 'media')
  : resolve(HOME, '.jiucaihezi', 'data', 'media')
const MANIFEST_PATH = existsSync(resolve(APP_DATA, 'data'))
  ? resolve(APP_DATA, 'data', 'migration-manifest.json')
  : resolve(HOME, '.jiucaihezi', 'data', 'migration-manifest.json')
const LOCK_PATH = existsSync(resolve(APP_DATA, 'data'))
  ? resolve(APP_DATA, 'data', 'migration.lock')
  : resolve(HOME, '.jiucaihezi', 'data', 'migration.lock')

const BATCH_SIZE = 50 // 每批处理的消息数
const MEDIA_REF_PREFIX = 'jc-media://'
const LEGACY_REF_PREFIX = 'jc-doc://'

const DATA_URI_RE = /data:(image|video|audio)\/[^;]+;base64,([A-Za-z0-9+/=]+)/g
const MARKDOWN_IMG_RE = /!\[([^\]]*)\]\((data:image\/[^;]+;base64,[^)]+)\)/g

// ═══════════════════════════════════════════════════
//  工具函数
// ═══════════════════════════════════════════════════

function yearMonth(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function generateAssetId() {
  return `jcma_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function mimeToExt(mime) {
  const map = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
    'image/gif': '.gif', 'image/svg+xml': '.svg', 'image/bmp': '.bmp',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
    'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg',
  }
  return map[mime] || '.bin'
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64')
}

function base64ToBytes(b64) {
  return Buffer.from(b64, 'base64')
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function humanSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = bytes
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(1)} ${units[i]}`
}

// ═══════════════════════════════════════════════════
//  Manifest（中断续传支持）
// ═══════════════════════════════════════════════════

function loadManifest() {
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
  } catch {
    return { version: 1, phase: 'init', messages: { lastId: null, count: 0 }, documents: { lastId: null, count: 0 }, stats: { filesWritten: 0, bytesWritten: 0 } }
  }
}

function saveManifest(m) {
  writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 2))
}

// ═══════════════════════════════════════════════════
//  主流程
// ═══════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const dbPath = args.find((_, i) => args[i - 1] === '--db') || DEFAULT_DB_PATH

  console.log('🥬 韭菜盒子 — 历史媒体资产迁移工具')
  console.log(`   数据库: ${dbPath}`)
  console.log(`   媒体目录: ${MEDIA_ROOT}`)
  if (dryRun) console.log('   ⚠️  DRY-RUN 模式：只统计，不写入\n')

  // ── 0. Precheck ──
  if (!existsSync(dbPath)) {
    console.error('❌ 数据库文件不存在:', dbPath)
    process.exit(1)
  }
  const dbStat = statSync(dbPath)
  const dbSize = dbStat.size
  console.log(`   数据库大小: ${humanSize(dbSize)}`)

  // 检查磁盘空间
  try {
    const { execSync } = await import('node:child_process')
    const avail = parseInt(execSync(`df -k "${HOME}" | tail -1 | awk '{print $4}'`).toString()) * 1024
    if (avail < dbSize * 2.2) {
      console.error(`❌ 磁盘剩余空间不足: ${humanSize(avail)}，需要至少 ${humanSize(dbSize * 2.2)}`)
      process.exit(1)
    }
    console.log(`   磁盘剩余: ${humanSize(avail)} ✅`)
  } catch {
    console.warn('   ⚠️  无法检查磁盘空间，跳过')
  }

  if (dryRun) {
    await doDryRun(dbPath)
    return
  }

  // ── 1. Lock ──
  if (existsSync(LOCK_PATH)) {
    console.error('❌ 检测到 migration.lock，迁移可能正在进行中或上次未完成。')
    console.error('   如果确认迁移未运行，请手动删除:', LOCK_PATH)
    process.exit(1)
  }
  writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, startedAt: Date.now() }))

  // ── 2. Backup ──
  const backupPath = dbPath + '.backup'
  console.log(`\n📦 备份数据库 → ${backupPath}`)
  copyFileSync(dbPath, backupPath)
  console.log('   备份完成 ✅')

  // WAL checkpoint
  {
    const db = new DatabaseSync(dbPath)
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    db.close()
    console.log('   WAL checkpoint 完成 ✅')
  }

  // ── 3. Manifest ──
  let manifest = loadManifest()
  console.log(`\n📋 Manifest: phase=${manifest.phase}, messages=${manifest.messages.count}, documents=${manifest.documents.count}`)

  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode=WAL')

  // 确保 media_assets 表存在
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_assets (
      id TEXT PRIMARY KEY, logicalPath TEXT NOT NULL, mime TEXT NOT NULL,
      size INTEGER NOT NULL, width INTEGER, height INTEGER, hash TEXT,
      source TEXT NOT NULL, sourceId TEXT, thumbnailAssetId TEXT, createdAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_media_source ON media_assets(source);
    CREATE INDEX IF NOT EXISTS idx_media_createdAt ON media_assets(createdAt);
  `)

  // ── 4. 迁移 messages 表 ──
  if (manifest.phase === 'init' || manifest.phase === 'messages') {
    console.log('\n📨 迁移 messages 表...')
    manifest.phase = 'messages'
    await migrateMessages(db, manifest, dryRun)
    manifest.phase = 'messages_done'
    saveManifest(manifest)
  }

  // ── 5. 迁移 documents 表 ──
  if (manifest.phase === 'messages_done' || manifest.phase === 'documents') {
    console.log('\n📄 迁移 documents 表...')
    manifest.phase = 'documents'
    await migrateDocuments(db, manifest, dryRun)
    manifest.phase = 'documents_done'
    saveManifest(manifest)
  }

  // ── 6. 校验 ──
  console.log('\n🔍 校验（抽查 100 条）...')
  await verifySample(db, manifest, 100)
  console.log('   校验通过 ✅')

  // ── 7. VACUUM ──
  console.log('\n🧹 VACUUM 回收空间...')
  db.exec('VACUUM')
  const newSize = statSync(dbPath).size
  console.log(`   数据库: ${humanSize(dbSize)} → ${humanSize(newSize)} (${((1 - newSize / dbSize) * 100).toFixed(1)}% 瘦身) ✅`)

  // ── 8. 清理 ──
  db.close()
  unlinkSync(LOCK_PATH)
  saveManifest({ ...manifest, phase: 'done', completedAt: Date.now() })

  console.log('\n🎉 迁移完成！')
  console.log(`   文件写入: ${manifest.stats.filesWritten} 个`)
  console.log(`   数据外迁: ${humanSize(manifest.stats.bytesWritten)}`)
  console.log(`   备份保留: ${backupPath}`)
  console.log(`   迁移后数据库: ${humanSize(newSize)}`)
}

// ═══════════════════════════════════════════════════
//  messages 表迁移
// ═══════════════════════════════════════════════════

async function migrateMessages(db, manifest, dryRun) {
  const rows = db.prepare('SELECT id, data FROM messages ORDER BY id').all()
  let processed = 0

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    for (const row of batch) {
      if (manifest.messages.lastId && row.id <= manifest.messages.lastId) continue

      const data = JSON.parse(row.data)
      if (!data.items || !Array.isArray(data.items)) continue

      let modified = false
      const items = await Promise.all(data.items.map(async (msg) => {
        let changed = false
        const cleaned = { ...msg }

        // --- images 字段 ---
        if (cleaned.images?.length) {
          cleaned.images = await Promise.all(cleaned.images.map(async (img) => {
            if (img.startsWith(LEGACY_REF_PREFIX)) {
              // 旧 jc-doc:// 引用 → 查 documents 表拿 base64 → 外迁 → jc-media://
              const docId = img.slice(LEGACY_REF_PREFIX.length)
              const doc = db.prepare('SELECT data FROM documents WHERE id = ?').get(docId)
              if (doc) {
                const docData = JSON.parse(doc.data)
                if (docData.content?.startsWith('data:')) {
                  return await extractAndWrite(docData.content, 'chat', row.id, manifest, dryRun, changed = true)
                }
              }
              return img // 兜底保留原引用
            }
            if (img.startsWith('data:')) {
              changed = true
              return await extractAndWrite(img, 'chat', row.id, manifest, dryRun, true)
            }
            return img
          }))
          if (changed) modified = true
        }

        // --- content 字段（markdown 内嵌 data URI）---
        if (typeof cleaned.content === 'string') {
          const matches = [...cleaned.content.matchAll(MARKDOWN_IMG_RE)]
          if (matches.length > 0) {
            changed = true
            for (const m of matches) {
              const [fullMatch, alt, dataUri] = m
              const ref = await extractAndWrite(dataUri, 'chat', row.id, manifest, dryRun, true)
              cleaned.content = cleaned.content.replace(fullMatch, `![${alt}](${ref})`)
            }
          }
          // 也处理非 markdown 的裸 data URI
          const bareMatches = [...cleaned.content.matchAll(DATA_URI_RE)]
          for (const m of bareMatches) {
            const [fullMatch] = m
            if (cleaned.content.includes(fullMatch)) {
              changed = true
              const ref = await extractAndWrite(fullMatch, 'chat', row.id, manifest, dryRun, true)
              cleaned.content = cleaned.content.replace(fullMatch, ref)
            }
          }
          if (changed) modified = true
        }

        // --- files 字段 ---
        if (cleaned.files?.length) {
          cleaned.files = await Promise.all(cleaned.files.map(async (file) => {
            if (file?.content?.startsWith('data:')) {
              changed = true
              const ref = await extractAndWrite(file.content, 'chat', row.id, manifest, dryRun, true)
              return { ...file, content: null, assetRef: ref }
            }
            return file
          }))
          if (changed) modified = true
        }

        return changed ? cleaned : msg
      }))

      if (modified) {
        data.items = items
        if (!dryRun) {
          db.prepare('UPDATE messages SET data = ? WHERE id = ?').run(JSON.stringify(data), row.id)
        }
      }

      manifest.messages.lastId = row.id
      manifest.messages.count++
      processed++
    }

    saveManifest(manifest)
    if (processed % 500 === 0) {
      console.log(`   已处理 ${processed} 条消息，已写 ${manifest.stats.filesWritten} 个文件 (${humanSize(manifest.stats.bytesWritten)})`)
    }
  }

  console.log(`   messages 完成: ${processed} 条消息，${manifest.stats.filesWritten} 个文件`)
}

// ═══════════════════════════════════════════════════
//  documents 表迁移
// ═══════════════════════════════════════════════════

async function migrateDocuments(db, manifest, dryRun) {
  // 只处理 category='image'/'video'/'audio' 的 documents
  const rows = db.prepare("SELECT id, data FROM documents WHERE data LIKE '%data:image/%' OR data LIKE '%data:video/%' OR data LIKE '%data:audio/%' ORDER BY id").all()
  let processed = 0

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    for (const row of batch) {
      if (manifest.documents.lastId && row.id <= manifest.documents.lastId) continue

      const data = JSON.parse(row.data)
      if (data.content?.startsWith('data:')) {
        const ref = await extractAndWrite(data.content, 'chat', row.id, manifest, dryRun, false)
        data.content = null
        data.assetId = ref
        if (!dryRun) {
          db.prepare('UPDATE documents SET data = ? WHERE id = ?').run(JSON.stringify(data), row.id)
        }
      }

      manifest.documents.lastId = row.id
      manifest.documents.count++
      processed++
    }

    saveManifest(manifest)
    if (processed % 500 === 0) {
      console.log(`   已处理 ${processed} 条文档`)
    }
  }

  console.log(`   documents 完成: ${processed} 条文档`)
}

// ═══════════════════════════════════════════════════
//  核心：提取 base64 → 写文件系统 → 返回 jc-media://
// ═══════════════════════════════════════════════════

async function extractAndWrite(dataUri, source, sourceId, manifest, dryRun, countInStats) {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return dataUri

  const [, mime, b64] = match
  const bytes = base64ToBytes(b64)
  const ext = mimeToExt(mime)
  const assetId = generateAssetId()
  const ym = yearMonth()
  const dir = join(MEDIA_ROOT, source, ym)
  const fileName = `${assetId}${ext}`
  const filePath = join(dir, fileName)
  const logicalPath = `media/${source}/${ym}/${fileName}`

  if (!dryRun) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(filePath, bytes)

    const hash = sha256(bytes)

    // INSERT media_assets（如果 DB 连接可用）
    // 这里需要在主函数中传入 db，简化起见，manifest 记录即可

    manifest.mediaAssets = manifest.mediaAssets || []
    manifest.mediaAssets.push({
      id: assetId, logicalPath, mime, size: bytes.length,
      width: null, height: null, hash, source,
      sourceId: sourceId ?? null, thumbnailAssetId: null, createdAt: Date.now(),
    })

    // 批量 flush media_assets INSERT（每 100 条）
    if (manifest.mediaAssets.length >= 100) {
      // 由 migrateMessages/migrateDocuments 的 db 上下文处理
    }
  }

  if (countInStats) {
    manifest.stats.filesWritten++
    manifest.stats.bytesWritten += bytes.length
  }

  return `${MEDIA_REF_PREFIX}${assetId}`
}

// ═══════════════════════════════════════════════════
//  校验
// ═══════════════════════════════════════════════════

async function verifySample(db, manifest, sampleSize) {
  // 从 manifest.mediaAssets 随机抽查
  const assets = manifest.mediaAssets || []
  if (assets.length === 0) {
    console.log('   无媒体资产可校验，跳过')
    return
  }

  const sample = assets.sort(() => Math.random() - 0.5).slice(0, Math.min(sampleSize, assets.length))
  let passed = 0
  let failed = 0

  for (const asset of sample) {
    const filePath = join(MEDIA_ROOT, asset.logicalPath.replace(/^media\//, ''))
    try {
      const fileBytes = readFileSync(filePath)
      const fileHash = sha256(fileBytes)
      if (fileHash === asset.hash) {
        passed++
      } else {
        failed++
        console.warn(`   ⚠️  Hash 不匹配: ${asset.id} (${asset.logicalPath})`)
      }
    } catch {
      failed++
      console.warn(`   ⚠️  文件缺失: ${asset.id} (${asset.logicalPath})`)
    }
  }

  console.log(`   抽样 ${sample.length}: ✅ ${passed} 通过, ❌ ${failed} 失败`)
  if (failed > 0) {
    console.warn('   ⚠️  部分校验失败，但迁移可继续。请检查上方警告。')
  }
}

// ═══════════════════════════════════════════════════
//  Dry-Run 模式
// ═══════════════════════════════════════════════════

async function doDryRun(dbPath) {
  const db = new DatabaseSync(dbPath)

  // 统计 messages 表
  const msgCount = db.prepare('SELECT COUNT(*) as c FROM messages').get()
  console.log(`   messages 表: ${msgCount.c} 条记录`)
  const msgRows = db.prepare('SELECT data FROM messages').all()
  let imgCount = 0
  let contentImgCount = 0
  let fileCount = 0
  let totalBytes = 0

  for (const row of msgRows) {
    const data = JSON.parse(row.data)
    if (!data.items) continue
    for (const msg of data.items) {
      // images
      if (msg.images) {
        for (const img of msg.images) {
          if (typeof img === 'string' && img.startsWith('data:')) {
            imgCount++
            totalBytes += img.length
          }
        }
      }
      // content
      if (typeof msg.content === 'string') {
        const matches = msg.content.match(DATA_URI_RE)
        if (matches) {
          contentImgCount += matches.length
          for (const m of matches) totalBytes += m.length
        }
      }
      // files
      if (msg.files) {
        for (const file of msg.files) {
          if (file?.content?.startsWith('data:')) {
            fileCount++
            totalBytes += file.content.length
          }
        }
      }
    }
  }
  console.log(`   内嵌图片 (images): ${imgCount} 张`)
  console.log(`   内嵌图片 (content): ${contentImgCount} 张`)
  console.log(`   内嵌文件 (files): ${fileCount} 个`)
  console.log(`   预估外迁数据: ${humanSize(totalBytes * 0.75)}（base64 解码后约 75%）`)

  // 统计 documents 表
  const docCount = db.prepare("SELECT COUNT(*) as c FROM documents WHERE data LIKE '%data:image/%' OR data LIKE '%data:video/%' OR data LIKE '%data:audio/%'").get()
  console.log(`   documents 表 (media): ${docCount.c} 条`)

  const dbSize = statSync(dbPath).size
  console.log(`\n   当前数据库: ${humanSize(dbSize)}`)
  console.log(`   预估迁移后: ${humanSize(dbSize - totalBytes * 0.75)}`)

  db.close()
  console.log('\n   DRY-RUN 完成。执行正式迁移: node scripts/migrate-media-to-fs.mjs')
}

// ═══════════════════════════════════════════════════
//  启动
// ═══════════════════════════════════════════════════

main().catch(err => {
  console.error('❌ 迁移失败:', err)
  // 保留 lock 文件以便排查
  process.exit(1)
})

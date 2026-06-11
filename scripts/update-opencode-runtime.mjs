#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const REPO = process.env.JC_OPENCODE_REPO || 'anomalyco/opencode'
const API_BASE = 'https://api.github.com'
const ROOT = process.cwd()
const BIN_DIR = join(ROOT, 'src-tauri', 'binaries')
const MANIFEST_PATH = join(BIN_DIR, 'opencode-runtime.json')
const FRONTEND_INFO_PATH = join(ROOT, 'src', 'data', 'opencodeRuntimeInfo.ts')

function argValue(name) {
  const prefix = `${name}=`
  const match = process.argv.find(arg => arg.startsWith(prefix))
  return match ? match.slice(prefix.length) : ''
}

function fail(message) {
  console.error(`[opencode:update] ${message}`)
  process.exit(1)
}

function platformTarget() {
  const platform = argValue('--platform') || process.platform
  const arch = argValue('--arch') || process.arch
  if (platform === 'darwin' && arch === 'arm64') {
    return {
      asset: 'opencode-darwin-arm64.zip',
      output: 'opencode-aarch64-apple-darwin',
      binaryName: 'opencode',
    }
  }
  if (platform === 'darwin' && arch === 'x64') {
    return {
      asset: 'opencode-darwin-x64.zip',
      output: 'opencode-x86_64-apple-darwin',
      binaryName: 'opencode',
    }
  }
  if (platform === 'linux' && arch === 'x64') {
    return {
      asset: 'opencode-linux-x64.tar.gz',
      output: 'opencode-x86_64-unknown-linux-gnu',
      binaryName: 'opencode',
    }
  }
  if (platform === 'linux' && arch === 'arm64') {
    return {
      asset: 'opencode-linux-arm64.tar.gz',
      output: 'opencode-aarch64-unknown-linux-gnu',
      binaryName: 'opencode',
    }
  }
  if (platform === 'win32' && arch === 'x64') {
    return {
      asset: 'opencode-windows-x64.zip',
      output: 'opencode-x86_64-pc-windows-msvc.exe',
      binaryName: 'opencode.exe',
    }
  }
  if (platform === 'win32' && arch === 'arm64') {
    return {
      asset: 'opencode-windows-arm64.zip',
      output: 'opencode-aarch64-pc-windows-msvc.exe',
      binaryName: 'opencode.exe',
    }
  }
  fail(`Unsupported platform/arch: ${platform}/${arch}`)
}

async function githubJson(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'jiucaihezi-opencode-runtime-updater',
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  })
  const text = await response.text()
  if (!response.ok) fail(`GitHub API failed: ${response.status} ${response.statusText}\n${text}`)
  return text ? JSON.parse(text) : {}
}

async function download(url, target) {
  const headers = {
    'User-Agent': 'jiucaihezi-opencode-runtime-updater',
    ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
  }
  let lastError = ''
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers })
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
      const bytes = Buffer.from(await response.arrayBuffer())
      await writeFile(target, bytes)
      return
    } catch (error) {
      lastError = error?.message || String(error)
      await new Promise(resolve => setTimeout(resolve, attempt * 1000))
    }
  }

  const curlArgs = [
    '--fail',
    '--location',
    '--retry',
    '3',
    '--retry-delay',
    '2',
    '--output',
    target,
    '--user-agent',
    'jiucaihezi-opencode-runtime-updater',
  ]
  if (process.env.GITHUB_TOKEN) curlArgs.push('--header', `Authorization: Bearer ${process.env.GITHUB_TOKEN}`)
  curlArgs.push(url)
  const result = spawnSync('curl', curlArgs, { encoding: 'utf8' })
  if (result.status !== 0) {
    fail(`Download failed after fetch retries and curl fallback: ${lastError}\n${result.stderr || result.stdout || ''}`)
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed\n${result.stderr || result.stdout || ''}`)
  }
  return result.stdout.trim()
}

async function findBinary(dir, binaryName) {
  const entries = await import('node:fs/promises').then(fs => fs.readdir(dir, { withFileTypes: true }))
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = await findBinary(path, binaryName)
      if (nested) return nested
    } else if (entry.isFile() && entry.name === binaryName) {
      return path
    }
  }
  return ''
}

async function sha256(path) {
  const data = await readFile(path)
  return createHash('sha256').update(data).digest('hex')
}

async function main() {
  const version = argValue('--version') || 'latest'
  const target = platformTarget()
  const release = version === 'latest'
    ? await githubJson(`/repos/${REPO}/releases/latest`)
    : await githubJson(`/repos/${REPO}/releases/tags/${encodeURIComponent(version)}`)
  const assetName = argValue('--asset') || target.asset
  const asset = (release.assets || []).find(item => item.name === assetName)
  if (!asset) {
    const names = (release.assets || []).map(item => item.name).join('\n  ')
    fail(`Release ${release.tag_name || version} does not contain ${assetName}. Available assets:\n  ${names}`)
  }

  const workDir = join(tmpdir(), `jc-opencode-runtime-${Date.now()}`)
  const archivePath = join(workDir, asset.name)
  const extractDir = join(workDir, 'extract')
  await mkdir(extractDir, { recursive: true })
  await download(asset.browser_download_url, archivePath)

  if (asset.name.endsWith('.zip')) {
    run('unzip', ['-q', archivePath, '-d', extractDir])
  } else if (asset.name.endsWith('.tar.gz')) {
    run('tar', ['-xzf', archivePath, '-C', extractDir])
  } else {
    fail(`Unsupported archive type: ${asset.name}`)
  }

  const binary = await findBinary(extractDir, target.binaryName)
  if (!binary) fail(`Cannot find ${target.binaryName} inside ${asset.name}`)

  await mkdir(BIN_DIR, { recursive: true })
  const outputPath = join(BIN_DIR, target.output)
  await copyFile(binary, outputPath)
  if (process.platform !== 'win32') await chmod(outputPath, 0o755)

  const versionOutput = run(outputPath, ['--version'])
  const hash = await sha256(outputPath)
  const updatedAt = new Date().toISOString()
  const manifest = {
    repo: REPO,
    release: release.tag_name,
    asset: asset.name,
    output: basename(outputPath),
    version: versionOutput,
    sha256: hash,
    updatedAt,
  }
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(FRONTEND_INFO_PATH, `export const OPENCODE_RUNTIME_INFO = ${JSON.stringify({
    repo: manifest.repo,
    release: manifest.release,
    version: manifest.version,
    updatedAt: manifest.updatedAt,
  }, null, 2)}\n`)
  await rm(workDir, { recursive: true, force: true })

  console.log(`[opencode:update] installed ${versionOutput}`)
  console.log(`[opencode:update] ${outputPath}`)
  console.log(`[opencode:update] sha256 ${hash}`)
}

if (!existsSync(BIN_DIR)) await mkdir(BIN_DIR, { recursive: true })
main().catch(error => fail(error?.stack || error?.message || String(error)))

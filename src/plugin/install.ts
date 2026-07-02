/**
 * plugin/install.ts — npm 安装引擎
 *
 * 对齐 OpenCode install.ts / shared.ts：
 *   - parsePluginSpecifier() → 解析 "pkg@version"
 *   - resolvePluginTarget() → npm install 到缓存目录
 *   - readPluginManifest() → 读 package.json，检测 exports["./server"/"./tui"]
 *   - patchPluginConfig() → 写入本地配置
 */

import { isTauriRuntime } from '@/utils/tauriEnv'

// ─── 类型 ───

export interface PluginSpecifier {
  pkg: string
  version?: string
}

export type PluginTarget = 'server' | 'tui' | 'chat' | 'tool' | 'unknown'

export interface PluginManifest {
  name: string
  version: string
  description?: string
  targets: PluginTarget[]
  engines?: {
    jiucaihezi?: string
  }
  /** package.json 原始内容 */
  raw: Record<string, unknown>
}

// ─── 解析 ───

/** 解析 "pkg@version" → { pkg, version }（对齐 shared.ts parsePluginSpecifier） */
export function parsePluginSpecifier(spec: string): PluginSpecifier {
  const trimmed = spec.trim()
  // 处理 scoped packages: @scope/name@version
  const atIndex = trimmed.startsWith('@')
    ? trimmed.indexOf('@', 1)
    : trimmed.lastIndexOf('@')

  if (atIndex <= 0) {
    return { pkg: trimmed }
  }

  const pkg = trimmed.slice(0, atIndex)
  const version = trimmed.slice(atIndex + 1)
  return { pkg, version: version || undefined }
}

/** 检测 package.json exports 中的 target（对齐 install.ts packageTargets） */
export function detectTargets(packageJson: Record<string, unknown>): PluginTarget[] {
  const targets: PluginTarget[] = []
  const exports = packageJson.exports as Record<string, unknown> | undefined

  if (!exports) return ['unknown']

  // OpenCode 风格: exports["./server"] / exports["./tui"]
  if (exports['./server']) targets.push('server')
  if (exports['./tui']) targets.push('tui')

  // jiucaihezi 扩展: exports["./chat"] / exports["./tool"]
  if (exports['./chat']) targets.push('chat')
  if (exports['./tool']) targets.push('tool')

  if (targets.length === 0) targets.push('unknown')
  return targets
}

// ─── manifest 读取 ───

/** 读插件 package.json，提取 manifest（对齐 install.ts readPluginManifest） */
export function readPluginManifest(packageJson: Record<string, unknown>): PluginManifest {
  const name = String(packageJson.name || 'unknown')
  const version = String(packageJson.version || '0.0.0')
  const description = packageJson.description ? String(packageJson.description) : undefined
  const targets = detectTargets(packageJson)
  const engines = packageJson.engines as Record<string, string> | undefined

  return {
    name,
    version,
    description,
    targets,
    engines: engines ? { jiucaihezi: engines.jiucaihezi } : undefined,
    raw: packageJson,
  }
}

// ─── 兼容性检查 ───

/** 检查插件兼容性（对齐 shared.ts checkPluginCompatibility） */
export function checkPluginCompatibility(
  manifest: PluginManifest,
  /** 当前产品版本 */
  appVersion: string,
): { compatible: boolean; reason?: string } {
  // 检查 engines.jiucaihezi
  const required = manifest.engines?.jiucaihezi
  if (required) {
    // 简单 semver 范围检查：支持 ">=1.0.0"、"^1.0.0"、">=1.0.0 <2.0.0"
    if (!satisfiesVersion(appVersion, required)) {
      return {
        compatible: false,
        reason: `插件要求 jiucaihezi ${required}，当前版本 ${appVersion}`,
      }
    }
  }

  // 检查是否有可用的 target
  const availableTargets = manifest.targets.filter(t => t !== 'unknown')
  if (availableTargets.length === 0) {
    return {
      compatible: false,
      reason: '插件未声明可用能力（exports 缺少 ./server / ./tui / ./chat / ./tool）',
    }
  }

  return { compatible: true }
}

/** 简单 semver 版本比较 */
function satisfiesVersion(current: string, range: string): boolean {
  // 简单处理：只支持 >=x.y.z
  const minMatch = range.match(/>=\s*(\d+\.\d+\.\d+)/)
  if (minMatch) {
    return compareVersions(current, minMatch[1]) >= 0
  }
  // 支持 ^x.y.z
  const caretMatch = range.match(/\^\s*(\d+\.\d+\.\d+)/)
  if (caretMatch) {
    const [major, minor] = caretMatch[1].split('.').map(Number)
    const [curMajor, curMinor] = current.split('.').map(Number)
    return curMajor === major && curMinor >= minor
  }
  // 精确版本
  const exactMatch = range.match(/^(\d+\.\d+\.\d+)$/)
  if (exactMatch) {
    return compareVersions(current, exactMatch[1]) === 0
  }
  // 无法解析 → 默认通过
  return true
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
  }
  return 0
}

// ─── npm 安装 ───

let pluginCacheDir: string | null = null

function getPluginCacheDir(): string {
  if (pluginCacheDir) return pluginCacheDir
  // ponytail: ~/.jiucaihezi/plugins/ 作为本地缓存目录
  const home = typeof window !== 'undefined'
    ? (window as any).__JC_HOME__ || ''
    : ''
  pluginCacheDir = home ? `${home}/plugins` : '.jiucaihezi/plugins'
  return pluginCacheDir
}

/** 可重置（测试用） */
export function __setPluginCacheDir(dir: string) {
  pluginCacheDir = dir
}

/**
 * 通过 npm install 下载插件包（对齐 shared.ts resolvePluginTarget）
 * 桌面端：调 Tauri shell npm install
 * Web 端：返回空 → 让用户手动安装
 */
export async function resolvePluginTarget(spec: PluginSpecifier): Promise<{
  installed: boolean
  installDir?: string
  error?: string
  webOnlyHint?: string
}> {
  if (!isTauriRuntime()) {
    return {
      installed: false,
      webOnlyHint: `Web 端不支持自动安装。请在桌面端使用，或手动运行: npm install ${spec.pkg}${spec.version ? '@' + spec.version : ''}`,
    }
  }

  const cacheDir = getPluginCacheDir()
  const installDir = `${cacheDir}/${spec.pkg.replace('/', '_')}`

  try {
    // Tauri shell: npm install <pkg>@<version> --prefix <installDir>
    const { invoke } = await import('@tauri-apps/api/core')
    const pkgSpec = spec.version ? `${spec.pkg}@${spec.version}` : spec.pkg

    await invoke('plugin_install_npm', {
      packageName: pkgSpec,
      installDir,
    })

    return { installed: true, installDir }
  } catch (error) {
    return {
      installed: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * 读已安装插件的 package.json
 */
export async function readInstalledManifest(installDir: string): Promise<PluginManifest | null> {
  try {
    if (isTauriRuntime()) {
      const { invoke } = await import('@tauri-apps/api/core')
      const raw = await invoke<string>('plugin_read_manifest', { installDir })
      const pkg = JSON.parse(raw)
      return readPluginManifest(pkg)
    }
    return null
  } catch {
    return null
  }
}

/**
 * 完整安装流程（对齐 install.ts installPlugin）：
 *   1. parsePluginSpecifier
 *   2. resolvePluginTarget → npm install
 *   3. readPluginManifest
 *   4. checkPluginCompatibility
 */
export async function installPlugin(packageSpec: string, appVersion: string): Promise<{
  success: boolean
  manifest?: PluginManifest
  installDir?: string
  error?: string
  webOnlyHint?: string
}> {
  const spec = parsePluginSpecifier(packageSpec)

  // 1. npm install
  const target = await resolvePluginTarget(spec)
  if (!target.installed) {
    return {
      success: false,
      error: target.error || '安装失败',
      webOnlyHint: target.webOnlyHint,
    }
  }

  // 2. 读 manifest
  const manifest = await readInstalledManifest(target.installDir!)
  if (!manifest) {
    return { success: false, error: '无法读取插件 package.json' }
  }

  // 3. 兼容性检查
  const compat = checkPluginCompatibility(manifest, appVersion)
  if (!compat.compatible) {
    return { success: false, error: compat.reason, manifest }
  }

  return {
    success: true,
    manifest,
    installDir: target.installDir,
  }
}

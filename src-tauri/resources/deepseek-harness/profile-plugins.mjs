import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 让这些插件包能被 **profile 目录** 解析到。
 *
 * 官方 Loader 解析裸包名时，锚点是 profile 目录（`dsh-app-boot` 把 `ctx.baseUrl` 设成
 * `<DSH_HOME>/profiles/<profile>/cordis.yml` 所在目录）。已发布 bundle 依赖图里的包
 * （例如 `@deepseek-ai/dsh-file-reference-local` 是 `dsh-web-app` 的依赖）能命中；
 * 图外的包解析不到时，Loader **只记一条 `failed to import`**——它不在 `pending`
 * （等服务的）那类，也不让启动失败，于是「插件没挂上」表现为：不报错、模型工具表里
 * 什么都不出现。2026-10-03 查 Computer Use 就是被这条静默记录误导成「挂载成功」的。
 *
 * 官方给用户装插件的手段是 `dsh plugin <profile> add <pkg>`（在 profile 目录跑 pnpm）。
 * 打包运行时不能联网、也不该在用户机上跑 pnpm，所以这里把运行时里那一份挂成目录联接
 * （Windows junction 无需管理员权限；Node 默认解析真实路径，包自己的依赖照旧从运行时
 * node_modules 找）。
 */
export const profilePluginPackages = [
  'dsh-computer-use',
  'dsh-experimental-computer-use-cua-driver-native',
]

/** 运行时里那份包的绝对路径（本模块与 `runner.mjs` 同在 harness 根目录）。 */
export function runtimePluginPath(plugin) {
  if (plugin === '@jiucaihezi/dsh-tool-creation') {
    return fileURLToPath(new URL('./plugins/creation-tools/', import.meta.url))
  }
  const packageName = plugin.startsWith('@') ? plugin : `@deepseek-ai/${plugin}`
  return fileURLToPath(new URL(`./node_modules/${packageName}`, import.meta.url))
}

/** 官方启动器给 profile 用的目录。 */
export function profileDirectory(dshHome, profile = 'sdk') {
  return join(dshHome, 'profiles', profile)
}

/**
 * 催生 profile 骨架：`<DSH_HOME>/profiles/<profile>/` 由 dsh 首次启动建立，而链接必须
 * 落在它里面。`--dump-config` 只组合、不启动，是官方的同一初始化路径。
 */
function initializeProfile(dshHome, profile) {
  execFileSync(process.execPath, [
    fileURLToPath(new URL('./node_modules/@deepseek-ai/dsh/lib/bin.js', import.meta.url)),
    '--profile',
    profile,
    '--dump-config',
  ], {
    env: { ...process.env, DSH_HOME: dshHome },
    stdio: 'ignore',
    windowsHide: true,
    timeout: 60_000,
  })
}

/**
 * 把图外包挂到 profile 的 `node_modules` 下。
 * @param dshHome - 该工作区的 harness home（DSH_HOME）。
 * @param options - 覆盖 profile 名、包表、运行时根与初始化实现（测试用）。
 * @returns 跳过的原因，或本次新建的链接名。
 */
export function ensureProfilePluginLinks(dshHome, {
  profile = 'sdk',
  packages = profilePluginPackages,
  runtimeRoot,
  initialize = initializeProfile,
} = {}) {
  if (!dshHome) return { state: 'skipped', reason: 'no-dsh-home' }
  const directory = profileDirectory(dshHome, profile)
  if (!existsSync(directory)) {
    try {
      initialize(dshHome, profile)
    } catch {
      // 催不出来（官方改了启动参数、进程起不来）就当没这回事：这不是会话能不能跑的前提。
      return { state: 'skipped', reason: 'profile-init-failed' }
    }
    if (!existsSync(directory)) return { state: 'skipped', reason: 'profile-missing' }
  }
  const modulesDirectory = join(directory, 'node_modules')
  const linked = []
  for (const plugin of packages) {
    const target = runtimeRoot === undefined
      ? runtimePluginPath(plugin)
      : plugin.startsWith('@')
        ? join(runtimeRoot, plugin)
        : join(runtimeRoot, '@deepseek-ai', plugin)
    if (!existsSync(target)) continue
    const link = join(modulesDirectory, plugin.startsWith('@') ? plugin : `@deepseek-ai/${plugin}`)
    if (existsSync(link)) continue
    try {
      mkdirSync(dirname(link), { recursive: true })
      symlinkSync(target, link, 'junction')
      linked.push(plugin)
    } catch {
      // 权限/并发只跳过这一个：装不上就退化成「没有这一项能力」，不该让整轮起不来。
    }
  }
  return { state: 'ok', linked }
}

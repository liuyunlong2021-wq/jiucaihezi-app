import { realpath } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { resolveAgentsHome, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { scopeChainOf } from '@deepseek-ai/dsh-scope'
import { setWikiSourceContent } from './manju-wiki.mjs'
import { updateWikiProductionRoute } from './wiki-runtime.mjs'

const states = new WeakMap()
const installed = new WeakSet()
const preparations = new WeakMap()
export async function prepareProductionStep(agent, messages, signal) {
  await preparations.get(agent)?.(messages, signal)
}
const providerName = 'jiucaihezi-production'
const retired = new Set(['jc-manju-zhizuo', 'jc-duanju', 'jc-manju-minimaxh3'])
const defaultDirectory = fileURLToPath(new URL('../../../public/skills/', import.meta.url))
export const PRODUCTION_TOOLS = ['skill', 'read', 'glob', 'grep', 'write', 'edit', 'wiki_read_guidance', 'wiki_save_artifact', 'present']
const directoryNow = () => process.env.DSH_BUNDLED_SKILL_DIR || defaultDirectory
const manifests = new Map()
function groupsFor(directory = directoryNow()) {
  if (!manifests.has(directory)) manifests.set(directory, JSON.parse(readFileSync(join(directory, 'production-skills.json'), 'utf8')))
  return manifests.get(directory)
}

export function validateProductionMode(mode = 'none') {
  if (typeof mode === 'string' && mode.startsWith('skills:')) {
    const names = mode.slice(7).split(',')
    if (names.every(name => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) && new Set(names).size === names.length) return mode
  }
  if (!['none', 'manju', 'short-drama', 'novel'].includes(mode)) throw new Error('未知创作 Skill 范围')
  return mode
}
export function validateProductionScope(mode = 'none', route) {
  mode = validateProductionMode(mode)
  route ??= mode.startsWith('skills:') ? 'none' : mode
  if (!['none', 'manju', 'short-drama', 'novel'].includes(route)) throw new Error('未知创作路线')
  if (!mode.startsWith('skills:') && route !== mode) throw new Error('创作路线与 Skill 范围不一致')
  if (route !== 'none' && mode.startsWith('skills:') && mode.slice(7).split(',').some(name => !groupsFor()[route].includes(name))) throw new Error('Skill 不属于当前创作路线')
  return { productionMode: mode, productionRoute: route }
}
function stateFor(scope) {
  for (const key of scopeChainOf(scope)) if (states.has(key)) return states.get(key)
}
export function productionModeFor(scope) { return stateFor(scope)?.mode ?? 'none' }
export function productionRouteFor(scope) { return stateFor(scope)?.route ?? 'none' }
export function productionSource(params, agent) {
  const mode = params.productionMode ?? productionModeFor(agent)
  const route = params.productionRoute ?? (params.productionMode === undefined ? productionRouteFor(agent) : undefined)
  return validateProductionScope(mode, route)
}
export function allowsProductionSkill(scope, name, provider) {
  const state = stateFor(scope)
  // Retired bundled routers stay hidden; explicit ordinary personal Skills may reuse their names.
  if (retired.has(name) && !(state?.route === 'none' && state.mode.startsWith('skills:') && state.names.has(name) && (provider === undefined || provider === providerName))) return false
  return !state || state.mode === 'none' || state.names.has(name) && (state.route === 'none' && state.mode.startsWith('skills:') || provider === undefined || provider === providerName)
}
export function filterProductionSkills(scope, skills) {
  return skills.filter(skill => allowsProductionSkill(scope, skill.name, skill.provider))
}

// The automatic driver must also check durable/pending inputs before Agent pre-step runs.
export function productionGoalAllowed(agent) {
  if (productionRouteFor(agent) !== 'none') return false
  for (const message of [...agent.inbox.nextStep, ...agent.inbox.nextTurn]) {
    if (message.source.kind === 'user' && validateProductionScope(message.source.productionMode, message.source.productionRoute).productionRoute !== 'none') return false
  }
  for (let seq = agent.session.seq - 1; seq >= 0; seq--) {
    const event = agent.session.eventAt(seq)
    if (event?.type === 'user/message' && event.data.source.kind === 'user')
      return validateProductionScope(event.data.source.productionMode, event.data.source.productionRoute).productionRoute === 'none'
  }
  return true
}
function contains(root, path) {
  const rel = relative(root, path)
  return rel === '' || rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel)
}
async function canonical(path) {
  try { return await realpath(path) }
  catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error
    const parent = dirname(path)
    return parent === path ? path : join(await canonical(parent), path.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)))
  }
}
async function resourceRoots(ctx, agent, directory) {
  const roots = new Set([directory, join(resolveDshHome(), 'skills'), join(resolveAgentsHome(), 'skills')])
  const cwd = await ctx.workingDirectory.ensure(agent)
  for (const base of new Set([agent.session.header.cwd, cwd])) {
    let cursor = base
    while (true) {
      roots.add(join(cursor, '.agents', 'skills')); roots.add(join(cursor, '.dsh', 'skills'))
      const parent = dirname(cursor)
      if (parent === cursor) break
      cursor = parent
    }
    const catalog = await ctx.skills.snapshot({ cwd: base })
    for (const skill of catalog.skills) {
      if (skill.resourceBase?.kind === 'directory') roots.add(dirname(skill.resourceBase.path))
      else if (skill.path) roots.add(dirname(skill.path))
    }
  }
  const lexical = [...roots].map(path => resolve(path))
  return [...new Set([...lexical, ...await Promise.all(lexical.map(canonical))])]
}
async function resourceDenial(state, name, args, cwd) {
  if (state.route === 'none' || !['read', 'read_image', 'write', 'edit', 'glob', 'grep'].includes(name)) return
  const requested = resolve(cwd, args.file_path ?? args.path ?? '.')
  const path = await canonical(requested)
  if (!state.roots.some(root => contains(root, path) || contains(root, requested))) return
  if (['write', 'edit'].includes(name)) return '创作模式中的 Skill 资源只读。'
  if (state.packages.some(root => contains(root, path)) || state.shared.some(root => path === root || contains(root, path))) return
  return '此 Skill 资源不属于当前创作路线，请读取群内资源或退出创作模式。'
}

// Exclude complete Skill roots before ripgrep reads them; targeted allowed packages stay searchable.
export async function productionSearchArguments(agent, argv, workdir) {
  const state = stateFor(agent)
  if (!state || state.route === 'none') return argv
  const index = argv.indexOf('--')
  const search = await canonical(resolve(workdir, index < 0 ? '.' : argv[index + 1]))
  const reason = await resourceDenial(state, 'glob', { path: search }, workdir)
  if (reason) throw new Error(reason)
  const excluded = []
  for (const root of state.roots) if (contains(search, root) && search !== root) {
    const path = relative(search, root).split(sep).join('/').replace(/[\[\]{}*?!\\]/g, '\\$&')
    excluded.push(`--glob=!**/${path}`, `--glob=!**/${path}/**`)
  }
  const next = [...argv]
  next.splice(index < 0 ? next.length : index, 0, ...excluded)
  return next
}

export function installProductionSkills(ctx) {
  if (installed.has(ctx)) return
  installed.add(ctx)
  ctx.on('agent/created', async ({ agent }) => {
    const state = { mode: 'none', route: 'none', names: new Set(), roots: [], packages: [], shared: [], allowed: new Set() }
    const parentId = agent.session.header.parentSession
    const inheritedFrom = parentId === undefined ? agent : ctx.agents.get(parentId) ?? agent
    let inherited = validateProductionScope(productionModeFor(inheritedFrom), productionRouteFor(inheritedFrom))
    states.set(agent, state)
    const observation = await ctx.sessionQuery.observeSession(agent.session.id)
    try {
      for (const event of observation.events) if (event.type === 'user/message' && event.data.source.kind === 'user' && event.data.source.productionMode !== undefined) {
        const source = event.data.source
        inherited = validateProductionScope(source.productionMode, source.productionRoute ?? (source.productionMode.startsWith('skills:') ? inherited.productionRoute : undefined))
      }
    } finally { observation[Symbol.dispose]() }
    let release, releaseTools
    const directory = directoryNow()
    const setMode = async (mode, route, c) => {
      const scope = validateProductionScope(mode, route)
      route = scope.productionRoute
      if (state.mode === mode && state.route === route) return
      const individual = mode.startsWith('skills:')
      const names = individual ? mode.slice(7).split(',') : mode === 'none' ? [] : groupsFor(directory)[mode]
      if (!Array.isArray(names) || names.some(name => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || retired.has(name) && (!individual || route !== 'none'))) throw new Error('创作 Skill 白名单无效')
      await releaseTools?.(); releaseTools = undefined
      await release?.(); release = undefined
      if (mode !== 'none') {
        const fiber = c.plugin({ name: 'production-skill-provider', inject: ['skills'], apply(child) {
          let provider
          child.skills.registerProvider(control => {
            provider = new FileSystemSkillProvider(child, control, { providerName, includeDefaultRoots: individual && route === 'none', bundledSkillDir: directory })
            return { name: providerName,
              async list(options) {
                const observed = await provider.list(options)
                const candidates = Array.isArray(observed) ? observed : observed.candidates
                const allowed = candidates.filter(candidate => names.includes(candidate.name) && !(retired.has(candidate.name) && candidate.source === 'bundled'))
                if ((!individual || route !== 'none') && allowed.length !== names.length) throw new Error('内置创作 Skill 包不完整')
                return Array.isArray(observed) ? allowed : { ...observed, candidates: allowed }
              }, get: (candidate, options) => provider.get(candidate, options) }
          })
          child.effect(() => () => provider.dispose())
        } })
        try { await fiber.await(); fiber.assertActive(); release = () => fiber.dispose() }
        catch (error) { await fiber.dispose(); throw error }
      }
      state.mode = mode; state.route = route; state.names = new Set(names)
      if (route !== 'none') {
        const model = await c.llm.resolveModelInfo(agent.options.provider, agent.options.model)
        const allowed = [...PRODUCTION_TOOLS, ...(model.inputModalities?.includes('image') ? ['read_image'] : [])]
        state.allowed = new Set(allowed)
        const globals = allowed.filter(name => c.tools.get(name) !== undefined)
        const mask = c.tools.restrict({ allow: globals })
        const presentation = c.tools.presentAs('native')
        releaseTools = () => { presentation(); mask() }
        state.packages = await Promise.all(groupsFor(directory)[route].map(name => canonical(join(directory, name))))
        state.shared = await Promise.all(['wiki-native', 'wiki-artifacts.json', 'production-skills.json'].map(name => canonical(join(directory, name))))
        state.roots = await resourceRoots(c, agent, directory)
        const goal = c.get('goals')?.get(agent)
        if (goal?.phase === 'active') c.get('goals').pause(agent, { id: goal.id, revision: goal.revision })
      }
      updateWikiProductionRoute(agent, route)
    }
    const plugin = agent.ctx.plugin({ name: 'production-skill-scope', inject: ['skills', 'tools', 'llm', 'workingDirectory'], async apply(c) {
      c.on('system-prompt/assemble', async (_assembly, _context, next) => {
        const assembly = await next()
        if (state.route === 'none') return assembly
        const names = new Set(assembly.tools.map(tool => tool.name))
        if (names.size !== state.allowed.size || [...names].some(name => !state.allowed.has(name))) throw new Error('创作模式工具目录不完整或包含未授权工具')
        return { ...assembly, sections: assembly.sections.filter(section => {
          if (section.name.startsWith('tool:')) return state.allowed.has(section.name.split(':')[1])
          return !/^(mcp:|computer-use:|team:)/.test(section.name) && section.name !== 'mcp-resource-servers'
        }) }
      })
      const denials = new WeakMap()
      c.tools.guard(exec => state.route === 'none' ? undefined : !state.allowed.has(exec.name) ? '工具不属于当前创作路线。' : denials.get(exec))
      c.on('tools/pre-execute', async (exec, next) => {
        if (exec.agent === agent && state.route !== 'none') {
          const cwd = await c.workingDirectory.ensure(agent, exec.signal)
          const reason = await resourceDenial(state, exec.name, exec.arguments, cwd)
          if (reason) denials.set(exec, reason)
        }
        return next()
      })
      await setMode(inherited.productionMode, inherited.productionRoute, c)
      preparations.set(agent, async (messages, signal) => {
        const latest = messages.findLast(message => message.source.kind === 'user')
        if (latest) {
          const source = latest.source
          const scope = validateProductionScope(source.productionMode ?? state.mode, source.productionRoute ?? (source.productionMode === undefined || source.productionMode.startsWith('skills:') ? state.route : undefined))
          await setMode(scope.productionMode, scope.productionRoute, c)
          setWikiSourceContent(agent, latest.content)
        }
        if (state.mode !== 'none') {
          const catalog = await c.skills.snapshot({ cwd: agent.session.header.cwd, scope: agent, signal })
          if (!catalog.complete || catalog.skills.length !== state.names.size) throw new Error('创作 Skill 目录暂不可用，请检查内置包后重试。')
        }
        if (state.route !== 'none') {
          state.roots = await resourceRoots(c, agent, directory)
          const unexpected = c.tools.schemas(agent).filter(tool => !state.allowed.has(tool.name))
          if (unexpected.length) throw new Error('创作模式出现未授权工具：' + unexpected.map(tool => tool.name).join(', '))
        }
        updateWikiProductionRoute(agent, state.route)
      })
      c.effect(() => async () => { try { await releaseTools?.(); await release?.() } finally { states.delete(agent); preparations.delete(agent) } })
    } })
    try { await plugin.await(); plugin.assertActive() }
    catch (error) { await plugin.dispose(); states.delete(agent); throw error }
  })
}

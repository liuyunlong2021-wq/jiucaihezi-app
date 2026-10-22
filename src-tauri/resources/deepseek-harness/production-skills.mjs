import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { scopeChainOf } from '@deepseek-ai/dsh-scope'
import { setWikiSourceContent } from './manju-wiki.mjs'

const states = new WeakMap()
const installed = new WeakSet()
const providerName = 'jiucaihezi-production'
const retired = new Set(['jc-manju-zhizuo', 'jc-duanju', 'jc-manju-minimaxh3'])
const defaultDirectory = fileURLToPath(new URL('../../../public/skills/', import.meta.url))

export function validateProductionMode(mode = 'none') {
  if (typeof mode === 'string' && mode.startsWith('skills:')) {
    const names = mode.slice(7).split(',')
    if (names.every(name => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) && !retired.has(name)) && new Set(names).size === names.length) return mode
  }
  if (!['none', 'manju', 'short-drama', 'novel'].includes(mode)) throw new Error('未知创作 Skill 范围')
  return mode
}

function stateFor(scope) {
  for (const key of scopeChainOf(scope)) if (states.has(key)) return states.get(key)
}

// 只限定名称和来源；正文加载、目录渲染与执行仍由官方负责。
export function allowsProductionSkill(scope, name, provider) {
  if (retired.has(name)) return false
  const state = stateFor(scope)
  return !state || state.mode === 'none' || state.names.has(name) && (state.mode.startsWith('skills:') || provider === undefined || provider === providerName)
}
export function filterProductionSkills(scope, skills) {
  return skills.filter(skill => allowsProductionSkill(scope, skill.name, skill.provider))
}
export function productionModeFor(scope) { return stateFor(scope)?.mode ?? 'none' }

export function installProductionSkills(ctx) {
  if (installed.has(ctx)) return
  installed.add(ctx)
  ctx.on('agent/created', async ({ agent }) => {
    const observation = await ctx.sessionQuery.observeSession(agent.session.id)
    let inherited
    try {
      const last = observation.events.findLast(event => event.type === 'user/message' && event.data.source.kind === 'user' && event.data.source.productionMode !== undefined)
      inherited = validateProductionMode(last?.data.source.productionMode ?? productionModeFor(agent))
    } finally { observation[Symbol.dispose]() }
    let release
    const state = { mode: 'none', names: new Set() }
    const directory = process.env.DSH_BUNDLED_SKILL_DIR || defaultDirectory
    const setMode = async (mode, c) => {
      if (state.mode === mode) return
      const individual = mode.startsWith('skills:')
      const groups = mode === 'none' || individual ? undefined : JSON.parse(await readFile(join(directory, 'production-skills.json'), 'utf8'))
      const names = individual ? mode.slice(7).split(',') : mode === 'none' ? [] : groups[mode]
      if (!Array.isArray(names) || names.some(name => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || retired.has(name))) throw new Error('创作 Skill 白名单无效')
      if (release) { await release(); release = undefined; state.mode = 'none'; state.names = new Set() }
      let nextRelease
      if (mode !== 'none') {
        const fiber = c.plugin({ name: 'production-skill-provider', inject: ['skills'], apply(child) {
          let provider
          child.skills.registerProvider(control => {
            provider = new FileSystemSkillProvider(child, control, { providerName, includeDefaultRoots: individual, bundledSkillDir: directory })
            return {
              name: providerName,
              async list(options) {
                const observed = await provider.list(options)
                const candidates = Array.isArray(observed) ? observed : observed.candidates
                const allowed = candidates.filter(candidate => names.includes(candidate.name))
                if (!individual && allowed.length !== names.length) throw new Error('内置创作 Skill 包不完整')
                return Array.isArray(observed) ? allowed : { ...observed, candidates: allowed }
              },
              get: (candidate, options) => provider.get(candidate, options),
            }
          })
          child.effect(() => () => provider.dispose())
        } })
        try { await fiber.await(); fiber.assertActive(); nextRelease = () => fiber.dispose() }
        catch (error) { await fiber.dispose(); throw error }
      }
      release = nextRelease
      state.mode = mode
      state.names = new Set(names)
      states.set(agent, state)
    }
    const plugin = agent.ctx.plugin({ name: 'production-skill-scope', inject: ['skills'], async apply(c) {
      states.set(agent, state)
      await setMode(inherited, c)
      c.on('agent/pre-step', async ({ agent: current, messages, signal }, next) => {
        if (current !== agent) return next()
        const users = messages.filter(message => message.source.kind === 'user')
        const latest = users.at(-1)
        if (latest) {
          await setMode(validateProductionMode(latest.source.productionMode ?? state.mode), c)
          setWikiSourceContent(agent, latest.content)
        }
        if (state.mode !== 'none') {
          const catalog = await c.skills.snapshot({ cwd: agent.session.header.cwd, scope: agent, signal })
          if (!catalog.complete || catalog.skills.length !== state.names.size) throw new Error('创作 Skill 目录暂不可用，请检查内置包后重试。')
        }
        return next()
      })
      c.effect(() => async () => { try { await release?.() } finally { states.delete(agent) } })
    } })
    await plugin.await()
    plugin.assertActive()
  })
}

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// 在当前 agent 的官方 SkillRegistry 层登记内置版本，优先于同名用户／项目文件。
// 模型上下文仍只注入用户点名的入口，子 Skill 由路由器按需读取资源。
export async function pinManjuSkills(rec, names, directory = process.env.DSH_BUNDLED_SKILL_DIR) {
  const hasManju = names.includes('jc-manju-zhizuo')
  const hasNovel = names.includes('jc-novel')
  const hasShortDrama = names.includes('jc-duanju')
  if (!hasManju && !hasNovel && !hasShortDrama) return () => {}
  const agent = rec.handle.agent
  if (!directory) throw new Error('内置创作与 Wiki 资源目录不可用')
  if (Number(hasManju) + Number(hasNovel) + Number(hasShortDrama) > 1)
    throw new Error('漫剧制作、短剧写作与小说创作不能同时启用')
  const route = hasManju || hasShortDrama
    ? JSON.parse(await readFile(join(directory, hasManju ? 'manju-route.json' : 'short-drama-route.json'), 'utf8')) : undefined
  if (route && (route.router !== (hasManju ? 'jc-manju-zhizuo' : 'jc-duanju') || !Array.isArray(route.skills) || !route.skills.includes(route.router)
    || route.skills.some(name => typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))))
    throw new Error('创作路线内置 Skill 清单无效')
  const unsupported = hasManju || hasShortDrama
    ? names.filter(name => name !== 'wiki-memory' && !route.skills.includes(name))
    : hasNovel
      ? names.filter(name => name !== 'wiki-memory' && name !== 'jc-novel')
      : names.filter(name => ['jc-manju-zhizuo', 'jc-novel', 'jc-duanju'].includes(name))
  const routeLabel = hasManju ? '漫剧制作' : hasNovel ? '小说创作' : '短剧写作'
  if (unsupported.length) throw new Error(`${routeLabel}路线不能同时加载 ${unsupported.join('、')}；请先退出当前路线。`)
  const skillNames = [...new Set([
    ...(route?.skills || []),
    ...(hasNovel ? ['jc-novel'] : []),
    ...(hasShortDrama ? ['jc-duanju'] : []),
  ])]
  // 全部读回成功后再登记，避免坏包留下半套已注册状态。
  const loadSkill = async (name, signal) => {
    const base = join(directory, name)
    const content = await readFile(join(base, 'SKILL.md'), { encoding: 'utf8', signal })
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || ''
    const actualName = frontmatter.match(/^name:\s*([^\r\n]+)$/m)?.[1]?.trim()
    if (actualName !== name) throw new Error(`内置 Wiki／创作 Skill 身份不符：${name}`)
    return {
      name,
      source: 'bundled',
      path: join(base, 'SKILL.md'),
      description: frontmatter.match(/^description:\s*([^\r\n]+)$/m)?.[1]?.trim().replace(/^"|"$/g, '') || name,
      content,
      resourceBase: { kind: 'directory', path: base },
      invocation: { userInvocable: true, modelInvocable: name !== route?.router },
    }
  }
  const skills = await Promise.all(skillNames.map(name => loadSkill(name)))
  if (rec.handle.agent !== agent) throw new Error(`${routeLabel} Agent 已替换`)
  let ready = false
  const plugin = agent.ctx.plugin({
    name: 'jiucaihezi-production-skills',
    inject: ['skills'],
    apply(ctx) {
      // 官方 provider 的目录可以缓存，get() 的正文按需读盘；不将旧正文固定在 Agent 生命周期内。
      const providerName = 'jiucaihezi-bundled'
      ctx.skills.registerProvider(() => ({
        name: providerName,
        list: async () => skills.map(({ content, ...skill }) => ({
          ...skill, provider: providerName, rank: 600, locator: skill.name,
        })),
        get: async (candidate, options) => {
          if (!skillNames.includes(candidate.locator)) return undefined
          return { ...await loadSkill(candidate.locator, options.signal), provider: providerName }
        },
      }))
      ready = true
    },
  })
  try {
    await plugin.await()
    if (!ready) throw new Error('创作路线 Wiki 归档 skills 插件未启动：注册表服务不可用')
    plugin.assertActive()
    return () => plugin.dispose()
  } catch (error) {
    await plugin.dispose()
    throw error
  }
}

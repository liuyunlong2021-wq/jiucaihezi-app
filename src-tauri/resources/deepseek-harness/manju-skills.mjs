import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createWikiArtifactTool } from './manju-wiki.mjs'

// 在当前 agent 的官方 SkillRegistry 层登记内置版本，优先于同名用户／项目文件。
// 模型上下文仍只注入用户点名的入口，子 Skill 由路由器按需读取资源。
export async function pinManjuSkills(rec, names, directory = process.env.DSH_BUNDLED_SKILL_DIR) {
  const hasManju = names.includes('jc-manju-zhizuo')
  const hasNovel = names.includes('jc-novel')
  const hasWikiMemory = names.includes('wiki-memory') || hasManju || hasNovel
  if (!hasWikiMemory) return () => {}
  const agent = rec.handle.agent
  if (!directory) throw new Error('内置创作与 Wiki 资源目录不可用')
  if (hasManju && hasNovel) throw new Error('漫剧制作与小说创作不能同时启用')
  const route = hasManju ? JSON.parse(await readFile(join(directory, 'manju-route.json'), 'utf8')) : undefined
  if (route && (route.router !== 'jc-manju-zhizuo' || !Array.isArray(route.skills) || !route.skills.includes(route.router)
    || route.skills.some(name => typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))))
    throw new Error('漫剧制作内置 Skill 清单无效')
  const unsupported = hasManju
    ? names.filter(name => name !== 'wiki-memory' && !route.skills.includes(name))
    : hasNovel
      ? names.filter(name => name !== 'wiki-memory' && name !== 'jc-novel')
      : names.filter(name => name === 'jc-manju-zhizuo')
  if (unsupported.length) throw new Error(`${hasManju ? '漫剧制作' : '小说创作'}路线不能同时加载 ${unsupported.join('、')}；请先退出当前路线。`)
  const skillNames = [...new Set([
    'wiki-memory',
    ...(route?.skills || []),
    ...(hasNovel ? ['jc-novel'] : []),
  ])]
  const artifactContract = JSON.parse(await readFile(join(directory, 'wiki-artifacts.json'), 'utf8'))
  if (!artifactContract || typeof artifactContract.types !== 'object' || !Array.isArray(artifactContract.rootCandidates)
    || !Array.isArray(artifactContract.rootMarkers) || !artifactContract.scaffold
    || !Number.isSafeInteger(artifactContract.minimumRootMarkers) || artifactContract.minimumRootMarkers < 1)
    throw new Error('共享 Wiki 归档合同无效')
  // 全部读回成功后再登记，避免坏包留下半套已注册状态。
  const skills = await Promise.all(skillNames.map(async name => {
    const base = join(directory, name)
    const content = await readFile(join(base, 'SKILL.md'), 'utf8')
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
  }))
  if (rec.handle.agent !== agent) throw new Error('漫剧制作 Agent 已替换')
  let ready = false
  const plugin = agent.ctx.plugin({
    name: 'jiucaihezi-wiki-memory',
    inject: ['skills', 'tools', 'fs', 'sandboxPolicy'],
    apply(ctx) {
      for (const skill of skills) ctx.skills.register(skill)
      const disposeTool = ctx.tools.register(createWikiArtifactTool(ctx, artifactContract))
      ctx.effect(() => () => disposeTool())
      ready = true
    },
  })
  try {
    await plugin.await()
    if (!ready) throw new Error('漫剧制作／小说创作 Wiki 归档 skills 插件未启动：注册表服务不可用')
    plugin.assertActive()
    return () => plugin.dispose()
  } catch (error) {
    await plugin.dispose()
    throw error
  }
}

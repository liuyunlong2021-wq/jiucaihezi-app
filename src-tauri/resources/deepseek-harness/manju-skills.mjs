import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// 在当前 agent 的官方 SkillRegistry 层登记内置版本，优先于同名用户／项目文件。
// 模型上下文仍只注入用户点名的入口，子 Skill 由路由器按需读取资源。
export async function pinManjuSkills(rec, names, directory = process.env.DSH_BUNDLED_SKILL_DIR) {
  if (!names.includes('jc-manju-zhizuo')) return () => {}
  if (!directory) throw new Error('漫剧制作内置 Skill 目录不可用')
  const route = JSON.parse(await readFile(join(directory, 'manju-route.json'), 'utf8'))
  if (route.router !== 'jc-manju-zhizuo' || !Array.isArray(route.skills) || !route.skills.includes(route.router)
    || route.skills.some(name => typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)))
    throw new Error('漫剧制作内置 Skill 清单无效')
  const unsupported = names.filter(name => !route.skills.includes(name))
  if (unsupported.length) throw new Error(`漫剧制作不能同时加载 ${unsupported.join('、')}；请先退出漫剧制作再选择其他 Skill。`)
  // 全部读回成功后再登记，避免坏包留下半套已注册状态。
  const skills = await Promise.all(route.skills.map(async name => {
    const base = join(directory, name)
    const content = await readFile(join(base, 'SKILL.md'), 'utf8')
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || ''
    const actualName = frontmatter.match(/^name:\s*([^\r\n]+)$/m)?.[1]?.trim()
    if (actualName !== name) throw new Error(`漫剧制作内置 Skill 身份不符：${name}`)
    return {
      name,
      source: 'bundled',
      path: join(base, 'SKILL.md'),
      description: frontmatter.match(/^description:\s*([^\r\n]+)$/m)?.[1]?.trim().replace(/^"|"$/g, '') || name,
      content,
      resourceBase: { kind: 'directory', path: base },
      invocation: { userInvocable: true, modelInvocable: name !== route.router },
    }
  }))
  const disposers = []
  const dispose = async () => { for (const release of disposers.splice(0).reverse()) await release() }
  try {
    for (const skill of skills) disposers.push(rec.handle.agent.ctx.skills.register(skill))
    return dispose
  } catch (error) {
    await dispose()
    throw error
  }
}

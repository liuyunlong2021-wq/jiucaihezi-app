import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isMemoryProjectMutationBlocked } from '../memoryProjectPaths'
import {
  assertSkillDraftPath,
  hashSkillDraftDirectory,
  readSkillDraft,
  isSkillDraftPath,
  skillDraftDirectoryName,
  skillDraftPath,
  type SkillDraftFiles,
} from '../skillDraftPath'
import { createSkillDraftFiles } from '@/services/projectFileService'

/** 用内存 Map 顶掉 ProjectFileService：端口只暴露路径与文本，假实现几行就够。 */
function createFiles(entries: Record<string, string>): SkillDraftFiles {
  const files = new Map(Object.entries(entries))
  return {
    async list(directory) {
      return [...files.keys()].filter(path => path.startsWith(`${directory}/`))
    },
    async readText(path) {
      const content = files.get(path)
      if (content === undefined) throw new Error(`找不到文件: ${path}`)
      return content
    },
    async hashFile(path) {
      const content = files.get(path)
      if (content === undefined) throw new Error(`找不到文件: ${path}`)
      const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    },
  }
}

const DRAFT = '.raw/jc-media/文档/skill-jc-minimax-fenjing'

test('草稿路径按 skill id 生成，与中央 Skill 的 id 规范一致', () => {
  assert.equal(skillDraftDirectoryName('JC_Minimax Fenjing'), 'skill-jc-minimax-fenjing')
  assert.equal(skillDraftDirectoryName('preset_skill-creator'), 'skill-skill-creator')
  assert.equal(skillDraftPath('jc-minimax-fenjing'), DRAFT)
  assert.throws(() => skillDraftDirectoryName('   '), /target_skill_id/)
})

test('草稿路径必须在文档区里，目录名必须是 skill-*', () => {
  assert.equal(assertSkillDraftPath(DRAFT), DRAFT)
  assert.equal(assertSkillDraftPath(`${DRAFT}/`), DRAFT)
  assert.equal(assertSkillDraftPath(`./${DRAFT}`), DRAFT)
  // 多写了尾段按草稿目录处理，不为一次笔误白跑一个来回
  assert.equal(assertSkillDraftPath(`${DRAFT}/SKILL.md`), DRAFT)
  assert.equal(assertSkillDraftPath(`${DRAFT}/references/a.md`), DRAFT)

  assert.throws(() => assertSkillDraftPath(''), /draft_path/)
  assert.throws(() => assertSkillDraftPath('.raw/jc-media/文档/其他/x.md'), /skill-/)
  assert.throws(() => assertSkillDraftPath('wiki/skill-x/SKILL.md'), /jc-media\/文档/)
  assert.throws(() => assertSkillDraftPath(`${DRAFT}/../../../../etc/passwd`), /\.\./)
  assert.throws(() => assertSkillDraftPath('.raw/jc-media/文档/skill-'), /skill-/)

  assert.equal(isSkillDraftPath(DRAFT), true)
  assert.equal(isSkillDraftPath('wiki/skill-x'), false)
})

test('草稿落点是可写的文本路径（合同里唯一需要守的规则）', () => {
  // 写入侧靠的就是这一条：回归时它会先红
  assert.equal(isMemoryProjectMutationBlocked(`${DRAFT}/SKILL.md`, 'text'), false)
  assert.equal(isMemoryProjectMutationBlocked(`${DRAFT}/references/a.md`, 'text'), false)
  // 文档区的子目录（草稿目录）归用户/模型管：建删都不该被拦，
  // 否则模型 mkdir 草稿目录时只会拿到「系统骨架…只能由 App 管理」这种误导报错。
  assert.equal(isMemoryProjectMutationBlocked(DRAFT, 'directory'), false)
  // 骨架目录自己仍然只有 App 能建删；对话记录任何写操作都禁止
  assert.equal(isMemoryProjectMutationBlocked('.raw/jc-media/文档', 'directory'), true)
  assert.equal(isMemoryProjectMutationBlocked('.raw/jc-media/图片', 'directory'), true)
  assert.equal(isMemoryProjectMutationBlocked('.raw/对话记录/x.md', 'text'), true)
})

test('读回草稿：SKILL.md 是正文，其余文本都是 references，iteration 不算包内容', async () => {
  const files = createFiles({
    [`${DRAFT}/SKILL.md`]: '# 分镜 Skill',
    [`${DRAFT}/references/checklist.md`]: '- [ ] 节奏',
    [`${DRAFT}/scripts/run.py`]: 'print(1)',
    [`${DRAFT}/iteration-1/benchmark.json`]: '{}',
    [`${DRAFT}/.DS_Store`]: '\ufffdbinary\ufffd',
  })

  const draft = await readSkillDraft(DRAFT, files)

  assert.equal(draft.skillMd, '# 分镜 Skill')
  assert.deepEqual(draft.references.map(reference => reference.path), ['references/checklist.md', 'scripts/run.py'])
  assert.deepEqual(draft.files, ['SKILL.md', 'references/checklist.md', 'scripts/run.py'])
})

test('草稿没有 SKILL.md 时报错并说清怎么办', async () => {
  const files = createFiles({ [`${DRAFT}/references/a.md`]: 'x' })
  await assert.rejects(() => readSkillDraft(DRAFT, files), /没有 SKILL\.md/)
})

test('草稿读写口只吐文件：list 会把目录一起返回，带着目录去读会报「读取路径必须是文件」', async () => {
  const entries = [
    { path: DRAFT, isDirectory: true },
    { path: `${DRAFT}/references`, isDirectory: true },
    { path: `${DRAFT}/SKILL.md`, isDirectory: false },
    { path: `${DRAFT}/references/style.md`, isDirectory: false },
    { path: `${DRAFT}/iteration-1`, isDirectory: true },
  ]
  const files = createSkillDraftFiles(
    /** 只用到 list / readTextAt / hashFile 三个方法。 */
    {
      async list() {
        return entries.map(entry => ({ ...entry, owner: 'p', runtime: 'desktop' as const, name: entry.path, kind: 'document' as const }))
      },
      async readTextAt(_owner: string, path: string) {
        if (entries.some(entry => entry.path === path && entry.isDirectory))
          throw new Error(`读取路径必须是文件: ${path}`)
        return { content: `# ${path}`, size: 1, truncated: false }
      },
      async hashFile(resource: { path: string }) {
        return `hash:${resource.path}`
      },
    } as never,
    'p',
  )

  assert.deepEqual(await files.list(DRAFT), [`${DRAFT}/SKILL.md`, `${DRAFT}/references/style.md`])
  // 修复前这里会抛「读取路径必须是文件」：目录被当成文件去读了
  const draft = await readSkillDraft(DRAFT, files)
  assert.equal(draft.skillMd, `# ${DRAFT}/SKILL.md`)
  assert.deepEqual(draft.references.map(reference => reference.path), ['references/style.md'])
})

test('冻结哈希：内容变则哈希变，路径顺序不影响结果', async () => {
  const base = {
    [`${DRAFT}/SKILL.md`]: '# A',
    [`${DRAFT}/references/a.md`]: 'a',
    [`${DRAFT}/references/b.md`]: 'b',
  }
  const hash = await hashSkillDraftDirectory(DRAFT, createFiles(base))

  assert.equal(await hashSkillDraftDirectory(DRAFT, createFiles({ ...base })), hash, '同内容必须同哈希')
  assert.notEqual(await hashSkillDraftDirectory(DRAFT, createFiles({ ...base, [`${DRAFT}/SKILL.md`]: '# B' })), hash)
  assert.notEqual(await hashSkillDraftDirectory(DRAFT, createFiles({ ...base, [`${DRAFT}/references/c.md`]: 'c' })), hash)
  assert.notEqual(await hashSkillDraftDirectory(DRAFT, createFiles({
    [`${DRAFT}/SKILL.md`]: '# A',
    [`${DRAFT}/references/a.md`]: 'a',
  })), hash, '删文件必须改变哈希')

  // 评审产物不算包内容，改它不该影响安装卡
  assert.equal(
    await hashSkillDraftDirectory(DRAFT, createFiles({ ...base, [`${DRAFT}/iteration-1/x.json`]: '1' })),
    hash,
  )

  await assert.rejects(() => hashSkillDraftDirectory(DRAFT, createFiles({})), /空的/)
})

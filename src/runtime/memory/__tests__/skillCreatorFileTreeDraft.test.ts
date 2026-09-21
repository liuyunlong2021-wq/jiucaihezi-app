import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { DirectToolCall } from '@/runtime/direct/directTypes'
import { getSkillBuilderDraft } from '@/utils/skillBuilderTools'
import type { SkillDraftFiles } from '@/utils/skillDraftPath'
import { executeSkillCreatorToolCall } from '../skillCreatorToolExecutor'

const DRAFT_DIR = '.raw/jc-media/文档/skill-demo-skill'
const SKILL_MD = `---\nname: demo-skill\ndescription: 用来验证文件树草稿的示例 Skill。\n---\n\n# Demo\n\n按用户要求执行。`

function call(name: string, args: Record<string, unknown>): DirectToolCall {
  return { id: `call_${name}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }
}

/** 用内存 Map 顶掉 ProjectFileService。 */
function draftFiles(entries: Record<string, string>): SkillDraftFiles {
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

function context(sessionId: string, files: SkillDraftFiles) {
  return { agentId: 'skill-creator', sessionId, files }
}

test('草稿在文件树里时，校验按 draft_path 读回', async () => {
  const files = draftFiles({
    [`${DRAFT_DIR}/SKILL.md`]: SKILL_MD,
    [`${DRAFT_DIR}/references/style.md`]: '# 风格',
  })

  const result = JSON.parse(await executeSkillCreatorToolCall(
    call('skill_creator_validate', { draft_path: DRAFT_DIR }),
    context('file-tree-validate', files),
  ))

  assert.equal(result.status, 'ok')
  assert.equal(result.draft_id, 'skill-demo-skill')
  assert.equal(result.revision, 1)
  assert.match(result.content_hash, /^[0-9a-f]{64}$/)
})

test('草稿缺 SKILL.md 时给出可自救的报错，不报文件系统内部错误', async () => {
  const files = draftFiles({ [`${DRAFT_DIR}/references/style.md`]: '# 风格' })

  const result = JSON.parse(await executeSkillCreatorToolCall(
    call('skill_creator_validate', { draft_path: DRAFT_DIR }),
    context('file-tree-missing-entry', files),
  ))

  assert.equal(result.status, 'error')
  assert.match(result.message, /没有 SKILL\.md/)
})

test('draft_path 优先于 draft_id，不再依赖模型回传的标识', async () => {
  const files = draftFiles({ [`${DRAFT_DIR}/SKILL.md`]: SKILL_MD })

  const result = JSON.parse(await executeSkillCreatorToolCall(
    call('skill_creator_validate', { draft_id: 'draft_不存在', draft_path: DRAFT_DIR }),
    context('file-tree-wins', files),
  ))

  assert.equal(result.status, 'ok')
})

test('草稿路径越界时拒绝，并说清草稿该放哪', async () => {
  const files = draftFiles({ [`${DRAFT_DIR}/SKILL.md`]: SKILL_MD })

  const result = JSON.parse(await executeSkillCreatorToolCall(
    call('skill_creator_validate', { draft_path: 'wiki/skill-demo-skill' }),
    context('file-tree-outside', files),
  ))

  assert.equal(result.status, 'error')
  assert.match(result.message, /jc-media\/文档/)
})

test('没有文件读写口时明确报不可用，而不是悄悄当成空草稿', async () => {
  const result = JSON.parse(await executeSkillCreatorToolCall(
    call('skill_creator_validate', { draft_path: DRAFT_DIR }),
    { agentId: 'skill-creator', sessionId: 'file-tree-no-port' },
  ))

  assert.equal(result.status, 'error')
  assert.equal(result.errorCode, 'SKILL_DRAFT_FILES_UNAVAILABLE')
})

test('出卡会把文件树草稿冻结成受控快照，安装卡读得回同一份内容', async () => {
  const files = draftFiles({
    [`${DRAFT_DIR}/SKILL.md`]: SKILL_MD,
    [`${DRAFT_DIR}/references/style.md`]: '# 风格',
  })

  const shared = context('file-tree-save', files)
  // 真实流程：先校验，再出卡
  await executeSkillCreatorToolCall(call('skill_creator_validate', { draft_path: DRAFT_DIR }), shared)
  const result = JSON.parse(await executeSkillCreatorToolCall(call('save_skill', { draft_path: DRAFT_DIR }), shared))
  assert.equal(result.status, 'prepared', JSON.stringify(result))
  assert.equal(result.draft_path, DRAFT_DIR)
  assert.equal(result.install_token.schemaVersion, 2)
  assert.equal(result.install_token.targetSkillId, 'demo-skill')
  assert.match(result.install_token.draftId, /^draft_/, '冻结快照必须有自己的 draftId，安装走快照而不是模型给的路径')

  // 安装卡解析读的就是这份快照，必须能按 token 读回同一份内容
  const frozen = await getSkillBuilderDraft(result.install_token.draftId, result.install_token.sessionId)
  assert.ok(frozen, '冻结快照没落进受控草稿库')
  assert.equal(frozen.skillMd, SKILL_MD)
  assert.equal(frozen.revision, result.install_token.revision)
  assert.equal(frozen.contentHash, result.install_token.contentHash)
  assert.deepEqual(frozen.references.map(reference => reference.path), ['references/style.md'])
})

test('出卡后草稿被改动不影响已冻结的安装卡', async () => {
  const files = draftFiles({ [`${DRAFT_DIR}/SKILL.md`]: SKILL_MD })
  const shared = context('file-tree-frozen', files)
  await executeSkillCreatorToolCall(call('skill_creator_validate', { draft_path: DRAFT_DIR }), shared)
  const first = JSON.parse(await executeSkillCreatorToolCall(call('save_skill', { draft_path: DRAFT_DIR }), shared))
  assert.equal(first.status, 'prepared', JSON.stringify(first))
  files.list = async directory => [...(await draftFiles({ [`${DRAFT_DIR}/SKILL.md`]: `${SKILL_MD}\n\n改动` }).list(directory))]

  const frozen = await getSkillBuilderDraft(first.install_token.draftId, first.install_token.sessionId)
  assert.equal(frozen?.skillMd, SKILL_MD, '冻结的是快照，用户之后改文件树不该影响已出的卡')
})

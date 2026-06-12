import { resolveApiConfig, buildHeaders } from './api'
import { useFileStore } from '@/composables/useFileStore'
import { useVaultStore } from '@/stores/vaultStore'
import { sanitizeSensitiveText } from './sanitizeSensitiveText'

/** 知识提炼前脱敏：移除可能的 API Key、Token、密码等敏感信息 */
function sanitizeBrainInput(text: string): string {
  return sanitizeSensitiveText(text)
}

const ORGANIZE_PROMPT = `你是知识编译引擎（llm-wiki-skill）。从以下对话记录中提取可复用的结构化知识。

## 输出要求
输出一个JSON数组，每个知识点是一个对象：
[
  {
    "title": "知识点标题（一句话描述）",
    "content": "具体内容（规则/方法/示例/模式）",
    "topic": "所属Skill或主题",
    "type": "rule | reference | example | pattern",
    "folder": "persona | work | history"
  }
]

## 提取原则
- 只提取可复用的知识，忽略一次性对话
- persona: 人设、沟通风格、语气相关的规则
- work: 业务流、规范、输出格式要求
- history: 对话沉淀的具体素材或事实
- 用 JSON 格式返回，不可包含其他无关对话`

export async function distillHistoryToWiki(historyFile: any, fallbackVaultId?: string) {
  const fileStore = useFileStore()
  const vaultStore = useVaultStore()
  let config: any = null
  try { config = await resolveApiConfig() } catch { throw new Error('请先登录韭菜盒子账号') }

  const text = sanitizeBrainInput(historyFile.content || '')
  const agentId = historyFile.metadata?.agentId || '未分配Skill'
  const vaultId = historyFile.vaultId || historyFile.metadata?.vaultId || fallbackVaultId
  if (!vaultId) {
    throw new Error('请先绑定知识库，再提炼这段会话')
  }
  if (vaultStore.vaults.length === 0) {
    await vaultStore.loadAll()
  }
  const vaultName = vaultStore.vaults.find(v => v.id === vaultId)?.name || '项目知识库'

  const res = await fetch(`${config.apiBase}/v1/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify({
      model: config.model || 'claude-sonnet-4-6',
      messages: [
        { role: 'system', content: ORGANIZE_PROMPT },
        { role: 'user', content: text.slice(0, 6000) },
      ],
      temperature: 0.3,
      max_tokens: 2000,
      stream: false,
    }),
  })

  if (!res.ok) throw new Error('API 调用失败')
  const data = await res.json()
  const content = data.choices?.[0]?.message?.content || ''

  const cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '')
  const jsonMatch = cleaned.match(/\[[\s\S]*\]/)

  if (jsonMatch) {
    let entries: any[] = []
    try {
      entries = JSON.parse(jsonMatch[0])
    } catch {
      throw new Error('AI 返回内容不是有效 JSON')
    }
    if (Array.isArray(entries) && entries.length > 0) {
      const allKnowledge = await fileStore.loadByCategory('knowledge', vaultId)
      // 1. 获取或创建 Vault 根文件夹
      let rootFolder = allKnowledge.find(f => f.name === vaultName && f.vaultId === vaultId && f.mimeType === 'folder')
      if (!rootFolder) {
        rootFolder = await fileStore.addFile({
          category: 'knowledge',
          name: vaultName,
          content: '',
          mimeType: 'folder',
          size: 0,
          vaultId,
          metadata: { isFolder: true, children: [], kind: 'vault-root' },
        })
      }

      const children = new Set((rootFolder.metadata?.children as string[]) || [])

      let createdCount = 0
      for (const entry of entries) {
        if (!entry.content && !entry.title) continue

        const subFolderName = entry.folder || 'history'
        // 2. 获取或创建子文件夹 (persona, work, history)
        let subFolder = (await fileStore.loadByCategory('knowledge', vaultId)).find(f =>
          f.name === subFolderName &&
          f.folderId === rootFolder!.id &&
          f.vaultId === vaultId &&
          f.mimeType === 'folder'
        )
        if (!subFolder) {
          subFolder = await fileStore.addFile({
            category: 'knowledge',
            name: subFolderName,
            content: '',
            mimeType: 'folder',
            size: 0,
            folderId: rootFolder.id,
            vaultId,
            metadata: { isFolder: true, children: [] },
          })
          children.add(subFolder.id)
        }

        // 3. 创建知识点文件
        const subChildren = new Set((subFolder.metadata?.children as string[]) || [])
        const kbFile = await fileStore.addFile({
          category: 'knowledge',
          name: entry.title || '知识点',
          content: entry.content || '',
          mimeType: 'text/markdown',
          size: new Blob([entry.content || '']).size,
          folderId: subFolder.id,
          vaultId,
          kind: 'page',
          sourceSessionId: historyFile.metadata?.originalId,
          skillId: agentId,
          topic: entry.topic || vaultName,
          indexed: true,
          metadata: {
            type: entry.type,
            sourceSessionId: historyFile.metadata?.originalId,
            sourceFileId: historyFile.id,
            agentId,
            vaultId,
          },
        })

        subChildren.add(kbFile.id)
        await fileStore.updateFile(subFolder.id, { metadata: { ...subFolder.metadata, children: Array.from(subChildren) } })
        createdCount++
      }

      await fileStore.updateFile(rootFolder.id, { metadata: { ...rootFolder.metadata, children: Array.from(children) } })
      return createdCount
    }
  }
  return 0
}

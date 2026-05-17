import { useFileStore } from '@/composables/useFileStore'
import { useAgentStore } from '@/stores/agentStore'
import { getAll } from '@/utils/idb'
import { planLegacyKnowledgeMigration } from '@/utils/legacyVaultMigration'

export async function runAutoMigrations() {
  const fileStore = useFileStore()
  const agentStore = useAgentStore()

  // 标志位只用于控制启动日志；同步方法本身是幂等的。
  const migrated = localStorage.getItem('jc_v6_migrated')

  try {
    const historyCount = await fileStore.syncHistoryFromSessions()
    const agentCount = await fileStore.syncSkillsFromStore(agentStore.loadSkills())
    const knowledgeFiles = await fileStore.loadByCategory('knowledge')
    const conversations = await getAll('conversations') as Array<{ id: string; vaultId?: string | null }>
    const legacyPlan = planLegacyKnowledgeMigration(knowledgeFiles, conversations)
    for (const update of legacyPlan.updates) {
      await fileStore.updateFile(update.id, update.patch)
    }
    localStorage.setItem('jc_v6_migrated', '1')
    localStorage.setItem('jc_legacy_knowledge_migration_count', String(legacyPlan.updates.length))
    if (migrated !== '1') {
      console.log(`[Migration] 成功同步了 ${historyCount} 个历史会话、${agentCount} 个搭子，并标记 ${legacyPlan.updates.length} 条旧知识。`)
    }
  } catch (e) {
    console.error('[Migration] 数据迁移失败:', e)
  }
}

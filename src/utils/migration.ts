import { useFileStore } from '@/composables/useFileStore'
import { useAgentStore } from '@/stores/agentStore'

export async function runAutoMigrations() {
  if (localStorage.getItem('jc_v6_migrated') === '1') return

  const fileStore = useFileStore()
  const agentStore = useAgentStore()

  try {
    const historyCount = await fileStore.syncHistoryFromSessions()
    const agentCount = await fileStore.syncSkillsFromStore(agentStore.loadSkills())
    localStorage.setItem('jc_v6_migrated', '1')
    console.log(`[Migration] 成功同步了 ${historyCount} 个历史会话、${agentCount} 个Skill。`)
  } catch (e) {
    console.error('[Migration] 数据迁移失败:', e)
  }
}

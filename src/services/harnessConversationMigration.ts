import { queryDeepSeekHarnessConversations, type DeepSeekHarnessInput } from './deepSeekHarness'

/** Read old browser metadata once. Successful durable import retires the old directory key. */
export async function migrateHarnessConversationPreferences(input: DeepSeekHarnessInput, storage: Storage = localStorage, query = queryDeepSeekHarnessConversations) {
  const key = `jc:harness-conversations:${input.cwd}`
  const raw = storage.getItem(key)
  if (raw === null) return
  const entries = JSON.parse(raw)
  if (!Array.isArray(entries)) throw new Error('旧对话偏好格式无效，原数据已保留')
  await query(input, { action: 'import', entries })
  storage.removeItem(key)
  storage.removeItem(`jc:harness-conversations-recovered:v1:${input.cwd}`)
}

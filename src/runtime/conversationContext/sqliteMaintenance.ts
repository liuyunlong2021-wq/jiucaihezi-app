export interface SqliteMaintenanceDecisionInput {
  isUserActive: boolean
  deletedSessionCount: number
}

export interface SqliteMaintenanceDecision {
  run: boolean
  reason: string
}

export function shouldRunSqliteMaintenance(input: SqliteMaintenanceDecisionInput): SqliteMaintenanceDecision {
  if (input.isUserActive) return { run: false, reason: 'user_active' }
  if (input.deletedSessionCount <= 0) return { run: false, reason: 'nothing_to_maintain' }
  return { run: true, reason: 'idle_with_deleted_sessions' }
}

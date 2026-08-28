export type TaskStatus = 'needs_observation' | 'ready_to_execute' | 'complete' | 'failed'

export interface TaskRead {
  id: string
  agent: string
  kind: string
  arguments: Record<string, unknown>
}

export interface TaskAction {
  id: string
  agent: string
  kind: string
  arguments: Record<string, unknown>
  dependsOn?: string[]
  requiresApproval?: boolean
}

export interface TaskObservation {
  id: string
  readId?: string
  actionId?: string
  agent: string
  ok: boolean
  result?: unknown
  error?: { code: string; message: string }
}

export interface TaskEnvelope {
  version: 1
  runId: string
  source: 'model' | 'program'
  status: TaskStatus
  capabilities: string[]
  reads: TaskRead[]
  actions: TaskAction[]
  observations?: TaskObservation[]
  answer?: string
  errors?: Array<{ code: string; message: string; actionId?: string }>
  receipt?: {
    ok: boolean
    completedActionIds: string[]
    failedActionIds: string[]
  }
}

export interface TaskAgentDefinition {
  id: string
  readKinds?: readonly string[]
  actionKinds?: readonly string[]
}

export function validateTaskEnvelope(
  value: unknown,
  agents: readonly TaskAgentDefinition[],
  selectedCapabilities: readonly string[],
  source: 'model' | 'program' = 'model',
): TaskEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('TaskEnvelope 必须是对象')
  const input = value as Record<string, unknown>
  if (input.version !== 1) throw new Error('TaskEnvelope version 不支持')
  const runId = string(input.runId, 'runId')
  if (input.source !== source) throw new Error('TaskEnvelope source 与可信来源不匹配')
  if (!isStatus(input.status)) throw new Error('TaskEnvelope status 无效')
  const capabilities = strings(input.capabilities, 'capabilities')
  const selected = new Set(selectedCapabilities)
  if (capabilities.some(capability => !selected.has(capability))) throw new Error('TaskEnvelope 请求了未选择的能力')
  const registry = new Map(agents.map(agent => [agent.id, agent]))
  const reads = items(input.reads, 'reads').map((item, index) => parseRead(item, index, registry, selected))
  const actions = items(input.actions, 'actions').map((item, index) => parseAction(item, index, registry, selected))
  const ids = new Set([...reads, ...actions].map(item => item.id))
  if (ids.size !== reads.length + actions.length) throw new Error('TaskEnvelope id 重复')
  for (const action of actions) {
    for (const dependency of action.dependsOn || []) {
      if (!actions.some(candidate => candidate.id === dependency)) throw new Error(`依赖动作不存在: ${dependency}`)
    }
  }
  orderTaskActions(actions)
  const capabilitySet = new Set(capabilities)
  if ([...reads, ...actions].some(item => !capabilitySet.has(item.agent))) throw new Error('动作未声明所属能力')
  if (input.status === 'needs_observation' && actions.length) throw new Error('观察阶段不得包含副作用动作')
  if (input.status === 'complete' && source === 'model' && actions.length)
    throw new Error('模型 complete 不得包含待执行动作')
  if (source === 'model' && input.receipt !== undefined) throw new Error('模型不得填充 receipt')
  if (source === 'model' && input.errors !== undefined) throw new Error('模型不得填充 errors')
  const envelope: TaskEnvelope = { version: 1, runId, source, status: input.status, capabilities, reads, actions }
  if (typeof input.answer === 'string') envelope.answer = input.answer
  if (source === 'program' && input.observations !== undefined)
    envelope.observations = parseObservations(input.observations)
  if (source === 'program' && input.errors !== undefined)
    envelope.errors = parseErrors(input.errors)
  if (source === 'program' && input.receipt !== undefined)
    envelope.receipt = parseReceipt(input.receipt)
  if (envelope.status === 'complete' && !envelope.answer?.trim()) throw new Error('complete 必须包含 answer')
  if (source === 'program' && (envelope.status === 'complete' || envelope.status === 'failed') && !envelope.receipt)
    throw new Error('程序终态必须包含 receipt')
  if (envelope.status === 'failed' && !envelope.errors?.length) throw new Error('failed 必须包含 errors')
  if (source === 'model' && input.observations !== undefined) throw new Error('模型不得填充 observations')
  if (source === 'program' && envelope.observations) validateObservationReferences(envelope, agents)
  if (source === 'program' && envelope.receipt) validateReceiptReferences(envelope)
  return envelope
}

export function orderTaskActions(actions: readonly TaskAction[]): TaskAction[] {
  const byId = new Map(actions.map(action => [action.id, action]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const ordered: TaskAction[] = []
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error('TaskEnvelope 依赖形成环')
    if (visited.has(id)) return
    const action = byId.get(id)
    if (!action) throw new Error(`依赖动作不存在: ${id}`)
    visiting.add(id)
    for (const dependency of action.dependsOn || []) visit(dependency)
    visiting.delete(id)
    visited.add(id)
    ordered.push(action)
  }
  for (const action of actions) visit(action.id)
  return ordered
}

function parseRead(value: unknown, index: number, registry: Map<string, TaskAgentDefinition>, selected: Set<string>): TaskRead {
  const row = object(value, `reads[${index}]`)
  const agent = string(row.agent, `reads[${index}].agent`)
  if (!selected.has(agent)) throw new Error(`读取使用了未选择的能力: ${agent}`)
  const definition = registry.get(agent)
  if (!definition) throw new Error(`未知 Agent: ${agent}`)
  const kind = string(row.kind, `reads[${index}].kind`)
  if (definition.readKinds && !definition.readKinds.includes(kind)) throw new Error(`Agent 不支持读取动作: ${agent}.${kind}`)
  return { id: string(row.id, `reads[${index}].id`), agent, kind, arguments: record(row.arguments, `reads[${index}].arguments`) }
}

function parseAction(value: unknown, index: number, registry: Map<string, TaskAgentDefinition>, selected: Set<string>): TaskAction {
  const row = object(value, `actions[${index}]`)
  const agent = string(row.agent, `actions[${index}].agent`)
  if (!selected.has(agent)) throw new Error(`动作使用了未选择的能力: ${agent}`)
  const definition = registry.get(agent)
  if (!definition) throw new Error(`未知 Agent: ${agent}`)
  const kind = string(row.kind, `actions[${index}].kind`)
  if (definition.actionKinds && !definition.actionKinds.includes(kind)) throw new Error(`Agent 不支持动作: ${agent}.${kind}`)
  const dependsOn = row.dependsOn === undefined ? undefined : strings(row.dependsOn, `actions[${index}].dependsOn`)
  return { id: string(row.id, `actions[${index}].id`), agent, kind, arguments: record(row.arguments, `actions[${index}].arguments`), ...(dependsOn ? { dependsOn } : {}), ...(typeof row.requiresApproval === 'boolean' ? { requiresApproval: row.requiresApproval } : {}) }
}

function isStatus(value: unknown): value is TaskStatus {
  return value === 'needs_observation' || value === 'ready_to_execute' || value === 'complete' || value === 'failed'
}

function items(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} 必须是数组`)
  return value
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} 无效`)
  return value as Record<string, unknown>
}

function record(value: unknown, field: string): Record<string, unknown> {
  return object(value, field)
}

function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} 必须是非空字符串`)
  return value.trim()
}

function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) throw new Error(`${field} 必须是字符串数组`)
  return value.map(item => String(item).trim())
}

function parseObservations(value: unknown): TaskObservation[] {
  if (!Array.isArray(value)) throw new Error('observations 必须是数组')
  const ids = new Set<string>()
  return value.map((item, index) => {
    const row = object(item, `observations[${index}]`)
    if (typeof row.ok !== 'boolean') throw new Error(`observations[${index}].ok 必须是布尔值`)
    const observation: TaskObservation = {
      id: string(row.id, `observations[${index}].id`),
      agent: string(row.agent, `observations[${index}].agent`),
      ok: row.ok,
    }
    if (ids.has(observation.id)) throw new Error(`observations[${index}].id 重复`)
    ids.add(observation.id)
    if (row.readId !== undefined) observation.readId = string(row.readId, `observations[${index}].readId`)
    if (row.actionId !== undefined) observation.actionId = string(row.actionId, `observations[${index}].actionId`)
    if (row.result !== undefined) observation.result = row.result
    if (row.error !== undefined) {
      const error = object(row.error, `observations[${index}].error`)
      observation.error = {
        code: string(error.code, `observations[${index}].error.code`),
        message: string(error.message, `observations[${index}].error.message`),
      }
    }
    return observation
  })
}

function parseErrors(value: unknown): NonNullable<TaskEnvelope['errors']> {
  if (!Array.isArray(value)) throw new Error('errors 必须是数组')
  return value.map((item, index) => {
    const row = object(item, `errors[${index}]`)
    return {
      code: string(row.code, `errors[${index}].code`),
      message: string(row.message, `errors[${index}].message`),
      ...(row.actionId === undefined ? {} : { actionId: string(row.actionId, `errors[${index}].actionId`) }),
    }
  })
}

function parseReceipt(value: unknown): NonNullable<TaskEnvelope['receipt']> {
  const row = object(value, 'receipt')
  if (typeof row.ok !== 'boolean') throw new Error('receipt.ok 必须是布尔值')
  return {
    ok: row.ok,
    completedActionIds: strings(row.completedActionIds, 'receipt.completedActionIds'),
    failedActionIds: strings(row.failedActionIds, 'receipt.failedActionIds'),
  }
}

function validateObservationReferences(envelope: TaskEnvelope, agents: readonly TaskAgentDefinition[]): void {
  const reads = new Map(envelope.reads.map(read => [read.id, read]))
  const actions = new Map(envelope.actions.map(action => [action.id, action]))
  const registry = new Map(agents.map(agent => [agent.id, agent]))
  for (const observation of envelope.observations || []) {
    const read = observation.readId ? reads.get(observation.readId) : undefined
    const action = observation.actionId ? actions.get(observation.actionId) : undefined
    if (!read && !action) throw new Error(`observation ${observation.id} 未引用真实 read/action`)
    if (read && action) throw new Error(`observation ${observation.id} 不能同时引用 read/action`)
    const target = read || action!
    if (target.agent !== observation.agent) throw new Error(`observation ${observation.id} 的 Agent 不匹配`)
    if (!registry.has(observation.agent)) throw new Error(`observation ${observation.id} 使用未知 Agent`)
  }
}

function validateReceiptReferences(envelope: TaskEnvelope): void {
  const actionIds = new Set(envelope.actions.map(action => action.id))
  const completed = new Set(envelope.receipt?.completedActionIds || [])
  const failed = new Set(envelope.receipt?.failedActionIds || [])
  for (const id of [...completed, ...failed])
    if (!actionIds.has(id)) throw new Error(`receipt 引用了不存在的 action: ${id}`)
  for (const id of completed)
    if (failed.has(id)) throw new Error(`receipt action 同时成功和失败: ${id}`)
  if (envelope.receipt?.ok && failed.size) throw new Error('receipt.ok=true 不能包含失败 action')
}

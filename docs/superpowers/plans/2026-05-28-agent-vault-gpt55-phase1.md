# Agent/Vault GPT-5.5 Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make selected Skill usage deterministic, prevent Superpower auto-routing from silently overriding explicit selection, and expose a minimal per-run trace for agent/vault context assembly.

**Architecture:** Add small runtime helpers instead of expanding `useChat.ts` further. `agentRuntime.ts` resolves full Skill content and lock policy; `runTrace.ts` stores a lightweight, UI-safe trace of the last request. `ChatPanel.vue` uses the policy before routing, and `useChat.ts` records trace metadata around existing prompt assembly without changing provider behavior.

**Tech Stack:** Vue 3, Pinia, TypeScript, Node test runner through esbuild-bundled focused tests.

---

## Execution Note

The ideal Superpowers flow would create a fresh git worktree. This repository currently has many existing uncommitted changes across chat, canvas, Tauri, and settings files. Creating a fresh worktree would not include that current state, so Phase 1 is intentionally scoped to the current worktree and limited to the files below.

## Files

- Create: `src/utils/agentRuntime.ts`
- Create: `src/utils/runTrace.ts`
- Create: `src/utils/__tests__/agentRuntime.test.ts`
- Create: `src/utils/__tests__/runTrace.test.ts`
- Modify: `src/components/chat/ChatPanel.vue`
- Modify: `src/composables/useChat.ts`
- Modify: `package.json`
- Modify: `docs/sdd/agent-vault-gpt55-upgrade-design-draft.md`

## Task 1: Agent Runtime Policy

**Files:**
- Create: `src/utils/agentRuntime.ts`
- Test: `src/utils/__tests__/agentRuntime.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests**

Create `src/utils/__tests__/agentRuntime.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildExplicitAgentLockNotice,
  canAutoRouteAgent,
  createSkillRuntimeSpec,
  isSkillContentResolved,
  resolveAgentTier,
} from '../agentRuntime'
import type { SkillConfig } from '../../types/skill'

function skill(patch: Partial<SkillConfig> = {}): SkillConfig {
  return {
    id: 'skill_a',
    name: '写作搭子',
    description: '写作',
    triggers: ['写作'],
    skillContent: '## 角色\n你是写作搭子',
    references: [],
    examples: [],
    version: 1,
    source: 'user',
    createdAt: 1,
    updatedAt: 1,
    evolutionLog: [],
    ...patch,
  }
}

test('isSkillContentResolved rejects unresolved skill protocol placeholders', () => {
  assert.equal(isSkillContentResolved(skill({ skillContent: 'skill://foo/SKILL.md' })), false)
  assert.equal(isSkillContentResolved(skill({ skillContent: '## 角色\n完整内容' })), true)
})

test('createSkillRuntimeSpec includes tier, hash, summary and full skill content', () => {
  const spec = createSkillRuntimeSpec(skill())
  assert.equal(spec.id, 'skill_a')
  assert.equal(spec.tier, 'L1')
  assert.equal(spec.fullSkillMd, '## 角色\n你是写作搭子')
  assert.match(spec.contentHash, /^[a-f0-9]{16}$/)
  assert.equal(spec.summary, '写作')
})

test('resolveAgentTier treats missing tier as L1 and preserves L2', () => {
  assert.equal(resolveAgentTier(skill()), 'L1')
  assert.equal(resolveAgentTier(skill({ tier: 'L2' })), 'L2')
})

test('canAutoRouteAgent blocks auto routing for explicit L1 selection unless smart switching is enabled', () => {
  assert.equal(canAutoRouteAgent({ currentAgent: skill(), smartSwitchEnabled: false }), false)
  assert.equal(canAutoRouteAgent({ currentAgent: skill(), smartSwitchEnabled: true }), true)
  assert.equal(canAutoRouteAgent({ currentAgent: null, smartSwitchEnabled: false }), true)
})

test('canAutoRouteAgent allows L2 agents to run their internal routing', () => {
  assert.equal(canAutoRouteAgent({ currentAgent: skill({ tier: 'L2' }), smartSwitchEnabled: false }), true)
})

test('buildExplicitAgentLockNotice explains suggested switches without mutating selection', () => {
  assert.equal(
    buildExplicitAgentLockNotice(skill({ name: '写作搭子' }), '法律搭子'),
    '已锁定当前搭子「写作搭子」。如果想切换到「法律搭子」，请手动选择或开启智能切换。',
  )
})
```

- [ ] **Step 2: Add test to focused build**

In `package.json`, add `src/utils/__tests__/agentRuntime.test.ts` to `test:focused:build`, and add `/private/tmp/jc-focused-tests/utils/__tests__/agentRuntime.test.js` to `test:focused:run`.

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
pnpm run test:focused:build
```

Expected: FAIL because `src/utils/agentRuntime.ts` does not exist.

- [ ] **Step 4: Implement agent runtime helper**

Create `src/utils/agentRuntime.ts`:

```ts
import type { SkillConfig } from '@/types/skill'

export type AgentTier = 'L1' | 'L2'

export interface SkillRuntimeSpec {
  id: string
  name: string
  tier: AgentTier
  version: number
  source: SkillConfig['source']
  contentHash: string
  fullSkillMd: string
  summary: string
  triggers: string[]
}

export function resolveAgentTier(skill: SkillConfig | null | undefined): AgentTier {
  return skill?.tier === 'L2' ? 'L2' : 'L1'
}

export function isSkillContentResolved(skill: SkillConfig | null | undefined): boolean {
  const content = String(skill?.skillContent || '').trim()
  return Boolean(content) && !content.startsWith('skill://')
}

export function createSkillRuntimeSpec(skill: SkillConfig): SkillRuntimeSpec {
  const fullSkillMd = String(skill.skillContent || '')
  return {
    id: skill.id,
    name: skill.name,
    tier: resolveAgentTier(skill),
    version: skill.version || 1,
    source: skill.source,
    contentHash: hashText16(fullSkillMd),
    fullSkillMd,
    summary: skill.oneLineDesc || skill.description || '',
    triggers: [...(skill.triggers || [])],
  }
}

export function canAutoRouteAgent(input: {
  currentAgent: SkillConfig | null | undefined
  smartSwitchEnabled: boolean
}): boolean {
  if (!input.currentAgent) return true
  if (resolveAgentTier(input.currentAgent) === 'L2') return true
  return input.smartSwitchEnabled
}

export function buildExplicitAgentLockNotice(
  currentAgent: SkillConfig | null | undefined,
  suggestedName: string,
): string {
  const current = currentAgent?.name || '当前搭子'
  return `已锁定当前搭子「${current}」。如果想切换到「${suggestedName}」，请手动选择或开启智能切换。`
}

function hashText16(text: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 ^= code
    h1 = Math.imul(h1, 0x01000193) >>> 0
    h2 ^= code + i
    h2 = Math.imul(h2, 0x811c9dc5) >>> 0
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
pnpm run test:focused:build && pnpm run test:focused:run
```

Expected: PASS for the new agent runtime test and existing focused tests.

## Task 2: Run Trace Store

**Files:**
- Create: `src/utils/runTrace.ts`
- Test: `src/utils/__tests__/runTrace.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests**

Create `src/utils/__tests__/runTrace.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearLastRunTrace,
  getLastRunTrace,
  recordRunTrace,
} from '../runTrace'

test('recordRunTrace stores a sanitized latest run trace', () => {
  clearLastRunTrace()
  recordRunTrace({
    runId: 'run_1',
    timestamp: 1,
    model: 'gpt-5.5',
    runtime: 'chat-completions',
    selectedSkill: {
      id: 'skill_a',
      name: '写作搭子',
      tier: 'L1',
      hash: 'abc123',
    },
    selectedVault: {
      id: 'vault_a',
      name: '小说设定',
    },
    contextPlan: {
      mode: 'balanced',
      sections: [
        { name: 'system', tokens: 20 },
        { name: 'knowledge', tokens: 30 },
      ],
    },
    knowledgeHits: [
      { path: 'wiki/角色/主角.md', title: '主角', reason: '关键词命中', score: 12 },
    ],
    promptPreview: 'x'.repeat(3000),
  })

  const trace = getLastRunTrace()
  assert.equal(trace?.runId, 'run_1')
  assert.equal(trace?.selectedSkill?.name, '写作搭子')
  assert.equal(trace?.promptPreview.length, 2000)
  assert.equal(trace?.knowledgeHits[0].path, 'wiki/角色/主角.md')
})

test('clearLastRunTrace removes stored trace', () => {
  recordRunTrace({
    runId: 'run_2',
    timestamp: 2,
    model: 'gpt-5.5',
    runtime: 'responses',
    contextPlan: { mode: 'fast', sections: [] },
    knowledgeHits: [],
    promptPreview: 'short',
  })
  clearLastRunTrace()
  assert.equal(getLastRunTrace(), null)
})
```

- [ ] **Step 2: Add test to focused build**

In `package.json`, add `src/utils/__tests__/runTrace.test.ts` to `test:focused:build`, and add `/private/tmp/jc-focused-tests/utils/__tests__/runTrace.test.js` to `test:focused:run`.

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
pnpm run test:focused:build
```

Expected: FAIL because `src/utils/runTrace.ts` does not exist.

- [ ] **Step 4: Implement run trace helper**

Create `src/utils/runTrace.ts`:

```ts
export interface RunTrace {
  runId: string
  timestamp: number
  model: string
  runtime: 'chat-completions' | 'responses' | 'local'
  selectedSkill?: {
    id: string
    name: string
    tier: 'L1' | 'L2'
    hash: string
  }
  selectedVault?: {
    id: string
    name: string
  }
  contextPlan: {
    mode: 'fast' | 'balanced' | 'deep' | 'full-vault'
    sections: Array<{ name: string; tokens: number }>
  }
  knowledgeHits: Array<{
    path: string
    title: string
    reason: string
    score: number
  }>
  promptPreview: string
}

let lastRunTrace: RunTrace | null = null

export function recordRunTrace(trace: RunTrace): RunTrace {
  lastRunTrace = {
    ...trace,
    promptPreview: String(trace.promptPreview || '').slice(0, 2000),
    knowledgeHits: trace.knowledgeHits.slice(0, 20),
    contextPlan: {
      ...trace.contextPlan,
      sections: trace.contextPlan.sections.slice(0, 20),
    },
  }
  return lastRunTrace
}

export function getLastRunTrace(): RunTrace | null {
  return lastRunTrace
}

export function clearLastRunTrace(): void {
  lastRunTrace = null
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
pnpm run test:focused:build && pnpm run test:focused:run
```

Expected: PASS.

## Task 3: Wire Deterministic Agent Selection

**Files:**
- Modify: `src/components/chat/ChatPanel.vue`

- [ ] **Step 1: Import runtime helpers**

Add imports:

```ts
import { buildExplicitAgentLockNotice, canAutoRouteAgent, isSkillContentResolved } from '@/utils/agentRuntime'
```

- [ ] **Step 2: Add smart switch flag**

Add near other refs:

```ts
const smartAgentSwitchEnabled = ref(false)
```

- [ ] **Step 3: Block silent Superpower override**

Replace the auto-routing guard so it checks `canAutoRouteAgent`.

Expected behavior:

- No current agent: route can select one.
- Current L1 Skill: route cannot override unless `smartAgentSwitchEnabled` is true.
- Current L2 Agent: route can proceed because the Agent is the orchestrator.

When route suggests a different Skill while locked, emit a short notice using `buildExplicitAgentLockNotice`.

- [ ] **Step 4: Guard unresolved skill content before sending**

Before `sendMessage(...)`, if `agentStore.currentAgent` exists and `isSkillContentResolved(...)` is false, show an assistant message or status detail telling the user the搭子内容仍在加载, then return without sending.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm run test:focused
```

Expected: PASS.

## Task 4: Record Minimal Run Trace in useChat

**Files:**
- Modify: `src/composables/useChat.ts`

- [ ] **Step 1: Import helpers**

Add:

```ts
import { createSkillRuntimeSpec } from '@/utils/agentRuntime'
import { recordRunTrace } from '@/utils/runTrace'
```

- [ ] **Step 2: Record trace after knowledge recall and before provider call**

After final `systemPrompt` assembly and before local/chat runtime dispatch, record:

- run id
- model
- runtime type
- selected skill id/name/tier/hash if `agentId` is present
- selected vault id if present
- context sections for skill, knowledge, tools, long-form instruction
- prompt preview

- [ ] **Step 3: Run focused tests**

Run:

```bash
pnpm run test:focused
```

Expected: PASS.

## Task 5: Update Design Doc Status

**Files:**
- Modify: `docs/sdd/agent-vault-gpt55-upgrade-design-draft.md`

- [ ] **Step 1: Add Phase 1 execution note**

Add a short note that Phase 1 starts with deterministic Skill selection and RunTrace foundation.

- [ ] **Step 2: Verify docs and tests**

Run:

```bash
pnpm run test:focused
```

Expected: PASS.

## Self-Review

- Spec coverage: This plan implements Phase 1 only: deterministic搭子选择, Skill loading guard, and minimal RunTrace. It intentionally does not implement full VaultRuntimeIndex, Responses Runtime, or file-search integration.
- Placeholder scan: No TBD/TODO placeholders are present in executable steps.
- Type consistency: `AgentTier`, `SkillRuntimeSpec`, and `RunTrace` are defined before use.

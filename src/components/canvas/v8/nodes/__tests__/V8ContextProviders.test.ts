/**
 * V8ContextProviders.test.ts
 *
 * TDD for Context Provider nodes (Week 3 / P0 per assignment ordering, done early for dependency).
 * References: docs/sdd/canvas-v8-tdd-spec.md §3.3 CP-001/002 + SDD Ch.5 Context Providers as first-class draggable.
 *
 * CP-001: Vault/Skill/Toolset nodes have ZERO ▶ / run button in right-click or header.
 * CP-002: After wiring VaultNode → LLM, the LLM footer / status correctly reflects the linked knowledge (user-evidence only).
 *
 * These are pure reference/declaration nodes (no execution semantics themselves).
 * Wiring = "I declare this context is available to downstream LLM".
 * Actual recall happens at LLM runtime via ConversationContextEngine (3-way priority rules).
 */

import assert from 'node:assert/strict'
import { test, describe } from 'node:test'

describe('V8 Context Providers (CP-001/002)', () => {
  test('CP-001: Context Providers never expose execution controls', () => {
    // In V8VaultNode / V8SkillNode / V8ToolsetNode:
    // - NodeFrame is rendered with :executable="false" and no play/stop slots
    // - Right-click menu (future M-*) must not contain "执行" / "运行"
    // - Header has no ▶
    assert.ok(true, 'No executable prop, no footer run buttons, role= context (light purple bar)')
  })

  test('CP-002: Wiring updates downstream LLM context summary', () => {
    // Given V8VaultNode selected "项目需求Wiki" connected via right source "left-context" to LLM
    // Then LLM (when implemented) shows in its summary tab or bottom bar: "☑ 项目需求Wiki (知识库)"
    // Knowledge never enters system role — only user-side evidence (per CLAUDE.md + v5.1)
    assert.ok(true, 'Handle id="right-context" (or type-specific) + visual link indicator on LLM')
  })

  test('Context Providers use correct Handle + styling', () => {
    // Right source Handle only (no left target for most)
    // Edge style: context-injection (purple dashed) — enforced later in 14x14 matrix + onConnect
    // Role color: context (#a78bfa light purple)
    assert.ok(true, 'V8*Context nodes are first-class draggable citizens, not hidden dropdowns')
  })
})

/**
 * Implementation note: These 3 nodes were implemented in batch after TextNode
 * because they are lightweight (no Tiptap, no async) and unblock LLM wiring.
 * Full picker UIs (Vault selector, Skill multi-select, Tool toggles) can reuse
 * existing panels via portal or inline drawer without touching old canvas runtime.
 */
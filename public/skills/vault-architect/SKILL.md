---
name: vault-architect
description: Create custom knowledge-base vault structures for non-standard professions or projects. Use when the user asks to build a knowledge base, vault, wiki, memory system, CLAUDE.md, or directory structure for a profession/project not covered by fixed app templates.
---

# Vault Architect

Design a manual, file-based knowledge vault. Do not write files unless the user explicitly asks and the environment provides file-writing tools.

## Workflow

1. Ask only the missing essentials:
   - What work or project is this vault for?
   - What information must be tracked repeatedly?
   - What outputs should the AI produce from the vault?
   - Any privacy, compliance, or naming constraints?
2. Produce a deterministic directory plan:
   - `.raw/` for original materials, drafts, imports, and conversations.
   - `wiki/` for cleaned, queryable knowledge.
   - `wiki/hot.md` for current state and frequently needed context.
   - `wiki/index.md` for the map of the vault.
3. Produce `CLAUDE.md` content that tells the AI:
   - the vault purpose,
   - where raw material goes,
   - where durable wiki notes go,
   - how to update `hot.md`,
   - how to avoid inventing facts.
4. Keep the result practical: 8-20 folders total unless the user asks for a deeper structure.

## Output Format

Return:

```text
目录结构
- .raw/...
- wiki/...

CLAUDE.md
...

首次使用指令
...
```

## Rules

- Prefer entity-based wiki folders over chapter/date-only storage.
- Never suggest AI auto-writing hidden memory without user review.
- Keep platform-specific commands out unless the user asks for implementation.

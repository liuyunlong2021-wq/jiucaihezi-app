---
name: wiki-creator
description: Use when a user wants to create, initialize, restructure, or take over a local Markdown Wiki from documents or an existing folder. Design a short wiki/index.md, only the necessary section indexes and confirmed initial pages, then submit one WikiCreatePlan for native validation and confirmed batch writing. Do not use for ordinary Wiki queries, routine edits, or creative writing.
allowed-tools: wiki
---

# Wiki Creator

Design a navigable Markdown Wiki without replacing the App's native Wiki operations.

## Workflow

1. Read the user's stated purpose and supplied materials. Inspect an existing Wiki before proposing structural changes.
2. Decide the smallest useful information architecture. Do not force a project type or a standard set of sections.
3. Read [references/wiki-architecture.md](references/wiki-architecture.md) for navigation and plan constraints.
4. Produce one complete `WikiCreatePlan` containing the required directories and full Markdown file contents.
5. Submit the plan to the native Wiki scaffold operation for path validation, preview, user confirmation, batch writing, and verification.

## Boundaries

- Always create or preserve a short `wiki/index.md` as the root navigation entry.
- Add section `index.md` files only where they help the current material.
- Create initial content pages only from confirmed source material; do not generate empty placeholder trees or invented facts.
- Preserve existing user files. Stop for confirmation when two Wiki roots, migration, merging, deletion, or overwriting would be required.
- Do not create, scan, reorganize, or migrate `.raw/`.
- Do not require `CLAUDE.md`, `hot.md`, `log.md`, `来源索引.md`, or `方向.md` unless the user's actual use case requires one.
- Do not call `mkdir`, `write`, or `edit` for individual files. The native Wiki operation applies the complete plan once.
- After a successful batch write, return the program's deterministic receipt without another model pass.

## Output

Return exactly one plan with this shape when the runtime requests structured output:

```json
{
  "directories": ["wiki/角色"],
  "files": [
    {
      "path": "wiki/index.md",
      "content": "# Wiki\n\n- [[角色/index|角色]]\n"
    }
  ]
}
```

Paths are project-relative, remain under the selected Wiki root, and use forward slashes. File contents must be complete rather than patches.

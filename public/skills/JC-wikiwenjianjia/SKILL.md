---
name: JC-wikiwenjianjia
description: Design customized knowledge-base vault structures for any profession or project. Use when the user asks to build a knowledge base, vault, wiki, memory system, second brain, CLAUDE.md scaffold, or directory blueprint — for any domain. This is the go-to skill whenever someone needs a structured file-based knowledge system designed from scratch, regardless of whether they say "wiki," "vault," "知识库," "建库," "防失忆," or "organize my notes." Also use when a user has a messy folder of notes and wants it restructured into a proper vault.
---

# Vault Architect

Design file-based knowledge vaults tailored to the user's domain, workflow, and output needs. Never write files unless the user explicitly asks and the environment provides file-writing tools.

## How vaults work

A vault is a directory tree where every folder has a clear job. The structure itself encodes the workflow: raw stuff goes in one place, processed knowledge in another, deliverables somewhere else. A well-designed vault answers three questions without anyone having to ask:

1. **Where do I put this?** — every incoming piece of information has an obvious home.
2. **Where do I find that?** — every stored piece of knowledge is discoverable.
3. **How do I use this to produce output?** — the vault connects raw material to finished work.

The vault is not a dump. It is a workshop. The folder names are the workflow.

## Workflow

### Phase 1: Discovery

Ask questions adaptively — start broad, then drill into specifics based on what the user says. Don't ask all questions at once; have a conversation. Use these as a menu, not a script.

**Core questions** (always ask these):

1. What domain or project is this vault for? What do you actually _do_ in this role?
2. What types of information will regularly flow in? (meeting notes, research papers, code snippets, creative drafts, client communications, legal documents, design files, etc.)
3. What outputs do you need to produce from this vault? (reports, stories, decisions, code, analyses, presentations, content, etc.)
4. What is your working rhythm? (daily journaling, project-based sprints, ongoing research, client-by-client, etc.)

**Deep-dive questions** (ask based on domain):

- *For creative work:* Do you track characters/locations/plotlines separately? Do you need version histories of drafts? Do you reference real-world research?
- *For business/consulting:* Do you manage multiple clients or projects? Do you need to track decisions and meeting outcomes? Are there deliverables with review cycles?
- *For research/academic:* Do you maintain a literature database? Do you need to connect papers to your own ideas? Are there experiments or data to track?
- *For software development:* Do you need architecture decision records? Runbooks? Post-mortems? How do you connect code to design decisions?
- *For legal work:* Do you track cases by client? By jurisdiction? Do you need document templates and precedent libraries?

**Constraint questions** (ask when relevant):

- Any privacy, compliance, or confidentiality requirements?
- Will multiple people use this vault, or is it personal?
- What tools will access this vault? (Obsidian, VS Code, plain file browser, etc.)
- Any existing folder structure or naming convention you want to preserve?

### Phase 2: Architecture Design

After gathering answers, design the vault. The design has three layers:

#### Layer A: Zone layout

Every vault has zones — top-level folders that represent stages in a workflow. Common zones:

| Zone | Purpose | Example names |
|------|---------|---------------|
| Inbox | Unprocessed incoming material | `inbox/`, `.raw/`, `0-inbox/` |
| Working | Active drafts and work-in-progress | `drafts/`, `wip/`, `working/` |
| Knowledge | Polished, queryable, durable notes | `wiki/`, `notes/`, `kb/` |
| Output | Finished deliverables | `output/`, `deliverables/`, `published/` |
| Meta | Templates, conventions, indexes | `meta/`, `_templates/`, `.system/` |
| Archive | Cold storage for completed/old items | `archive/`, `.cold/` |

Not every vault needs all zones. Choose zones based on what the user actually produces and consumes. See `references/architecture-primitives.md` for more patterns.

#### Layer B: Knowledge organization

Within the knowledge zone, organize by **entity** not chronology. Entity-based means: people, projects, concepts, clients, works, topics — the things that persist across time. Chronology (by date, by chapter number) is secondary and goes inside entity folders or as metadata.

Design wiki folders that reflect the domain's natural categories:
- A novelist's vault might have `wiki/characters/`, `wiki/locations/`, `wiki/plotlines/`, `wiki/worldbuilding/`
- A consultant's vault might have `wiki/clients/`, `wiki/methodologies/`, `wiki/engagements/`
- A researcher's vault might have `wiki/papers/`, `wiki/concepts/`, `wiki/experiments/`

Each wiki folder should be a self-contained unit: everything about one character in one folder, everything about one client in one folder.

#### Layer C: Navigation and hot paths

Three navigation aids are essential:

1. **`index.md`** (or `home.md`) — the map of the vault. Lists every folder with a one-line description of what belongs there. This is the first file anyone opens.

2. **`hot.md`** — current state snapshot. What's active right now? What's blocked? What are the 3-5 things the user is working on this week? This file gets updated frequently and is always kept under 50 lines.

3. **Cross-linking strategy** — how notes connect to each other. Define a linking convention:
   - `[[wikilinks]]` for Obsidian-compatible vaults
   - Tag taxonomy (e.g., `#status/draft`, `#domain/legal`, `#priority/high`)
   - Property conventions if using Obsidian frontmatter

### Phase 3: Match or build from templates

Before designing from scratch, check if a domain template in `references/domain-patterns.md` matches the user's needs. Templates are starting points — always customize them based on the discovery answers.

If no template fits, build from architectural primitives (see `references/architecture-primitives.md`). Combine zones, entity folders, and navigation aids into a coherent whole.

### Phase 4: Generate CLAUDE.md content

Produce a `CLAUDE.md` (or equivalent AI instruction file) tailored to this vault. It must tell the AI:

1. **Vault purpose** — what this vault is for and how the human uses it
2. **Folder map** — where each type of content lives, with brief descriptions
3. **Update rules**:
   - When the AI writes new content, where does each type go?
   - When and how to update `hot.md`
   - When to create vs. append to existing notes
4. **Linking rules** — how to create wikilinks between related notes
5. **Constraints** — what the AI must never do (invent facts, overwrite human notes, reorganize without permission, etc.)

The CLAUDE.md should be specific to this vault, not generic boilerplate. Use concrete folder names and concrete examples from the user's domain.

## Language

Always respond in the same language the user uses. If the user writes in Chinese, the entire output — directory structure annotations, CLAUDE.md, first-use instructions — must be in Chinese. If mixed, default to Chinese when the user's primary prompt is in Chinese.

## Output format

Present the design in three sections:

```
## 目录结构

vault-name/
├── zone-folder/          # purpose description
│   ├── subfolder/        # purpose description
│   └── ...
├── wiki/
│   ├── category-a/       # what goes here
│   ├── category-b/       # what goes here
│   └── index.md          # map of the vault
└── hot.md                # current state

## CLAUDE.md

[Complete CLAUDE.md content, ready to save]

## 首次使用指令

1. [First step to create the vault]
2. [What to put in first]
3. [How to start using it day one]
```

## Design principles

- **Entity over chronology.** Organize by what things _are_, not when they happened. Dates go in filenames or frontmatter, not folder names.
- **Flat where possible.** Deep nesting hides information. Aim for 2-3 levels max inside any zone. The total path depth from vault root to any leaf folder must never exceed 4 levels (e.g., `vault/zone/category/item/` is fine; `vault/a/b/c/d/e/` is not). If a design would need 5+ levels, flatten by merging subfolders or moving content up one level.
- **Names that teach.** A folder called `characters/` is better than `wiki-files/`. Someone new to the vault should understand the structure just by reading folder names.
- **Hot paths should be shallow.** The files the user touches daily should be reachable in 1-2 clicks from the vault root. Put frequently-accessed indexes and dashboards at the zone level.
- **Cold storage is OK.** Not everything needs to be equally accessible. Designate an archive zone for completed projects and old material so the active zones stay clean.
- **Scale the vault, not the depth.** A vault with 200 folders at level 2 is more usable than one with 20 folders at level 5. When a category grows too large, split it horizontally (more sibling folders) rather than vertically (deeper nesting).
- **Right-size the structure.** The total number of top-level folders across all zones (inbox, wiki categories, working folders, output, meta, archive) should be between 8 and 20. Fewer than 8 means the vault is under-organized; more than 20 means it's intimidating. If under 8, consider splitting one category into siblings; if over 20, merge or introduce a mid-layer grouping.

## Guardrails

- **Follow the user's language.** If the user writes in Chinese, every section of the output must be in Chinese. Don't mix languages — pick one and stay consistent throughout.
- Never suggest AI auto-writing or auto-organizing without human review.
- The vault is a tool for the human, not a playground for the AI. The human owns the structure.
- Keep platform-specific commands out unless the user asks for implementation details.
- When in doubt, ask the user rather than assuming. A vault built on assumptions will be abandoned in a week.
- The best vault is the one the user actually maintains. Optimize for maintainability, not theoretical purity.

# Architecture Primitives

These are the building blocks for any vault. Mix and match zones, organization patterns, and navigation aids to construct a vault that fits the user's workflow.

## Zones (top-level folders)

### Inbox zone
A single folder that catches everything before processing. The inbox should be emptied regularly — material either gets filed into the knowledge zone or discarded.

```
inbox/          # dump everything here, process weekly
.raw/           # alternative name, implies "raw material"
0-inbox/        # numbered prefix keeps it at top of file list
```

**When to use:** When the user deals with a stream of incoming material (articles, notes, captures) and needs a triage step before filing.

**When to skip:** When the user's workflow is batched (e.g., they sit down to write a chapter, not capture random thoughts).

### Working zone
Active drafts, works-in-progress, and temporary working files. This is where creation happens. Material here is messy by design.

```
drafts/         # current drafts of anything
wip/            # work-in-progress, active projects
working/        # general working area
```

**When to use:** When the user produces long-form content that goes through drafts (novels, reports, papers, designs).

**When to skip:** When the user's output is mostly atomic notes or short-form content that doesn't need drafting.

### Knowledge zone
The permanent, polished knowledge base. Every file here should be something the user would want to find again in six months. This is the durable core of the vault.

```
wiki/           # general knowledge base
notes/          # alternative name
kb/             # knowledge base, shorter
```

**When to use:** Always. This is the heart of every vault.

### Output zone
Finished deliverables — the things that leave the vault and go out into the world. Separating outputs from working drafts makes it clear what's "done."

```
output/         # finished deliverables
deliverables/   # client-facing outputs
published/      # content that has been published
```

**When to use:** When the user produces documents, reports, or content for external consumption.

**When to skip:** When the vault is purely for personal reference.

### Meta zone
Templates, style guides, naming conventions, and system files. This is the vault's operating manual.

```
meta/           # templates and conventions
_templates/     # Obsidian templates folder
.system/        # hidden system files
```

**When to use:** When the vault needs templates for repeated file types or when conventions need to be documented.

**When to skip:** For very simple vaults with only 5-6 folders.

### Archive zone
Cold storage for completed projects, old drafts, and material that shouldn't be deleted but doesn't need to be in the way.

```
archive/        # general archive
.cold/          # hidden cold storage
_history/       # historical records
```

**When to use:** When the vault will grow over months or years and old material would clutter active zones.

**When to skip:** For project-specific vaults with a defined end date.

## Organization patterns

### Entity-based (primary pattern)
Organize by persistent entities — the nouns of the domain.

```
wiki/
├── people/          # one folder per person
├── projects/        # one folder per project
├── concepts/        # one folder per concept
├── tools/           # one folder per tool
└── events/          # one folder per event
```

### Lifecycle-based
Organize by stage in a process.

```
wiki/
├── leads/           # potential opportunities
├── active/          # current work
├── review/          # under review
└── completed/       # done
```

### Hybrid
Entity-based at the top level, lifecycle-based within entities.

```
wiki/
└── clients/
    └── acme-corp/
        ├── onboarding/
        ├── active-engagements/
        ├── deliverables/
        └── archive/
```

## Navigation patterns

### Index (required)
A single file that maps the entire vault. Every folder gets a one-line description.

```markdown
# Vault Index

- `inbox/` — catch-all for new material, process weekly
- `wiki/` — permanent knowledge base
  - `wiki/people/` — one note per person
  - `wiki/projects/` — one folder per project
  - `wiki/concepts/` — definitions and explanations
- `drafts/` — current work-in-progress
- `output/` — finished deliverables
- `archive/` — completed projects, old material
```

### Hot file (strongly recommended)
A snapshot of current state. Kept under 50 lines. Updated whenever context changes.

```markdown
# What's Hot (updated 2026-01-15)

**Active projects:**
- [[project-alpha]] — due Friday, waiting on client feedback
- [[project-beta]] — research phase, reading papers on X

**Blocked:**
- [[project-gamma]] — waiting for legal review

**This week's focus:**
- Finish draft of [[report-q4]]
- Review [[proposal-2026]]
```

### Dashboard notes (advanced)
For Obsidian users, Dataview queries that auto-populate lists. Mention these as options but don't require them.

### Cross-linking conventions
Define how notes connect:
- **Wikilinks:** `[[note-name]]` for direct connections
- **Tags:** `#status/draft`, `#domain/science`, `#type/meeting`
- **Properties:** YAML frontmatter fields like `status: draft`, `project: alpha`

## Scaling patterns

### When a folder gets too big (>30 files)
Split horizontally — create sibling folders by subcategory.

```
# Before
wiki/characters/     # 50 character files

# After
wiki/characters-protagonists/
wiki/characters-antagonists/
wiki/characters-supporting/
```

### When the vault gets too big (>100 top-level items in one zone)
Add a middle layer or split into sub-vaults.

```
# Before
wiki/                # 120 folders

# After
wiki/core/           # 40 most-used folders
wiki/reference/       # 80 reference folders
```

### When the user switches contexts frequently
Add a "landing pad" — a single file that links to all active contexts, updated when the user starts or stops working on something.

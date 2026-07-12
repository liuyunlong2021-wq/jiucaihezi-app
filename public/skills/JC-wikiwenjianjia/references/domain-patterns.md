# Domain Patterns

Starting-point architectures for common domains. Always customize these based on the user's specific answers — these are scaffolds, not blueprints.

## Creative Writing

For novelists, screenwriters, comic/manga creators, and storytellers.

```
novel-vault/
├── .raw/                   # imported research, reference images, notes
├── drafts/                 # chapter drafts, scene drafts
│   ├── current/            # the draft being actively worked on
│   └── versions/           # previous draft versions
├── wiki/
│   ├── characters/         # one file per character (backstory, traits, arc)
│   ├── locations/          # one file per location (description, scenes that use it)
│   ├── timeline/           # chronological event log
│   ├── worldbuilding/      # magic systems, technology, history, culture
│   ├── plotlines/          # main plot + subplots, with beats
│   └── research/           # real-world research connected to story elements
├── output/                 # final manuscripts, query letters, synopses
├── meta/
│   ├── templates/          # character sheet template, chapter template
│   └── style-guide.md      # tone, voice, naming conventions
├── index.md                # vault map
└── hot.md                  # current writing status
```

**Key linking pattern:** Characters link to locations they visit and plotlines they're part of. Plotlines link to chapters. Research links to the story elements it supports.

**CLAUDE.md focus:** Never invent plot points or character traits. Always check the character file before writing dialogue. Update hot.md when starting or finishing a chapter.

---

## Business / Consulting

For freelancers, consultants, agency owners managing multiple clients and projects.

```
consulting-vault/
├── inbox/                  # new client inquiries, meeting notes to process
├── wiki/
│   ├── clients/            # one folder per client
│   │   └── client-name/
│   │       ├── overview.md         # company info, key contacts, history
│   │       ├── engagements/        # one folder per engagement/project
│   │       │   └── project-name/
│   │       │       ├── brief.md
│   │       │       ├── meetings/   # meeting notes by date
│   │       │       ├── deliverables/
│   │       │       └── decisions.md
│   │       └── archive/            # completed engagements
│   ├── methodologies/       # your frameworks, playbooks, approaches
│   ├── templates/           # proposal templates, SOW templates, invoice templates
│   └── learning/            # lessons learned, post-mortems, skill development
├── output/                  # final deliverables before sending to client
├── archive/                 # former clients, old engagements
├── meta/
│   └── naming-conventions.md
├── index.md
└── hot.md                   # active clients, current priorities
```

**Key linking pattern:** Clients link to their engagements. Engagements link to deliverables and decisions. Methodologies link to engagements where they were applied.

**CLAUDE.md focus:** Never share client information between client folders. When creating deliverables, check the methodology folder first. Update decisions.md after every meeting.

---

## Research / Academic

For researchers, PhD students, academics doing literature-heavy work.

```
research-vault/
├── inbox/                   # new papers to read, conference notes, ideas
├── reading/                 # literature notes (one file per paper)
│   ├── to-read.md           # reading queue
│   └── paper-notes/         # detailed notes on papers read
├── wiki/
│   ├── concepts/            # key concepts and definitions
│   ├── experiments/         # one folder per experiment (design, data, results)
│   ├── ideas/               # research ideas, hypotheses, open questions
│   └── methods/             # methodologies, protocols, analysis techniques
├── writing/                 # paper drafts, thesis chapters
│   ├── current-paper/
│   └── thesis/
├── output/                  # submitted papers, presentations, posters
├── meta/
│   ├── templates/           # paper-note template, experiment-log template
│   └── citation-style.md
├── index.md
└── hot.md                   # current research focus, deadlines
```

**Key linking pattern:** Paper notes link to concepts they reference. Experiments link to the methods they use and the papers they relate to. Ideas link to papers and concepts.

**CLAUDE.md focus:** When writing about a concept, check if there's already a concept note. Never modify experiment data. Link paper notes to concepts whenever possible.

---

## Software Development

For developers maintaining codebases with design decisions, runbooks, and operational knowledge.

```
dev-vault/
├── inbox/                   # bug reports, feature ideas, meeting notes
├── wiki/
│   ├── architecture/        # architecture decision records (ADRs)
│   ├── systems/             # one folder per system/service
│   │   └── service-name/
│   │       ├── overview.md
│   │       ├── api.md
│   │       ├── database.md
│   │       └── dependencies.md
│   ├── runbooks/            # operational procedures, incident response
│   ├── postmortems/         # incident post-mortems
│   └── onboarding/          # dev environment setup, team norms
├── drafts/                  # RFCs, design docs in progress
├── meta/
│   ├── templates/           # ADR template, postmortem template
│   └── conventions.md       # code style, commit conventions
├── index.md
└── hot.md                   # current sprint focus, active incidents
```

**Key linking pattern:** ADRs link to the systems they affect. Systems link to their dependencies. Postmortems link to affected systems and related runbooks.

**CLAUDE.md focus:** Never modify architecture decisions without explicit review. When suggesting a design, reference existing ADRs. Update runbooks after incidents.

---

## Legal

For lawyers and legal professionals managing cases.

```
legal-vault/
├── inbox/                   # new client inquiries, court notices
├── wiki/
│   ├── clients/             # one folder per client
│   │   └── client-name/
│   │       ├── overview.md
│   │       ├── matters/     # one folder per legal matter
│   │       │   └── matter-name/
│   │       │       ├── case-summary.md
│   │       │       ├── documents/
│   │       │       ├── research/
│   │       │       ├── correspondence/
│   │       │       └── billing.md
│   │       └── archive/
│   ├── precedents/          # case law summaries, organized by topic
│   ├── templates/           # document templates, boilerplate
│   └── references/          # statutes, regulations, court rules
├── output/                  # final filings, signed documents
├── archive/                 # closed matters, former clients
├── index.md
└── hot.md                   # active matters, court dates, deadlines
```

**Key linking pattern:** Matters link to relevant precedents and templates. Clients link to their active matters. Research notes link to the matters they support.

**CLAUDE.md focus:** Never share client information between client folders. Do not provide legal advice — only organize and summarize. Link precedents to matters that use them.

---

## Personal Knowledge Management

For individuals building a second brain or personal wiki.

```
personal-vault/
├── inbox/                   # quick captures, random thoughts
├── journal/                 # daily or weekly journal entries
├── wiki/
│   ├── health/              # medical history, fitness, nutrition
│   ├── finance/             # budgets, investments, tax records
│   ├── learning/            # courses, books, skills
│   ├── projects/            # personal projects (home, hobbies, travel)
│   ├── people/              # important contacts, gift ideas, notes
│   └── ideas/               # creative ideas, business ideas, life goals
├── archive/                 # old journals, completed projects
├── meta/
│   └── templates/           # journal template, book-note template
├── home.md                  # dashboard / landing page
└── hot.md                   # current focus areas
```

**Key linking pattern:** Journal entries link to projects and people mentioned. Learning notes link to ideas they inspired. Projects link to relevant learning and people.

**CLAUDE.md focus:** This is a personal vault — be respectful and don't make assumptions about the user's life. Journal entries should link to relevant wiki pages.

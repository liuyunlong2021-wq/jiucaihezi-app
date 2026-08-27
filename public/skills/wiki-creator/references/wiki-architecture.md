# Wiki Architecture

## Root Entry

Keep `wiki/index.md` short. It should state the Wiki's purpose, link to current section entries, and point to any active status or operating guide the user actually needs. It is navigation, not a copy of the whole Wiki.

## Sections

Derive sections from the material and intended work:

- A novel may need plot, characters, locations, props, foreshadowing, current status, and writing rules.
- A screenplay may organize episodes, characters, scenes, production assets, continuity, and current status.
- A company Wiki may organize teams, projects, processes, decisions, and references.
- A journal or ledger should use its own date, topic, account, or category structure instead of fictional-story sections.

Create a section `index.md` when a section contains multiple pages or needs its own navigation. Do not create every example section.

## Links

- Root navigation links to section entries.
- Section entries link to their confirmed pages.
- Add reciprocal links only when they express a useful relationship.
- Use project-relative Wiki links and stable page names.

## Plan Rules

- Include every required directory in `directories`.
- Include complete contents for every new Markdown file in `files`.
- Do not include existing files unless the proposed content is explicitly intended to replace an allowed empty entry and the runtime permits it.
- Deduplicate paths before returning the plan.
- Any path outside the selected Wiki root, absolute path, traversal, duplicate, or collision invalidates the whole plan before writing.

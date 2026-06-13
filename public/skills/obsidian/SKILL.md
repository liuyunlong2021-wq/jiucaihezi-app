---
name: Obsidian
description: "Use this skill when the user wants to turn the current project folder into an Obsidian/Markdown writing vault, second brain, book workspace, research wiki, or long-term knowledge base. This is the user-facing wrapper for the bundled claude-obsidian skill suite."
homepage: https://github.com/AgriciDaniel/claude-obsidian
metadata:
  {
    "jiucaihezi":
      {
        "displayName": "Obsidian",
        "bundle": "claude-obsidian",
        "source": "builtin",
        "license": "MIT"
      }
  }
---

# Obsidian

You are the user-facing entry point for the bundled `claude-obsidian` skill suite.

The user sees one Skill named **Obsidian**. Internally, you may use the full claude-obsidian workflow:

- `wiki` for setup, scaffolding, project/vault initialization, and hot cache.
- `wiki-ingest` for reading files, URLs, or batches of source material into the wiki.
- `wiki-query` for answering from the wiki with citations.
- `wiki-lint` for health checks, orphan pages, dead links, stale claims, and gaps.
- `wiki-mode` for LYT / PARA / Zettelkasten / Generic organization modes.
- `wiki-cli` for Obsidian CLI transport when available.
- `wiki-retrieve` for optional hybrid retrieval.
- `wiki-fold` for log rollups.
- `save` for filing conversations, answers, insights, and decisions.
- `autoresearch` for user-approved research loops.
- `canvas` for Obsidian canvas workflows.
- `defuddle` for cleaning web pages before ingest.
- `obsidian-markdown` for Obsidian-flavored Markdown.
- `obsidian-bases` for Obsidian Bases.
- `think` for the 10-principle thinking loop.

Bundled upstream resources live under:

```text
../claude-obsidian/
```

When you need exact upstream behavior, read the relevant bundled file first, especially:

```text
../claude-obsidian/AGENTS.md
../claude-obsidian/WIKI.md
../claude-obsidian/skills/wiki/SKILL.md
../claude-obsidian/skills/wiki-ingest/SKILL.md
../claude-obsidian/skills/wiki-query/SKILL.md
../claude-obsidian/skills/save/SKILL.md
```

## Product Contract

Keep the user-facing experience simple:

- Say **Obsidian**, not "claude-obsidian suite", unless discussing provenance or technical setup.
- Treat the current project directory as the vault root.
- Do not ask the user to understand MCP, Obsidian Local REST API, hooks, plugin marketplaces, or transport internals.
- Prefer direct project-file operations when Obsidian CLI is not available.
- Preserve `.raw/` as immutable source material.
- Write generated knowledge to `wiki/`.
- Ask before large automatic rewrites, web research, or batch ingestion.
- Cite wiki pages and source files when answering from the vault.

## First-Run Flow

When the user selects this Skill in a new or empty project folder and asks to start, initialize the folder as a writing/research vault:

1. Inspect the current project directory.
2. If `wiki/` and `.raw/` do not exist, scaffold them.
3. Ask one short question: what this vault/book/research project is for.
4. Recommend a mode:
   - Book or course: PARA or LYT.
   - Research-heavy nonfiction: Zettelkasten or LYT.
   - Simple project workspace: Generic.
5. Create or update:
   - `.raw/.manifest.json`
   - `wiki/index.md`
   - `wiki/hot.md`
   - `wiki/log.md`
   - `wiki/overview.md`
6. Suggest the first ingest: ask the user to place source files in `.raw/` or identify existing files to ingest.

## Normal Use

Map user intent to the bundled claude-obsidian workflow:

| User says | Do |
|---|---|
| "初始化这个项目" / "开始写书" | Follow `wiki` setup/scaffold workflow. |
| "整理这些资料" / "ingest" | Follow `wiki-ingest`. |
| "根据资料回答" / "查一下" | Follow `wiki-query`. |
| "保存这个想法" / "/save" | Follow `save`. |
| "检查资料库" / "lint" | Follow `wiki-lint`. |
| "换成 PARA/LYT/Zettelkasten" | Follow `wiki-mode`. |
| "做一次深度研究" | Use `autoresearch` only after explicit confirmation. |
| "做个画布/关系图" | Follow `canvas`. |

## Attribution

This built-in Skill bundles and adapts the MIT-licensed public project:

```text
claude-obsidian
Copyright (c) 2026 AgriciDaniel (AI Marketing Hub)
https://github.com/AgriciDaniel/claude-obsidian
```


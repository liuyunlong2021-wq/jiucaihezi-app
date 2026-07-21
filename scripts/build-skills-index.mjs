#!/usr/bin/env node
// build-skills-index.mjs - Phase 1d: generate public/skills/index.json for Web
// Called during build (vite build pipeline)
// Scans public/skills/*/SKILL.md, extracts YAML frontmatter, outputs index.json

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SKILLS_DIR = join(ROOT, 'public', 'skills')
const OUTPUT = join(SKILLS_DIR, 'index.json')
const WIKI_LINK_SOURCE = join(ROOT, 'scripts', 'wiki-extract-wikilinks-source.mjs')
const WIKI_LINK_OUTPUT = join(SKILLS_DIR, 'jc-jian-wiki', 'scripts', 'extract_wikilinks.mjs')

await build({
  entryPoints: [WIKI_LINK_SOURCE],
  outfile: WIKI_LINK_OUTPUT,
  bundle: true,
  platform: 'node',
  format: 'esm',
  minify: true,
  banner: { js: '// Generated from scripts/wiki-extract-wikilinks-source.mjs; do not edit directly.' },
})

function parseFrontmatter(content) {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) return null
  const afterOpen = content.startsWith('---\n')
    ? content.slice(4)
    : content.slice(5)
  const closePos = afterOpen.indexOf('\n---')
  if (closePos === -1) return null
  const fmStr = afterOpen.slice(0, closePos)
  // Simple YAML parser: only handles scalar and sequence values
  const result = {}
  let currentKey = null
  for (const line of fmStr.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    if (trimmed.startsWith('- ') && currentKey) {
      if (!Array.isArray(result[currentKey])) result[currentKey] = []
      result[currentKey].push(trimmed.slice(2).replace(/^"|"$/g, ''))
      continue
    }
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx === -1) {
      // Multiline string continuation
      if (currentKey) result[currentKey] += ' ' + trimmed
      continue
    }
    currentKey = trimmed.slice(0, colonIdx).trim()
    let value = trimmed.slice(colonIdx + 1).trim()
    if (value === '>' || value === '|') {
      result[currentKey] = ''
    } else {
      value = value.replace(/^"|"$/g, '')
      result[currentKey] = value
    }
  }
  return result
}

function parseCommands(content) {
  const sectionStart = content.indexOf('\n## 指令') !== -1
    ? content.indexOf('\n## 指令')
    : content.indexOf('\n## 命令')
  if (sectionStart === -1) return []
  const afterSection = content.slice(sectionStart)
  const fenceStart = afterSection.indexOf('```commands')
  if (fenceStart === -1) return []
  const afterFence = afterSection.slice(fenceStart + '```commands'.length + 1)
  const fenceEnd = afterFence.indexOf('\n```')
  if (fenceEnd === -1) return []
  return afterFence.slice(0, fenceEnd)
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('//'))
}

function listPackageFiles(directory, prefix = '') {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.DS_Store' || entry.name === '__pycache__' || entry.name.endsWith('.pyc')) continue
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...listPackageFiles(join(directory, entry.name), relative))
    else if (entry.isFile()) files.push(relative)
  }
  return files.sort()
}

const skills = []

function findSkillPackages(directory, relative = '') {
  const packages = []
  const entries = readdirSync(directory, { withFileTypes: true })
  if (relative && entries.some(entry => entry.isFile() && entry.name === 'SKILL.md')) {
    packages.push({ id: relative, directory })
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name
    packages.push(...findSkillPackages(join(directory, entry.name), childRelative))
  }
  return packages
}

for (const skillPackage of findSkillPackages(SKILLS_DIR)) {
  const mdPath = join(skillPackage.directory, 'SKILL.md')

  const content = readFileSync(mdPath, 'utf8')
  const fm = parseFrontmatter(content)
  if (!fm || !fm.name) {
    console.log('  SKIP ' + skillPackage.id + ': no valid frontmatter')
    continue
  }

  const commands = parseCommands(content)

  skills.push({
    id: skillPackage.id,
    name: fm.name,
    description: fm.description || null,
    triggers: fm.triggers || [],
    commands: commands,
    files: listPackageFiles(skillPackage.directory)
  })
}

writeFileSync(OUTPUT, JSON.stringify(skills, null, 2))
console.log('Generated ' + OUTPUT + ' (' + skills.length + ' skills)')

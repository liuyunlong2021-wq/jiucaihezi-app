#!/usr/bin/env node
// build-skills-index.mjs - Phase 1d: generate public/skills/index.json for Web
// Called during build (vite build pipeline)
// Scans public/skills/*/SKILL.md, extracts YAML frontmatter, outputs index.json

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SKILLS_DIR = join(ROOT, 'public', 'skills')
const OUTPUT = join(SKILLS_DIR, 'index.json')

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
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...listPackageFiles(join(directory, entry.name), relative))
    else if (entry.isFile()) files.push(relative)
  }
  return files.sort()
}

const entries = readdirSync(SKILLS_DIR, { withFileTypes: true })
const skills = []

for (const entry of entries) {
  if (!entry.isDirectory()) continue
  const mdPath = join(SKILLS_DIR, entry.name, 'SKILL.md')
  if (!existsSync(mdPath)) continue

  const content = readFileSync(mdPath, 'utf8')
  const fm = parseFrontmatter(content)
  if (!fm || !fm.name) {
    console.log('  SKIP ' + entry.name + ': no valid frontmatter')
    continue
  }

  const commands = parseCommands(content)

  skills.push({
    id: entry.name,
    name: fm.name,
    description: fm.description || null,
    triggers: fm.triggers || [],
    commands: commands,
    files: listPackageFiles(join(SKILLS_DIR, entry.name))
  })
}

writeFileSync(OUTPUT, JSON.stringify(skills, null, 2))
console.log('Generated ' + OUTPUT + ' (' + skills.length + ' skills)')

#!/usr/bin/env node
// Phase 1: add triggers to YAML frontmatter + commands section to SKILL.md

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SKILLS_DIR = join(ROOT, 'public', 'skills')
const MAP_FILE = join(__dirname, 'skill-frontmatter-map.json')

const dryRun = process.argv.includes('--dry-run')
const map = JSON.parse(readFileSync(MAP_FILE, 'utf8'))

function addTriggersToFrontmatter(content, triggers) {
  if (!triggers || triggers.length === 0) return content
  if (content.includes('\ntriggers:')) return content
  // Insert triggers before closing ---
  const end = content.indexOf('\n---')
  if (end === -1) return content
  const triggerLines = triggers.map(function(t) { return '  - "' + t + '"' }).join('\n')
  return content.slice(0, end) + '\ntriggers:\n' + triggerLines + '\n---' + content.slice(end + 4)
}

function buildCommandsSection(commands) {
  if (!commands || commands.length === 0) return ''
  var lines = ['', '## 指令', '', '```commands']
  for (var i = 0; i < commands.length; i++) lines.push(commands[i])
  lines.push('```')
  return lines.join('\n')
}

function hasCommandsSection(content) {
  return content.indexOf('## 指令') !== -1 || content.indexOf('## 命令') !== -1
}

var updated = 0, skipped = 0
var entries = readdirSync(SKILLS_DIR)

for (var i = 0; i < entries.length; i++) {
  var name = entries[i]
  var dirPath = join(SKILLS_DIR, name)
  var mdPath = join(dirPath, 'SKILL.md')
  if (!existsSync(mdPath)) continue

  var meta = map[name]
  if (!meta) { skipped++; continue }

  var content = readFileSync(mdPath, 'utf8')
  var changed = false

  // Add triggers to existing frontmatter
  if (meta.triggers && meta.triggers.length > 0 && content.startsWith('---')) {
    var newContent = addTriggersToFrontmatter(content, meta.triggers)
    if (newContent !== content) { content = newContent; changed = true; console.log('  +triggers ' + name) }
  }

  // Add commands section
  if (!hasCommandsSection(content) && meta.commands.length > 0) {
    content = content.trimEnd() + '\n' + buildCommandsSection(meta.commands) + '\n'
    changed = true
    console.log('  +commands ' + name + ' (' + meta.commands.length + ')')
  }

  if (changed) {
    if (!dryRun) writeFileSync(mdPath, content, 'utf8')
    updated++
  } else {
    skipped++
  }
}

console.log('\n' + (dryRun ? '[DRY RUN] ' : '') + 'Updated: ' + updated + ', Skipped: ' + skipped)

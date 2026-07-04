import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const failures = []

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function fail(message) {
  failures.push(message)
}

function assertNo(path, pattern, message) {
  if (pattern.test(read(path))) fail(`${path}: ${message}`)
}

function walk(dir, out = []) {
  for (const name of readdirSync(join(root, dir))) {
    const full = join(root, dir, name)
    const rel = relative(root, full)
    if (name === 'node_modules' || name === 'dist') continue
    if (statSync(full).isDirectory()) walk(rel, out)
    else out.push(rel)
  }
  return out
}

assertNo('src/composables/useChat.ts', /(function|const|let|var)\s+(sendDirectLocalModelMessage|sendDesktopDirectCloudMessage)\b|await\s+(sendDirectLocalModelMessage|sendDesktopDirectCloudMessage)\b/, 'desktop direct senders must stay deleted')
assertNo('src/composables/useChat.ts', /chatMode\?:[^\n]*direct|options\.chatMode\s*={2,3}\s*['"]direct['"]/, 'desktop chatMode must not accept or branch on direct')
assertNo('src/composables/useChat.ts', /@\/runtime\/direct|directMessageBuilder|runDirectChatCompletion|buildDirectMessages/, 'desktop useChat must not import direct runtime')

assertNo('src/components/chat/ChatPanel.vue', /selectAgentMode\(['"]direct['"]\)|agentMode\.value\s*={2,3}\s*['"]direct['"]/, 'desktop UI must not expose direct mode')
assertNo('src/components/chat/ChatPanel.vue', /type\s+AgentMode\s*=[^\n]*direct/, 'AgentMode must only be plan/build')

const directImportAllowed = new Set([
  'src/composables/chatCloud.ts',
  'src/composables/webDirectEngine.ts',
  'src/components/__tests__/chatMessagePresentation.test.ts',
  'src/utils/__tests__/directMessageBuilder.test.ts',
])

for (const file of walk('src')) {
  if (!/\.(ts|vue)$/.test(file)) continue
  if (file.startsWith('src/runtime/direct/') || file === 'src/utils/directMessageBuilder.ts') continue
  const source = read(file)
  if (/runtime\/direct|directMessageBuilder/.test(source) && !directImportAllowed.has(file)) {
    fail(`${file}: direct runtime is Web-only and must not leak into desktop code`)
  }
}

if (failures.length) {
  console.error('App OpenCode-only audit failed.')
  for (const item of failures) console.error(`- ${item}`)
  process.exit(1)
}

console.log('App OpenCode-only audit passed.')

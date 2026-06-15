import { execFileSync } from 'node:child_process'

const forbiddenPathPatterns = [
  /^src-tauri\//,
  /^src\/opencodeClient\//,
  /^src\/components\/chat\/OpenCodePartList\.vue$/,
  /^src\/components\/chat\/MessageBubble\.vue$/,
  /^src\/components\/chat\/FileUploader\.vue$/,
]

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function changedFiles() {
  const names = new Set()
  for (const mode of [['diff', '--name-only'], ['diff', '--name-only', '--cached']]) {
    const output = git(mode)
    for (const line of output.split(/\r?\n/).filter(Boolean)) names.add(line)
  }
  const porcelain = git(['status', '--short'])
  for (const line of porcelain.split(/\r?\n/).filter(Boolean)) {
    const file = line.slice(3).trim()
    if (file) names.add(file)
  }
  return [...names].sort()
}

const files = changedFiles()
const forbidden = files.filter(file => forbiddenPathPatterns.some(pattern => pattern.test(file)))
const packageDiff = files.includes('package.json') || files.includes('pnpm-lock.yaml')
  ? git(['diff', '--', 'package.json', 'pnpm-lock.yaml'])
  : ''
const touchesOpenCodeSdk = /@opencode-ai\/sdk/.test(packageDiff)

if (forbidden.length || touchesOpenCodeSdk) {
  console.error('Web direct boundary audit failed.')
  if (forbidden.length) {
    console.error('\nForbidden files changed:')
    for (const file of forbidden) console.error(`- ${file}`)
  }
  if (touchesOpenCodeSdk) {
    console.error('\nOpenCode SDK dependency changed in package files.')
  }
  process.exit(1)
}

console.log('Web direct boundary audit passed.')

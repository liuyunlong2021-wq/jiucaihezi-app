import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const [root, target] = process.argv.slice(2)
const hashes = {}
function walk(path) {
  for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
    const relative = path ? `${path}/${entry.name}` : entry.name
    if (entry.isDirectory()) walk(relative)
    else if (entry.isFile()) hashes[relative] = createHash('sha256').update(readFileSync(join(root, relative))).digest('hex')
  }
}
for (const path of ['deepseek-harness', 'creation-mcp', 'skills', 'storyboarder']) walk(path)
hashes['jiucaihezi-app.exe'] = createHash('sha256').update(readFileSync(join(root, 'jiucaihezi-app.exe'))).digest('hex')
writeFileSync(target, JSON.stringify(hashes))
console.log(`Recorded ${Object.keys(hashes).length} native Windows runtime files`)

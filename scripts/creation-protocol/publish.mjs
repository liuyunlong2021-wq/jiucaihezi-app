import { readFile, writeFile, rename } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { assertCreationCapabilityEntry } from './server.mjs'
import { canonicalCreationJson } from '../../shared/creation-schema.mjs'

// Administrative publication only: no API key, network request or paid execution.
const [manifestArgument, entryArgument] = process.argv.slice(2)
if (!manifestArgument || !entryArgument) throw new Error('用法：node publish.mjs <capabilities.json> <entry.json>')
const manifestPath = resolve(manifestArgument)
const entry = JSON.parse(await readFile(resolve(entryArgument), 'utf8'))
assertCreationCapabilityEntry(entry)
let manifest = { entries: [] }
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) } catch (e) { if (e.code !== 'ENOENT') throw e }
const previous = manifest.entries.find(item => item.capability.capability_id === entry.capability.capability_id && item.capability.revision === entry.capability.revision)
if (previous && canonicalCreationJson({capability:previous.capability, adapter:previous.adapter}) !== canonicalCreationJson({capability:entry.capability, adapter:entry.adapter})) throw new Error('同一 revision 不允许变更；请发布新版本')
const entries = manifest.entries.map(item => item.capability.capability_id === entry.capability.capability_id ? {...item, current:false} : item)
if (previous) entries[manifest.entries.indexOf(previous)] = {...entry, current:true}
else entries.push({...entry, current:true})
const temporary = `${manifestPath}.${randomUUID()}.tmp`
await writeFile(temporary, JSON.stringify({entries}, null, 2) + '\n', {mode:0o600, flag:'wx', flush:true})
await rename(temporary, manifestPath)
console.log(`已发布能力合同 ${entry.capability.capability_id} @ ${entry.capability.revision}；未触发生成`)

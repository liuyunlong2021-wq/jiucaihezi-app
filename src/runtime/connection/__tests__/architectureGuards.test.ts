import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

function readTypeScriptSourcesUnder(path: string): Array<{ path: string; source: string }> {
  const root = join(process.cwd(), path)
  if (!existsSync(root)) return []
  const entries: Array<{ path: string; source: string }> = []

  function visit(relativeDir: string) {
    const dir = join(process.cwd(), relativeDir)
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relativePath = join(relativeDir, entry.name)
      if (entry.isDirectory()) {
        visit(relativePath)
        continue
      }
      if (!entry.name.endsWith('.ts') || relativePath.includes('__tests__')) continue
      entries.push({ path: relativePath, source: readSource(relativePath) })
    }
  }

  visit(path)
  return entries
}

test('Connection index exports the public runtime boundary without knowledge adapters', () => {
  const source = readSource('src/runtime/connection/index.ts')

  assert.match(source, /superpowerConnection/)
  assert.match(source, /toolConnectionAdapter/)
  assert.match(source, /skillConnectionAdapter/)
  assert.doesNotMatch(source, /knowledgeConnection/)
  assert.equal(existsSync(join(process.cwd(), 'src/runtime/connection/knowledgeConnection.ts')), false)
  assert.equal(existsSync(join(process.cwd(), 'src/runtime/connection/knowledgeConnectionAdapter.ts')), false)
})

test('tool runtime kernel stays below RuntimeConnection boundary', () => {
  const sources = readTypeScriptSourcesUnder('src/runtime/tools')
  assert.ok(sources.length > 0)

  const forbiddenImports = [
    'chatRuntimeConnection',
    'runtimeConnection',
    'skillConnectionAdapter',
    'knowledgeConnectionAdapter',
    'vaultStore',
    'agentStore',
  ]

  for (const file of sources) {
    for (const forbidden of forbiddenImports) {
      assert.equal(
        file.source.includes(forbidden),
        false,
        `${file.path} must not import or use ${forbidden}`,
      )
    }
  }
})

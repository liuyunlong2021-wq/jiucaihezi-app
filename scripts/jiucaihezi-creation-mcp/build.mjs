import { build } from 'esbuild'

await build({
  entryPoints: ['scripts/jiucaihezi-creation-mcp/index.ts'],
  outfile: 'scripts/jiucaihezi-creation-mcp/dist/index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
})

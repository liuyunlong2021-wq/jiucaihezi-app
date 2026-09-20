/**
 * jev-eval 的启动器：先把 eval.ts 打成单文件再跑。
 * 编译方式照抄 scripts/run-focused-tests.mjs（esbuild JS API + 平台临时目录），
 * 不写死 macOS 的 /private/tmp —— 那会让 Windows 上把产物倒在项目根目录里。
 */
import { build } from 'esbuild'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// node 25 的 localStorage 全局是坏的（getItem 不是函数）。决策链会用到它，
// 不垫掉的话量到的是环境而不是产品。必须在业务模块求值之前装好。
const store = new Map()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: key => store.get(String(key)) ?? null,
    setItem: (key, value) => void store.set(String(key), String(value)),
    removeItem: key => void store.delete(String(key)),
    clear: () => store.clear(),
    key: index => [...store.keys()][index] ?? null,
    get length() {
      return store.size
    },
  },
})

const outfile = join(tmpdir(), 'jc-jev-eval.mjs')
await build({
  entryPoints: ['scripts/jev-eval/eval.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  alias: { '@': './src' },
  outfile,
  logLevel: 'warning',
})
await import(pathToFileURL(outfile).href)

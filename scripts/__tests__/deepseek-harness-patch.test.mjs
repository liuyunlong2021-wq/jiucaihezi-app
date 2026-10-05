import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

// 补丁脚本是纯文本替换，幂等性完全靠它自己的 `!server.includes(anchor)` 检查。
// 实测踩过：第 5 处补丁（会话级权限）把锚点落在第 4 处（session/list + session/read）
// 那段**连续字符串内部**，把它切断 —— 于是第二次运行时第 4 处的检查误判成「还没打过」，
// 再去 replace 已经不在的 requestCases，抛 Unsupported ... request server layout。
// 开发机上永远只跑一次，CI / 重装却能撞上，所以这里就真跑两次并比对结果。
const serverPath = join(
  process.cwd(),
  'src-tauri/resources/deepseek-harness/node_modules',
  '@deepseek-ai/dsh-sdk-jsonrpc-server/lib/index.js',
)

const apply = () => execFileSync(process.execPath, ['scripts/prepare-deepseek-harness.mjs'], { stdio: 'pipe' })

test('the Harness vendor patch is idempotent and carries the permission request', t => {
  if (!existsSync(serverPath)) return t.skip('bundled Harness SDK is not installed')
  apply()
  const once = readFileSync(serverPath, 'utf8')
  apply()
  assert.equal(readFileSync(serverPath, 'utf8'), once, '第二次应用不允许改变结果')
  const clientPath = serverPath.replace('dsh-sdk-jsonrpc-server', 'dsh-sdk-client')
  const client = readFileSync(clientPath, 'utf8')
  assert.match(client, /spawn\(this\.runtime\.command, this\.runtime\.args, \{\s*windowsHide: true,/)
  apply()
  assert.equal(readFileSync(clientPath, 'utf8'), client, '后台启动补丁必须幂等')
  // 会话权限是 durable 事实，进程级 DSH_PERMISSION_MODE 只管新会话；这条请求是唯一能
  // 把已存在会话拉齐到 @文件 语义的通道。
  assert.match(once, /case "session\/permission": return this\.permission\(params\);/)
  // 同一处 inject 必须同时带 `commands`（权限）与 `skills`（点名 skill 要查官方注册表）。
  assert.match(once, /const inject = \["agents", "sessionQuery", "commands", "skills"\];/)
  assert.match(once, /\"\/permission \" \+ preset/)
  // 官方命令面必须真的被调用，而不是自己写 permission/preset 事件绕过官方推导。
  assert.match(once, /this\.ctx\.get\("commands"\)\.execute\(agent/)
  // 点名 skill → 掩掉 `skill` 工具（官方 tools.restrict），且必须在 prompt 前生效。
  assert.match(once, /await this\.applyPinnedSkillScope\(rec, content\);/)
  assert.match(once, /agent\.ctx\.tools\.restrict\(\{ deny: \["skill"\] \}\)/)
})

// 剪体积的两刀（node 包的安装源 278M、LibreOffice 260M，都是打好的 App 里的实际占用）。
// 这里真跑脚本再检查结果，而不是断言源码字符串 —— 这两刀切错一点就是把运行时自己删了。
test('harness 准备脚本只留运行时真正要的东西', t => {
  const harness = join(process.cwd(), 'src-tauri/resources/deepseek-harness')
  const nodeBin = join(
    harness,
    'node_modules/node/bin',
    process.platform === 'win32' ? 'node.exe' : 'node',
  )
  if (!existsSync(nodeBin)) return t.skip('bundled Harness SDK is not installed')
  apply()

  // 前端就是用这个二进制启动 harness 的（src/services/deepSeekHarness.ts）——
  // 它活着不够，得真能执行：node 包的安装源里那个是它的硬链接，切错就一起没了。
  assert.match(
    execFileSync(nodeBin, ['-e', 'process.stdout.write(process.version)'], { encoding: 'utf8' }),
    /^v\d+/,
    '裁剪后 node/bin/node 必须仍可执行',
  )
  assert.ok(
    !existsSync(join(harness, 'node_modules/node/node_modules')),
    'node 包的安装源必须删掉',
  )
  // 打包会解引用符号链接：留着这个 19 字节的链接，包里就多出一份 107M 的二进制。
  assert.ok(
    !existsSync(join(harness, 'node_modules/.bin/node')),
    '.bin/node 符号链接必须删掉（打包会把它变成第二份真二进制）',
  )
  assert.deepEqual(
    readdirSync(join(harness, 'node_modules/@deepseek-ai')).filter(name =>
      name.startsWith('libreoffice-kit'),
    ),
    [],
    'libreoffice-kit 全家（含平台包与 wasm）必须删掉',
  )
})

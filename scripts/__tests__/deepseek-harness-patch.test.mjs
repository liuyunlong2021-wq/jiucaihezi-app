import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
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
  // 会话权限是 durable 事实，进程级 DSH_PERMISSION_MODE 只管新会话；这条请求是唯一能
  // 把已存在会话拉齐到 @文件 语义的通道。
  assert.match(once, /case "session\/permission": return this\.permission\(params\);/)
  assert.match(once, /const inject = \["agents", "sessionQuery", "commands"\];/)
  assert.match(once, /\"\/permission \" \+ preset/)
  // 官方命令面必须真的被调用，而不是自己写 permission/preset 事件绕过官方推导。
  assert.match(once, /this\.ctx\.get\("commands"\)\.execute\(rec\.handle\.agent/)
})

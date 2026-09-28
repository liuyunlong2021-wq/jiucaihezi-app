import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  applyDeepSeekAssistantStream,
  deepSeekAssistantReasoning,
  deepSeekAssistantText,
  deepSeekContentBlocks,
  deepSeekHandoffTurns,
  deepSeekMessageUsage,
  deepSeekModelInput,
  deepSeekPermissionMode,
  deepSeekProgress,
  deepSeekPrompt,
  deepSeekSessionId,
  deepSeekSessionExists,
  deepSeekSessionProcess,
  deepSeekSessionReasoning,
  deepSeekSessionTurns,
  deepSeekTurnError,
  DEEPSEEK_PROCESS_RESULT_LIMIT,
} from '@/services/deepSeekHarness'

test('@文件 maps to the official Harness full-access mode', () => {
  assert.equal(deepSeekPermissionMode(false), 'workspace-write')
  assert.equal(deepSeekPermissionMode(true), 'danger-full-access')
})

test('DeepSeek Harness keeps one stable namespaced session per conversation', () => {
  assert.equal(deepSeekSessionId('conversation-1'), 'jc-v1-conversation-1')
  assert.equal(deepSeekSessionId('conversation-1'), deepSeekSessionId('conversation-1'))
})

test('an unopened catalog conversation is not mistaken for an existing Harness session', () => {
  const sessions = [
    { header: { id: 'jc-v1-conversation-1' }, live: false, persisted: true },
  ]
  assert.equal(deepSeekSessionExists(sessions, 'conversation-1'), true)
  assert.equal(deepSeekSessionExists(sessions, 'conversation-new'), false)
})

test('DeepSeek Harness invokes UI-selected skills through native skill gestures', () => {
  assert.equal(
    deepSeekPrompt('执行任务', ['wiki-memory', 'skill-creator']),
    '/wiki-memory /skill-creator\n\n执行任务',
  )
  assert.equal(deepSeekPrompt('执行任务', []), '执行任务')
})

test('DeepSeek Harness hands off only conversation turns not already owned by its session', () => {
  const turns = [
    { id: 'u1', role: 'user' as const, content: '先分析', createdAt: '2026-01-01' },
    { id: 'a1', role: 'assistant' as const, content: '方案', createdAt: '2026-01-01' },
    { id: 'u2', role: 'user' as const, content: '第一次 DH', createdAt: '2026-01-01', toolChips: ['dh', 'dh-session-v1'] },
    { id: 'a2', role: 'assistant' as const, content: '已执行', createdAt: '2026-01-01' },
    { id: 'u3', role: 'user' as const, content: '普通补充', createdAt: '2026-01-01' },
    { id: 'a3', role: 'assistant' as const, content: '补充结论', createdAt: '2026-01-01' },
  ]
  assert.deepEqual(deepSeekHandoffTurns(turns).map(turn => turn.id), ['u3', 'a3'])
  assert.deepEqual(deepSeekHandoffTurns(turns.slice(0, 2)).map(turn => turn.id), ['u1', 'a1'])
  assert.deepEqual(deepSeekHandoffTurns(turns.slice(0, 4)), [])
  assert.deepEqual(
    deepSeekHandoffTurns(turns.map(turn => turn.id === 'u2' ? { ...turn, toolChips: ['dh'] } : turn))
      .map(turn => turn.id),
    ['u1', 'a1', 'u2', 'a2', 'u3', 'a3'],
  )
})

test('DeepSeek Harness transfers missing history once without a three-round contract', () => {
  assert.equal(
    deepSeekPrompt('直接执行', ['skill-creator'], [
      { id: 'u1', role: 'user', content: '原始要求', createdAt: '2026-01-01' },
      { id: 'a1', role: 'assistant', content: '确认方案', createdAt: '2026-01-01' },
    ]),
    '/skill-creator\n\n【既有对话移交】\n\n用户：原始要求\n\n助手：确认方案\n\n【本轮消息】\n\n直接执行',
  )
})

test('DeepSeek Harness declares image input so the attached image reaches the model', () => {
  // 路由 patch 不声明模态时，官方取 DEFAULT_INPUT = ["text"]：图片不会内联进请求，
  // read_image 直接报「does not declare image input」，实测一次“查看图片内容”就这么
  // 变成 11 步工具乱找 + 6 次 429/524 重试，16 分钟无果。
  assert.deepEqual(deepSeekModelInput(true), ['text', 'image'])
  assert.deepEqual(deepSeekModelInput(false), ['text'])
  assert.deepEqual(deepSeekModelInput(), ['text'])
  const source = readFileSync('src/services/deepSeekHarness.ts', 'utf8')
  assert.match(source, /imageInput\?: boolean/)
  assert.match(source, /\.\.\.modelInputLines/)
  assert.match(source, /\[`            input: \$\{JSON\.stringify\(deepSeekModelInput\(true\)\)\}`\]/)
  // 模态影响 patch 内容，就必须进 Runtime key：否则读会话时建的纯文本 Runtime
  // 会被第一轮发送直接复用，修好的声明永远不生效。
  assert.match(source, /deepSeekModelInput\(input\.imageInput\)\.join\(/)
})

test('DeepSeek Harness sends materialized images through native SDK blocks', () => {
  assert.deepEqual(
    deepSeekContentBlocks('看图', [{
      id: 'image-1', name: 'image.png', mime: 'image/png', size: 3, kind: 'image',
      value: 'data:image/png;base64,QUJD', previewUrl: 'blob:thumbnail',
    }], [], true),
    [{ type: 'text', text: '看图' }, { type: 'image', data: 'QUJD', mimeType: 'image/png' }],
  )
})

test('DeepSeek Harness tells the model when an attached image cannot be delivered', () => {
  const image = {
    id: 'image-1', name: 'image.png', mime: 'image/png', size: 3, kind: 'image' as const,
    value: 'data:image/png;base64,QUJD',
  }
  // 不声明图片输入的模型：不发图片块，但必须把“没送达”说出来。
  // 不说的后果实测是模型拿着附件 id 满盘找图（11 步工具 / 16 分钟 / 524）。
  assert.deepEqual(
    deepSeekContentBlocks('看图', [image], []),
    [{ type: 'text', text: '看图\n\n[附带 1 张图片，当前模型不支持视觉]' }],
  )
  // 声明了图片输入但格式不支持时，同样不能静默丢。
  assert.deepEqual(
    deepSeekContentBlocks('看图', [{ ...image, mime: 'image/heic', value: 'data:image/heic;base64,QUJD' }], [], true),
    [{ type: 'text', text: '看图\n\n[附带 1 张图片，当前格式不受支持（仅支持 PNG/JPEG/WebP/GIF）]' }],
  )
})

test('DeepSeek Harness sends already-read files in the first prompt', () => {
  assert.deepEqual(
    deepSeekContentBlocks('修改它', [], [{ name: 'wiki/方案.md', content: '# 旧方案' }]),
    [{ type: 'text', text: '修改它\n\n[已读取文件: wiki/方案.md]\n# 旧方案' }],
  )
})

test('DeepSeek Harness reads the committed assistant message', () => {
  assert.equal(
    deepSeekAssistantText({
      type: 'assistant/message',
      data: {
        message: {
          content: [
            { type: 'text', text: '完成' },
            { type: 'image' },
            { type: 'text', text: '。' },
          ],
        },
      },
    }),
    '完成。',
  )
  assert.equal(deepSeekAssistantText({ type: 'tool/result', data: {} }), '')
})

test('DeepSeek Harness projects its official Session log into visible conversation turns', () => {
  assert.deepEqual(deepSeekSessionTurns({
    session: { id: 'jc-v1-conversation-1' },
    events: [
      {
        seq: 3, time: 1_700_000_000_000, type: 'user/message',
        data: { id: 'user-1', source: { kind: 'user' }, content: [{ type: 'text', text: '/skill-creator\n\n修改文件' }] },
      },
      {
        seq: 4, time: 1_700_000_001_000, type: 'user/message',
        data: { id: 'notice-1', source: { kind: 'skill-invocation' }, content: [{ type: 'text', text: '内部注入' }] },
      },
      {
        seq: 5, time: 1_700_000_002_000, type: 'assistant/message',
        data: { message: { id: 'assistant-1', content: [{ type: 'text', text: '已完成' }] } },
      },
    ],
  }), [
    {
      id: 'user-1', role: 'user', content: '修改文件', createdAt: '2023-11-14T22:13:20.000Z',
      toolChips: ['dh-session-v1'],
    },
    {
      id: 'assistant-1', role: 'assistant', content: '已完成', createdAt: '2023-11-14T22:13:22.000Z',
    },
  ])
})

test('DeepSeek Harness streams visible text in order and lets committed text stay authoritative', () => {
  const state = { attemptId: '', nextIndex: 0, text: '', reasoning: '', turn: 0, step: 0 }
  assert.equal(applyDeepSeekAssistantStream(state, {
    type: 'start', attemptId: 'attempt-1', turn: 1, step: 1,
  }), '')
  assert.equal(applyDeepSeekAssistantStream(state, {
    type: 'chunk', attemptId: 'attempt-1', index: 0,
    chunk: { type: 'text-delta', index: 0, text: '正在' },
  }), '正在')
  assert.equal(applyDeepSeekAssistantStream(state, {
    type: 'chunk', attemptId: 'attempt-1', index: 1,
    chunk: { type: 'reasoning-delta', index: 0, text: '隐藏推理' },
  }), undefined)
  assert.equal(applyDeepSeekAssistantStream(state, {
    type: 'chunk', attemptId: 'attempt-1', index: 2,
    chunk: { type: 'text-delta', index: 0, text: '输出' },
  }), '正在输出')
  assert.equal(applyDeepSeekAssistantStream(state, {
    type: 'chunk', attemptId: 'attempt-1', index: 2,
    chunk: { type: 'text-delta', index: 0, text: '重复' },
  }), undefined)
})

// 本条的旧版本（2026-09-23）断言的是「不泄漏 arguments」：那时工具行只有中文标签。
// 第一档把它换成白名单摘要（见 [[开发/韭菜盒子Harness输出显示对齐官方TDD-2026-09-27]] §3.2）：
// 本地工作台里用户需要知道 agent 在动哪个文件、跑什么命令，而白名单之外的字段
// （写入内容、文件正文、密钥）仍然不显示。
test('DeepSeek Harness exposes tool progress with a whitelisted argument summary', () => {
  assert.deepEqual(deepSeekProgress({
    type: 'tool/call', data: { callId: 'call-1', name: 'read', arguments: '{"file_path":"wiki/方案.md","content":"不该上屏的正文"}' },
  }), { id: 'call-1', label: '读取文件', state: 'running', summary: 'wiki/方案.md' })
  assert.deepEqual(deepSeekProgress({
    type: 'tool/result', data: { message: { toolCallId: 'call-1' } },
  }), { id: 'call-1', state: 'done', resultText: '', resultTruncated: false })
  assert.deepEqual(deepSeekProgress({
    type: 'tool/result', data: { message: { toolCallId: 'call-1', isError: true } },
  }), { id: 'call-1', state: 'failed', resultText: '', resultTruncated: false })
  assert.equal(
    deepSeekProgress({ type: 'tool/result', data: { message: { toolCallId: 'call-1', isError: true, content: [{ type: 'text', text: 'Error: 读不了' }] } } })?.errorReason,
    'Error: 读不了',
  )
  assert.equal(deepSeekProgress({ type: 'assistant/message', data: {} }), undefined)
})

test('Harness labels every official SDK tool instead of falling back to its raw name', () => {
  // 官方 `--profile sdk` 工具面：实测 request/header 暴露的 24 个名字。
  // 清单与来源插件登记在 [[开发/韭菜盒子Harness会话与可选建库统一合同-2026-09-24]]。
  const officialTools = [
    'bash', 'create_goal', 'edit', 'exit_plan_mode', 'get_goal', 'glob', 'grep',
    'interrupt_agent', 'job_kill', 'job_list', 'job_output', 'list_agents', 'read',
    'read_image', 'send_message', 'skill', 'subagent', 'subagent_fork', 'todo_write',
    'update_goal', 'web_fetch', 'web_search', 'workflow', 'write',
  ]
  for (const name of officialTools) {
    const progress = deepSeekProgress({ type: 'tool/call', data: { callId: 'call-1', name } })
    assert.ok(String(progress?.label || '').trim(), `${name} 缺少标签`)
    assert.doesNotMatch(
      String(progress?.label),
      /^执行 [\w-]+$/,
      `${name} 落到了兜底标签，应在 DEEPSEEK_TOOL_LABELS 中登记`,
    )
  }
})

test('DeepSeek Harness exposes terminal turn failures instead of completing on idle', () => {
  assert.equal(
    deepSeekTurnError({
      type: 'turn/end',
      data: {
        reason: {
          kind: 'error',
          error: { code: 'PI_AI_ERROR', message: 'The service is temporarily unavailable.' },
        },
      },
    }),
    'The service is temporarily unavailable.',
  )
  assert.equal(deepSeekTurnError({ type: 'turn/end', data: { reason: { kind: 'complete' } } }), '')
})

test('desktop package pins and embeds the official Harness SDK client with Node', () => {
  const runtimePackage = JSON.parse(
    readFileSync('src-tauri/resources/deepseek-harness/package.json', 'utf8'),
  )
  const tauri = readFileSync('src-tauri/tauri.conf.json', 'utf8')
  assert.equal(runtimePackage.dependencies['@deepseek-ai/dsh-sdk-client'], '0.1.7-alpha.2')
  assert.equal(runtimePackage.dependencies.node, '22.23.2')
  assert.match(tauri, /resources\/deepseek-harness/)
  assert.match(tauri, /build:deepseek-harness/)

  // 光在 beforeBuildCommand 里准备不够：CI 为了注入环境变量会把 beforeBuildCommand 置空，
  // 只跑 build:desktop:quick。准备步骤必须长在那条命令里，否则装出来的包一开口就报
  // 「无法启动 MCP 进程: os error 2」，而开发态完全正常。
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts
  assert.match(scripts['build:desktop:quick'], /build:deepseek-harness/)
  assert.match(readFileSync('scripts/audit-desktop-dist.mjs', 'utf8'), /harnessNode/)
})

test('Harness keeps its runtime state in app data instead of the user project', () => {
  const source = readFileSync('src/services/deepSeekHarness.ts', 'utf8')
  const runner = readFileSync('src-tauri/resources/deepseek-harness/runner.mjs', 'utf8')
  // 重试原因必须上状态行：带 failure 的事件已经给了 code 与原始文案，
  // 只报「正在重试」时用户无法区分“上游限流”和“自己的代码在转圈”。
  assert.match(source, /const detail = \[failure\?\.code, String\(failure\?\.message/)
  assert.match(source, /appDataDir\(\)/)
  assert.match(source, /writeTextFile\(patchPath/)
  assert.match(source, /dev_copy_external/)
  assert.match(source, /resolveResource\([^)]*node\/bin\//s)
  assert.match(source, /maxRetries: 1/)
  assert.match(source, /- SERVER/)
  assert.match(source, /PI_AI_ERROR/)
  assert.match(source, /DSH_PERMISSION_MODE: deepSeekPermissionMode\(input\.fileAccessEnabled\)/)
  assert.match(source, /resolve_creation_mcp/)
  assert.match(source, /@deepseek-ai\/dsh-mcp-client/)
  assert.match(source, /JIUCAIHEZI_PROXY_CAPABILITIES/)
  assert.match(source, /JIUCAIHEZI_PROXY_MCP_SERVER/)
  assert.match(source, /const needsCreation = input\.avSelected/)
  assert.match(source, /JIUCAIHEZI_CREATION_CAPABILITIES: 'av'/)
  assert.match(source, /runtimeKey\(input\)/)
  assert.match(source, /wireSessionId = deepSeekSessionId\(input\.sessionId\)/)
  assert.doesNotMatch(source, /sessionNonce/)
  assert.match(source, /await waitForRuntimeClose\(active, DEEPSEEK_HARNESS_SHUTDOWN_TIMEOUT_MS\)/)
  assert.doesNotMatch(source, /active\.closed,[\s\S]{0,100}2_000/)
  assert.match(runner, /DeepSeekHarness.*@deepseek-ai\/dsh-sdk-client/s)
  assert.match(runner, /await harness\.close\(\)/)
  const prepare = readFileSync('scripts/prepare-deepseek-harness.mjs', 'utf8')
  assert.match(prepare, /session\.assistant-stream/)
  assert.match(prepare, /sessionPersistence/)
  assert.match(prepare, /agents\.resume/)
  assert.match(prepare, /session\/list/)
  assert.match(prepare, /session\/read/)
  assert.match(prepare, /const queryInject = 'const inject = \["agents", "sessionQuery"\];'/)
  assert.match(runner, /harness\.client\.request/)
  assert.doesNotMatch(source, /resolve_deepseek_harness/)
})

test('Harness run verdict belongs to its own session instead of a subagent turn', () => {
  const runner = readFileSync('src-tauri/resources/deepseek-harness/runner.mjs', 'utf8')
  // 子代理事件共用同一条通知流；没有这道会话过滤，子会话的失败会顶替本轮结论。
  assert.match(runner, /const ownSession = params\?\.sessionId === command\.sessionId/)
  assert.match(runner, /ownSession && notification\.method === 'session\.event'/)
})

test('Harness subagent calls return a result instead of a fire-and-forget id', () => {
  const source = readFileSync('src/services/deepSeekHarness.ts', 'utf8')
  // continuable 模式下 run_in_background 默认 true：父代理只拿到 “started subagent <id>”，
  // 会误判完成并重复派活。one-shot 让调用等结果。
  assert.match(source, /'    backgroundMode: one-shot'/)
  assert.doesNotMatch(source, /backgroundMode: continuable/)
  // patch 按顶层键整体替换 config：基线的 provider/toolName 必须一起给出，否则会被抹掉。
  assert.match(source, /'- id: tool-subagent'/)
  assert.match(source, /'    provider: spawn'/)
  assert.match(source, /'    toolName: subagent'/)
})

test('Harness runtimes are owned per workspace instead of one replaceable app singleton', () => {
  const source = readFileSync('src/services/deepSeekHarness.ts', 'utf8')
  assert.match(source, /const runtimes = harnessRegistry\.runtimes/)
  assert.match(source, /function workspaceRuntimeKey\(input: DeepSeekHarnessInput\)/)
  assert.doesNotMatch(source, /let runtime: Runtime \| null/)
  assert.doesNotMatch(source, /await stopDeepSeekHarness\(\)\s*\n\s*runtime = await createRuntime/)
  assert.match(source, /stopRuntime\(active\)/)
  assert.match(source, /ensureRuntime\(input, true\)/)
  assert.match(source, /if \(!active\.closing\) return active/)
  assert.doesNotMatch(source, /await stopRuntime\(await current\.ready\) \} catch/)
})

// ===== 输出显示第一档 =====
// 方案与证据：[[开发/韭菜盒子Harness输出显示对齐官方TDD-2026-09-27]]

/**
 * 真样本 fixture（2026-09-27 从本机真实 Harness 会话经官方 `session/read` 裁剪脱敏）：
 * 工作区 `D:\0925测试` → `D:\work\demo`，用户目录 → `C:\Users\tester`。
 * 保留 turn 1 的前 3 个 step（glob / read_image 失败 / pwsh）与 turn 5 全量（read + 正文回答），
 * 共 30 个事件、5 个 assistant/message、4 个 tool/call。
 * 裁掉了 `assistant/message.data.stream`：本轮不消费，且它带完整正文分片会把 fixture 撑到 100KB。
 */
function toolsFixture(): any {
  return JSON.parse(readFileSync('src/services/__tests__/fixtures/dh-session-tools.json', 'utf8'))
}

function fixtureEvent(type: string, match?: (event: any) => boolean): any {
  const found = toolsFixture().events.find((event: any) => event.type === type && (!match || match(event)))
  assert.ok(found, `fixture 里没有 ${type}`)
  return found
}

test('真样本：今天的投影只留下有正文的轮次，工具步全部消失', () => {
  // 这是第一档要修的那个差距本身：会话有 5 个 assistant/message、4 次工具调用，
  // 而 deepSeekSessionTurns 只产出 2 个用户轮与 1 个正文轮——纯工具步（blocks=[tool-call]）
  // 因为正文为空根本不产出 turn。本条同时锁住：过程改走并列 Map，不动这个函数。
  const turns = deepSeekSessionTurns(toolsFixture())
  assert.equal(turns.filter(turn => turn.role === 'user').length, 2)
  assert.equal(turns.filter(turn => turn.role === 'assistant').length, 1)
})

test('真样本：工具步骤挂到发起该轮的用户消息上，纯工具轮不再消失', () => {
  const fixture = toolsFixture()
  const process = deepSeekSessionProcess(fixture)
  const userTurnIds = deepSeekSessionTurns(fixture).filter(turn => turn.role === 'user').map(turn => turn.id)

  // 归属必须是用户消息，不能是 assistant message：真样本里 turn 1 的 3 个工具步（完整会话是 10 个）
  // 全部 blocks=[tool-call]、无正文，不产出任何 assistant 轮次；挂在它上面就等于过程永远不可见。
  assert.deepEqual([...process.keys()], userTurnIds)
  assert.equal(process.size, 2)
  assert.equal([...process.values()].flat().length, 4)

  const first = process.get(userTurnIds[0]) ?? []
  assert.deepEqual(first.map(step => step.state), ['done', 'failed', 'done'])
  assert.equal(first[0].id, 'call_3b20c7fc703141618082b1f83f38f1f1')
  assert.equal(first[0].label, '查找文件')
  assert.equal(first[0].summary, 'D:\\work\\demo')
  assert.ok(Number(first[0].durationMs) > 0, '工具时长必须由 call→result 的时间算出')
  assert.match(String(first[2].summary), /^Get-ChildItem -Recurse -File \| ForEach-Object \{/)
  assert.ok(String(first[2].summary).endsWith('…'), '长命令必须截断')
})

test('没有真人发起人的轮次退回 assistant message 兜底，过程不丢', () => {
  // goal 续轮这类注入式轮次不带 `source.kind === 'user'` 的消息，没有兜底就会连过程一起丢。
  const snapshot = {
    session: { id: 's1' },
    events: [
      { seq: 0, type: 'turn/start', data: { turn: 4 } },
      { seq: 1, type: 'user/message', data: { id: 'ctx', source: { kind: 'runtime-context' }, content: [{ type: 'text', text: '上下文' }] } },
      { seq: 2, type: 'assistant/message', data: { turn: 4, step: 1, message: { id: 'm9', content: [{ type: 'tool-call', id: 'c9', name: 'read', arguments: '{"file_path":"a.md"}' }] } } },
      { seq: 3, type: 'tool/call', time: 100, data: { turn: 4, step: 1, callId: 'c9', name: 'read', arguments: '{"file_path":"a.md"}' } },
      { seq: 4, type: 'tool/result', time: 160, data: { turn: 4, step: 1, message: { toolCallId: 'c9', content: [{ type: 'text', text: '内容' }] } } },
    ],
  }
  const process = deepSeekSessionProcess(snapshot)
  assert.deepEqual([...process.keys()], ['m9'])
  assert.equal(process.get('m9')?.[0].durationMs, 60)
  assert.equal(process.get('m9')?.[0].summary, 'a.md')
})

test('真样本：失败的工具结果没有 error.reason 时，原因回退到结果正文', () => {  // 实测该次 read_image 失败：isError=true 但 error 整个是 undefined，失败说明只在 text 块里。
  // 只认 error.reason 的话，失败行会没有任何原因。
  const failed = [...deepSeekSessionProcess(toolsFixture()).values()].flat().find(step => step.state === 'failed')
  assert.ok(failed)
  assert.match(String(failed.errorReason), /^Error: cannot read/)
  assert.match(String(failed.errorReason), /does not declare image input/)
})

test('工具步骤带参数摘要与状态，摘要只取白名单字段', () => {
  const call = fixtureEvent('tool/call', event => event.data.name === 'glob')
  assert.deepEqual(deepSeekProgress(call), {
    id: call.data.callId,
    label: '查找文件',
    state: 'running',
    summary: 'D:\\work\\demo',
    startedAt: call.time,
  })

  const result = fixtureEvent('tool/result', event => event.data.message.toolCallId === call.data.callId)
  const settled = deepSeekProgress(result)
  assert.equal(settled?.id, call.data.callId)
  assert.equal(settled?.state, 'done')
  assert.equal(settled?.endedAt, result.time)
  assert.match(String(settled?.resultText), /^wiki\\index\.md/)
  assert.equal(settled?.resultTruncated, false)
})

test('工具结果超长时截断并标记，摘要候选字段按实操键名兜底', () => {
  // 实测键名：read / read_image 用 file_path（不是 path），glob 用 path+pattern，
  // pwsh 用 command+description，skill 用 name。
  assert.equal(
    deepSeekProgress({ type: 'tool/call', data: { callId: 'c1', name: 'read', arguments: '{"file_path":"src/a.ts"}' } })?.summary,
    'src/a.ts',
  )
  assert.equal(
    deepSeekProgress({ type: 'tool/call', data: { callId: 'c2', name: 'skill', arguments: '{"name":"jc-daoju"}' } })?.summary,
    'jc-daoju',
  )
  // 参数不是合法 JSON 时必须退化为空摘要而不是抛错。
  assert.equal(
    deepSeekProgress({ type: 'tool/call', data: { callId: 'c3', name: 'read', arguments: '{not json' } })?.summary,
    '',
  )
  // 白名单之外的字段不显示（写入内容、密钥等）。
  assert.equal(
    deepSeekProgress({ type: 'tool/call', data: { callId: 'c4', name: 'write', arguments: '{"file_path":"a.md","content":"秘密正文"}' } })?.summary,
    'a.md',
  )
  const long = deepSeekProgress({ type: 'tool/call', data: { callId: 'c5', name: 'write', arguments: `{"file_path":"${'x'.repeat(500)}"}` } })
  assert.equal(String(long?.summary).length, 81)
  assert.ok(String(long?.summary).endsWith('…'))

  const longResult = deepSeekProgress({
    type: 'tool/result',
    data: { message: { toolCallId: 'c5', content: [{ type: 'text', text: 'y'.repeat(9_000) }] } },
  })
  assert.equal(longResult?.resultTruncated, true)
  assert.equal(String(longResult?.resultText).length, DEEPSEEK_PROCESS_RESULT_LIMIT + 1)
})

test('assistant 消息里的 reasoning 块按顺序取出，正文取值不变', () => {
  // 形状来自官方 `dsh-llm` 的 `ReasoningBlock`：它是 `content` 里的普通块，
  // 与 tool-call 块同级。本机真样本（16/16 assistant/message）尚无推理，
  // 上游是否产生推理的记录见 TDD §2.3 第 4 条。
  const event = {
    type: 'assistant/message',
    data: {
      turn: 1,
      step: 1,
      message: {
        id: 'm1',
        content: [
          { type: 'reasoning', text: '先看目录' },
          { type: 'text', text: '正文一' },
          { type: 'reasoning', text: '再确认一次' },
          { type: 'text', text: '正文二' },
        ],
      },
    },
  }
  assert.equal(deepSeekAssistantReasoning(event), '先看目录再确认一次')
  assert.equal(deepSeekAssistantText(event), '正文一正文二')
  assert.equal(deepSeekAssistantReasoning({ type: 'tool/call', data: {} }), '')
  assert.equal(deepSeekAssistantReasoning({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '无推理' }] } } }), '')
})

test('快照投影把推理按发起该轮的用户消息挂出来，多 step 按顺序拼接', () => {
  const snapshot = {
    session: { id: 's1' },
    events: [
      { seq: 0, type: 'turn/start', data: { turn: 1 } },
      { seq: 1, type: 'user/message', data: { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: '问' }] } },
      { seq: 2, type: 'assistant/message', data: { turn: 1, step: 1, message: { id: 'm1', content: [{ type: 'reasoning', text: '先想' }] } } },
      { seq: 3, type: 'assistant/message', data: { turn: 1, step: 2, message: { id: 'm2', content: [{ type: 'reasoning', text: '再想' }, { type: 'text', text: '答案' }] } } },
    ],
  }
  assert.deepEqual([...deepSeekSessionReasoning(snapshot).entries()], [['u1', '先想\n\n再想']])
  // 没有推理的现实情况下返回空表，不造假条目。
  assert.deepEqual([...deepSeekSessionReasoning(toolsFixture()).entries()], [])
  assert.deepEqual([...deepSeekSessionReasoning({ session: { id: 's' }, events: [] }).entries()], [])
})

test('usage 只在官方报告时给出，缺省不填 0 也不估算', () => {
  assert.deepEqual(deepSeekMessageUsage(fixtureEvent('assistant/message')), {
    inputTokens: 7128,
    outputTokens: 131,
    totalTokens: 7259,
  })
  assert.equal(deepSeekMessageUsage({ type: 'assistant/message', data: { message: { id: 'm' } } }), undefined)
  assert.equal(deepSeekMessageUsage({ type: 'tool/call', data: {} }), undefined)
})

test('流式帧分开累积推理与正文，正文增量不受推理分片影响', () => {
  const state = { attemptId: '', nextIndex: 0, text: '', reasoning: '', turn: 0, step: 0 }
  assert.equal(applyDeepSeekAssistantStream(state, {
    type: 'start', attemptId: 'attempt-9', revision: 1, turn: 3, step: 2,
  }), '')
  assert.equal(state.turn, 3)
  assert.equal(state.step, 2)
  assert.equal(applyDeepSeekAssistantStream(state, {
    type: 'chunk', attemptId: 'attempt-9', revision: 1, index: 0, time: 1,
    chunk: { type: 'reasoning-delta', index: 0, text: '想想' },
  }), undefined)
  assert.equal(state.reasoning, '想想')
  assert.equal(applyDeepSeekAssistantStream(state, {
    type: 'chunk', attemptId: 'attempt-9', revision: 1, index: 1, time: 2,
    chunk: { type: 'text-delta', index: 0, text: '开始' },
  }), '开始')
  assert.equal(applyDeepSeekAssistantStream(state, {
    type: 'chunk', attemptId: 'attempt-9', revision: 1, index: 2, time: 3,
    chunk: { type: 'reasoning-delta', index: 0, text: '完' },
  }), undefined)
  assert.equal(state.reasoning, '想想完')
  assert.equal(state.text, '开始')
  // tool-call-delta / usage / finish 只推进序号，不产生正文。
  assert.equal(applyDeepSeekAssistantStream(state, {
    type: 'chunk', attemptId: 'attempt-9', revision: 1, index: 3, time: 4,
    chunk: { type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } },
  }), undefined)
  assert.equal(state.nextIndex, 4)
})

test('Harness runtime registry survives a module hot replacement', () => {
  const source = readFileSync('src/services/deepSeekHarness.ts', 'utf8')
  // Vite 热替换会重新求值本模块：模块级 Map 一丢，唯一指向运行时的引用就没了，
  // 进程还活着并握着会话写锁，而 App 再也关不掉它（07:29/07:33/07:41/07:52 四个泄漏运行时）。
  assert.match(source, /__JC_DEEPSEEK_HARNESS__ \?\?=/)
  assert.match(source, /globalThis as unknown as Record<string, unknown>/)
  assert.doesNotMatch(source, /^const runtimes = new Map/m)
})

test('Harness shutdown is bounded and always reaps the runtime', () => {
  const source = readFileSync('src/services/deepSeekHarness.ts', 'utf8')
  // 官方 close 的拆卸阶梯有界：shutdown 1s → stdin EOF 宽限 6s → 强杀 3s。
  const timeout = Number(
    source.match(/DEEPSEEK_HARNESS_SHUTDOWN_TIMEOUT_MS = ([\d_]+)/)?.[1].replace(/_/g, ''),
  )
  assert.ok(timeout > 10_000, `等待上限必须高于官方阶梯（实测 ${timeout}）`)
  assert.match(source, /if \(!await waitForRuntimeClose\(active, DEEPSEEK_HARNESS_SHUTDOWN_TIMEOUT_MS\)\)/)
  // 兜底必须无条件执行：进程已死/写不进去时 `closed` 永不来，没有这句就永远收不到尾。
  assert.match(source, /finally \{\s*\/\/[\s\S]*?await active\.transport\.close\(\)\.catch\(\(\) => \{\}\)\s*\}/)
  assert.doesNotMatch(source, /await active\.closed\s*\n\s*\} finally/)
})

test('Harness refuses a second concurrent run on the same session', () => {
  const source = readFileSync('src/services/deepSeekHarness.ts', 'utf8')
  // 官方把「同一会话的并发 resume」划给调用方排除，撞上去只会拿到 SessionAlreadyOwnedError。
  assert.match(source, /if \(runningSessions\.has\(wireSessionId\)\) throw new Error\(DEEPSEEK_HARNESS_BUSY_MESSAGE\)/)
  assert.match(source, /runningSessions\.add\(wireSessionId\)/)
  assert.match(source, /finally \{\s*runningSessions\.delete\(wireSessionId\)\s*\}/)
  assert.match(source, /const runningSessions = harnessRegistry\.runningSessions/)
})

test('Harness stdio children are reaped as a process tree', () => {
  const rust = readFileSync('src-tauri/src/commands/mcp.rs', 'utf8')
  const lib = readFileSync('src-tauri/src/lib.rs', 'utf8')
  // 只杀直接子进程会留下 runner 拉起的 dsh 孙进程，它握着会话的跨进程内核写锁且永不过期。
  assert.match(rust, /fn tree_kill_plan\(pid: u32\)/)
  assert.match(rust, /vec!\["\/T"\.into\(\), "\/F"\.into\(\), "\/PID"\.into\(\), pid\.to_string\(\)\]/)
  assert.match(rust, /cmd\.process_group\(0\)/)
  assert.match(rust, /if let Some\(pid\) = process\.child\.id\(\) \{\s*kill_process_tree\(pid\)/)
  assert.match(rust, /pub fn mcp_reap_stale_harness\(\) -> usize/)
  // 页面重载收 Harness 运行时；应用退出收所有 stdio 进程树。
  assert.match(readFileSync('src/main.ts', 'utf8'), /invoke<number>\('mcp_reap_stale_harness'\)/)
  assert.match(lib, /commands::mcp::reap_all_stdio_processes\(\)/)
})

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
  deepSeekPermissionChip,
  DEEPSEEK_DEFAULT_PERMISSION_TIER,
  DEEPSEEK_PERMISSION_TIERS,
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
  // 三档逐字用官方 zh 字典；默认档与官方 sandbox-policy 缺省值一致。
  assert.deepEqual(
    DEEPSEEK_PERMISSION_TIERS.map(option => [option.tier, option.label]),
    [['read-only', '仅可查看'], ['workspace-write', '工作区内修改'], ['danger-full-access', '完全权限']],
  )
  // 按钮上的短名：只有中间档需要缩，另外两档全名本来就短。
  assert.deepEqual(
    DEEPSEEK_PERMISSION_TIERS.map(option => [option.tier, option.short]),
    [['read-only', '仅可查看'], ['workspace-write', '工作区'], ['danger-full-access', '完全权限']],
  )
  // 中间档越界是 fail-closed 拒绝，不是弹窗询问 —— DH 路径下没有应答 approval/request 的通道，
  // 文案不能承诺一个不存在的弹窗。
  assert.equal(DEEPSEEK_PERMISSION_TIERS[1].note, '只能改工作区内的文件，越界会被拒绝')
  assert.equal(DEEPSEEK_DEFAULT_PERMISSION_TIER, 'workspace-write')
  // 档位 → 持久化芯片（只写不读）：默认档不落芯片，`file` 与旧会话的「开」一一对应。
  assert.equal(deepSeekPermissionChip('workspace-write'), undefined)
  assert.equal(deepSeekPermissionChip('danger-full-access'), 'file')
  assert.equal(deepSeekPermissionChip('read-only'), 'file:read-only')
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
      { seq: 2, time: 1_700_000_000_000, type: 'turn/start', surfaceOp: 'append', data: { turn: 1 } },
      {
        seq: 3, time: 1_700_000_000_000, type: 'user/message', surfaceOp: 'append',
        data: { id: 'user-1', source: { kind: 'user' }, content: [{ type: 'text', text: '/skill-creator\n\n修改文件' }] },
      },
      {
        seq: 4, time: 1_700_000_001_000, type: 'user/message', surfaceOp: 'append',
        data: { id: 'notice-1', source: { kind: 'skill-invocation' }, content: [{ type: 'text', text: '内部注入' }] },
      },
      {
        seq: 5, time: 1_700_000_002_000, type: 'assistant/message', surfaceOp: 'append',
        data: { turn: 1, step: 1, message: { id: 'assistant-1', content: [{ type: 'text', text: '已完成' }] } },
      },
      { seq: 6, time: 1_700_000_002_500, type: 'turn/end', surfaceOp: 'append', data: { turn: 1, reason: { kind: 'completed' } } },
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
  assert.match(source, /DSH_PERMISSION_MODE: input\.permissionTier \?\? DEEPSEEK_DEFAULT_PERMISSION_TIER/)
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
  // 这是第一档要修的那个差距本身：会话有 5 个 assistant/message、4 次工具调用。
  // 2026-09-28 改写（旧断言：assistant 轮只有 1 条）。现在一轮一条记录：
  // turn 5 的末步有正文 → 产出答案；turn 1 三步全是 tool-call、无正文 → 产出**内容为空**的
  // 锚点轮次（只给过程块做挂载点，侧栏由 turnHasBody() 判掉），因为纯工具轮的过程也得有地方可画。
  const turns = deepSeekSessionTurns(toolsFixture())
  assert.equal(turns.filter(turn => turn.role === 'user').length, 2)
  const assistants = turns.filter(turn => turn.role === 'assistant')
  assert.equal(assistants.length, 2)
  assert.equal(assistants.filter(turn => turn.content).length, 1)
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
      { seq: 1, type: 'user/message', surfaceOp: 'append', data: { id: 'ctx', source: { kind: 'runtime-context' }, content: [{ type: 'text', text: '上下文' }] } },
      { seq: 2, type: 'assistant/message', surfaceOp: 'append', data: { turn: 4, step: 1, message: { id: 'm9', content: [{ type: 'tool-call', id: 'c9', name: 'read', arguments: '{"file_path":"a.md"}' }] } } },
      { seq: 3, type: 'tool/call', time: 100, data: { turn: 4, step: 1, callId: 'c9', name: 'read', arguments: '{"file_path":"a.md"}' } },
      { seq: 4, type: 'tool/result', time: 160, surfaceOp: 'append', data: { turn: 4, step: 1, message: { toolCallId: 'c9', content: [{ type: 'text', text: '内容' }] } } },
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
      { seq: 1, type: 'user/message', surfaceOp: 'append', data: { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: '问' }] } },
      { seq: 2, type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, message: { id: 'm1', content: [{ type: 'reasoning', text: '先想' }] } } },
      { seq: 3, type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 2, message: { id: 'm2', content: [{ type: 'reasoning', text: '再想' }, { type: 'text', text: '答案' }] } } },
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
  // 页面重载收 Harness 运行时；应用退出收所有 stdio 进程树。
  assert.match(rust, /pub fn mcp_reap_stale_harness\(/)
  assert.match(readFileSync('src/main.ts', 'utf8'), /'mcp_reap_stale_harness', \{ realm: MCP_REALM_ID \}/)
  assert.match(lib, /commands::mcp::reap_all_stdio_processes\(\)/)
})

test('a window only reaps its own previous webpage, never another window', () => {
  const rust = readFileSync('src-tauri/src/commands/mcp.rs', 'utf8')
  const transport = readFileSync('src/services/mcpStdioTransport.ts', 'utf8')
  const main = readFileSync('src/main.ts', 'utf8')
  // 归属 = (窗口 label, 页面 realm)。只看 label 收不掉 dev 重挂留下的 runner（label 没变），
  // 完全不看 label 则新窗口一挂载就把别的窗口正在跑的那一轮杀了。
  assert.match(rust, /struct Owner \{\s*window: String,\s*realm: String,/)
  assert.match(rust, /fn is_orphan\(owner: Option<&Owner>, scope: Option<&ReapScope<'_>>\) -> bool/)
  assert.match(rust, /owner\.window == scope\.window && owner\.realm != scope\.realm/)
  assert.match(rust, /scope\.live_windows\.iter\(\)\.any\(\|live\| live == &owner\.window\)/)
  // 收割只碰 Harness 运行时：新页面挂载时创作 MCP 等 stdio 子进程可能已经起来了。
  assert.match(rust, /filter\(\|\(_, process\)\| !only_harness \|\| process\.is_harness_runner\)/)
  // realm 由前端每次挂载生成，并随 spawn 上报；窗口 label 由 Rust 注入，前端不传。
  assert.match(transport, /export const MCP_REALM_ID = crypto\.randomUUID\(\)/)
  assert.match(transport, /realm: MCP_REALM_ID,/)
  assert.match(rust, /window: tauri::WebviewWindow,/)
  assert.match(main, /invoke<number>\('mcp_reap_stale_harness', \{ realm: MCP_REALM_ID \}\)/)
})

test('a second launch focuses the existing instance instead of starting another process', () => {
  const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8')
  const lib = readFileSync('src-tauri/src/lib.rs', 'utf8')
  // 没有单实例插件，双击图标会起第二个完整进程：各自一份 Rust 全局状态、各自一份 runner。
  // deep-link 特性必须开：否则第二次登录回调会被那个已经退出的进程吞掉。
  assert.match(cargo, /tauri-plugin-single-instance = \{ version = "2", features = \["deep-link"\] \}/)
  assert.match(lib, /tauri_plugin_single_instance::init\(/)
  assert.match(lib, /fn focus_existing_window\(app: &tauri::AppHandle\)/)
  // 单实例必须最先注册。
  assert.ok(
    lib.indexOf('tauri_plugin_single_instance::init') < lib.indexOf('tauri_plugin_fs::init'),
    '单实例插件必须排在其它插件之前注册',
  )
})

test('an existing session is switched to the @文件 permission instead of keeping its pinned default', () => {
  const source = readFileSync('src/services/deepSeekHarness.ts', 'utf8')
  const runner = readFileSync('src-tauri/resources/deepseek-harness/runner.mjs', 'utf8')
  const prepare = readFileSync('scripts/prepare-deepseek-harness.mjs', 'utf8')
  // 会话把权限记成 durable 事实。实测会话文件里三条都在：
  //   permission/preset = workspace-write、sandbox/mode = workspace-write、approval/policy = ask
  // 进程级 DSH_PERMISSION_MODE 只决定**新会话**的默认值；已存在的会话按官方
  // pinInitialPermission 保留自己的开关，所以打开 @文件 也松不开沙箱——写 ~/.agents/skills
  // 会拿到 [sandbox: file access denied under workspace-write mode]，用户看到的就是「没有权限」。
  assert.match(source, /async function alignSessionPermission\(/)
  assert.match(source, /await alignSessionPermission\(active, wireSessionId, input\.permissionTier\)/)
  // 每个 (runtime, 会话) 只切一次：runtimeKey 已经含权限模式，模式一变就是新 runtime。
  assert.match(source, /if \(active\.permissions\.get\(sessionId\) === preset\) return/)
  assert.match(source, /preset: DeepSeekPermissionTier = DEEPSEEK_DEFAULT_PERMISSION_TIER/)
  // 切换只能走官方命令面：SDK 通道只暴露 session/prompt|list|read，没有任何权限方法。
  assert.match(prepare, /const commandInject = 'const inject = \["agents", "sessionQuery", "commands"\];'/)
  assert.match(prepare, /case "session\/permission": return this\.permission\(params\);/)
  assert.match(prepare, /commands"\)\.execute\(rec\.handle\.agent, "\/permission " \+ preset/)
  assert.match(runner, /command\.type === 'permission'/)
  assert.match(runner, /harness\.client\.request\('session\/permission'/)
})

test('attachments are addressable by project path, not only by inline content', () => {
  const blocks = deepSeekContentBlocks(
    '看一下',
    [
      { id: 'a1', name: '原图.png', mime: 'image/png', size: 10, kind: 'image', resourcePath: '.raw/jc-media/图片/原图.png' },
      { id: 'a2', name: '片段.mp4', mime: 'video/mp4', size: 10, kind: 'video', resourcePath: '.raw/jc-media/视频/片段.mp4' },
    ] as never,
    [],
    false,
  )
  const text = String(blocks.find((block: any) => block.type === 'text')?.text || '')
  // 内联图片块只对声明了视觉的模型有效，视频连块都没有。路径必须无条件给出去：
  // 官方读图是 read_image(file_path)，视频则是 bash 抽帧（jc-watch 那条链路）。
  // 不给路径时模型手里只有一个附件 id，只能满盘找文件（实测 11 步工具、16 分钟后 524）。
  assert.match(text, /\.raw\/jc-media\/图片\/原图\.png/)
  assert.match(text, /\.raw\/jc-media\/视频\/片段\.mp4/)
  assert.match(text, /read_image/)
})

test('a live Harness run shows its process inside the message flow instead of a five-row strip', () => {
  const workbench = readFileSync('src/components/memory/MemoryWorkbench.vue', 'utf8')
  const runtime = readFileSync('src/services/desktopConversationRuntime.ts', 'utf8')
  // 官方把过程放在轮次内持续显示、结果接在最后。原来只把最后 5 条塞在输入框上方的
  // 状态条里，跑完或断开就整条消失，用户看不到进程走到哪。实时必须与历史共用同一个投影
  // （官方：事件日志是 UI 投影的唯一真相），而不是两套渲染。
  assert.match(workbench, /const liveProcessTurnId = computed/)
  assert.match(workbench, /turnId === liveProcessTurnId\.value/)
  // 自研内核（Web 未发布工作台）仍保有自己的缩略；DH 的过程在轮次内渲染，不能再重一次。
  assert.match(workbench, /activeRun\.value\?\.runtime === 'legacy' \? activeRun\.value\.steps\.slice\(-5\) : \[\]/)
  // 工具结果也实时可见，不只在跑完后的 Session 快照里。
  assert.match(runtime, /resultText\?: string/)
  assert.match(runtime, /step\.resultText = progress\.resultText/)
})

test('bundled product skills reach the Harness instead of forcing a disk crawl', () => {
  const source = readFileSync('src/services/deepSeekHarness.ts', 'utf8')
  // 内置 Skill 在 public/skills，打包成 resources/skills。官方 skill 扫描根里没有它
  // （bundledSkillDir 与 DSH_BUNDLED_SKILL_DIR 都没配），所以 jc-watch / skill-creator /
  // wiki-memory / jc-new-user-guide 这四个对模型完全不存在。实测模型只能
  // `find /Users/by3 -maxdepth 6 -iname "*jc-watch*"` —— 撞上 60 秒沙箱超时被截断，
  // 再靠 job_output 取回，白烧一分多钟。这是我们没给它信息，不是模型笨。
  assert.match(source, /async function bundledSkillsDirectory\(/)
  // 探测必须在 Rust：前端 fs 插件的 exists() 受 capability 的 scope 限制（只放行
  // `$APPDATA/**`、`$HOME/.agents/**` 等），探 target/debug/skills 会直接抛
  // `forbidden path ... allow-exists`，整个 run 0.00 秒就死在那一句上。
  assert.match(source, /invoke<string \| null>\('resolve_bundled_skills'\)/)
  assert.doesNotMatch(source, /await exists\(/)
  assert.match(source, /DSH_BUNDLED_SKILL_DIR/)
  const tools = readFileSync('src-tauri/src/commands/tools.rs', 'utf8')
  assert.match(tools, /pub\(crate\) fn bundled_skills_dir\(resource_dir: &Path\)/)
  assert.match(tools, /pub fn resolve_bundled_skills\(app: tauri::AppHandle\)/)
  // 新命令必须同时登记 ACL 白名单，否则 invoke 会被拒。
  assert.match(
    readFileSync('src-tauri/permissions/app-commands.json', 'utf8'),
    /"resolve_bundled_skills"/,
  )
})

test('a running Harness turn carries no status banner, only the in-turn process', () => {
  const workbench = readFileSync('src/components/memory/MemoryWorkbench.vue', 'utf8')
  // 官方轨迹视图明确「in-flight records show a start marker without inventing elapsed time」：
  // 运行中不挂横幅、不跳秒 —— 状态由轮次内的过程行表达。终态（失败/完成）仍要横幅，
  // 否则用户看不到失败原因（那次 524 就是靠它才看见的）。
  assert.match(workbench, /const runStripVisible = computed/)
  assert.match(workbench, /run\.runtime === 'legacy' \|\| run\.phase !== 'running'/)
  assert.match(workbench, /v-if="runStripVisible" class="memory-run-status"/)
  // 自研内核（Web 未发布工作台）还没有轮次内过程，保留它原来的 5 条缩略。
  assert.match(workbench, /activeRun\.value\?\.runtime === 'legacy' \? activeRun\.value\.steps\.slice\(-5\) : \[\]/)
  assert.doesNotMatch(workbench, /memory-run-think/)
})

test('blank assistant text and replaced copies stay out of the transcript', () => {
  // 官方 visibleAssistantEvent：只认 surfaceOp=append，text 块要 trim 后非空。
  // 真样本里纯工具步的正文就是两个换行（'\\n\\n'），不 trim 就会多出一个只有
  // 「韭菜盒子」四个字的空行；而被压缩替掉的副本官方明确「stay model-only」，不该上屏。
  const turns = deepSeekSessionTurns({
    session: { id: 's' },
    events: [
      { type: 'turn/start', seq: 1, time: 1, surfaceOp: 'append', data: { turn: 1 } },
      { type: 'assistant/message', seq: 2, time: 2, surfaceOp: 'append',
        data: { turn: 1, step: 1, message: { id: 'step1', content: [{ type: 'text', text: '\n\n' }, { type: 'tool-call' }] } } },
      { type: 'assistant/message', seq: 3, time: 3, surfaceOp: 'append',
        data: { turn: 1, step: 2, message: { id: 'step2', content: [{ type: 'text', text: '搞定 ✅' }] } } },
      { type: 'assistant/message', seq: 4, time: 4, surfaceOp: { op: 'replace', startSeq: 2, endSeq: 2 },
        data: { turn: 1, step: 1, message: { id: 'replaced', content: [{ type: 'text', text: '被替换的副本' }] } } },
      { type: 'turn/end', seq: 5, time: 5, surfaceOp: 'append', data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'user/message', seq: 6, time: 6, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '没有 surfaceOp 的旧事件' }] } },
    ],
  })
  assert.deepEqual(turns.map(turn => turn.content), ['搞定 ✅'])
})

test('the think row previews its latest line and an in-flight marker shows while waiting', () => {
  const workbench = readFileSync('src/components/memory/MemoryWorkbench.vue', 'utf8')
  // 官方 Chat：「Work-details modes control reasoning previews」—— 预览挂在推理行上，
  // 不是在输入框上方另起一条。
  assert.match(workbench, /function reasoningTail\(/)
  assert.match(workbench, /reasoningTail\(harnessReasoningFor\(turn\.id\)\)/)
  // 等模型的那 83 秒、那一分多钟必须看得见：过程区尾部给一个在飞标记，有工具行就换掉。
  assert.match(workbench, /const liveInFlight = computed/)
  assert.match(workbench, /isLiveTurn\(turn\.id\) && liveInFlight/)
})

test('completed Harness turns fold their process rows without hiding the answer', () => {
  const workbench = readFileSync('src/components/memory/MemoryWorkbench.vue', 'utf8')
  // 官方 Chat：「fold eligible completed-turn process rows without hiding final answers」。
  // 运行中强制展开；跑完交回浏览器默认（折叠），用 undefined 而不绑 false，
  // 否则每次重渲染都会把用户手动展开的状态抢回去。
  assert.match(workbench, /class="memory-process"[\s\S]{0,80}?:open="isLiveTurn\(turn\.id\) \|\| undefined"/)
})

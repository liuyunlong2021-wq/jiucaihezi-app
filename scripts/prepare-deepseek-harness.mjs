import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src-tauri',
  'resources',
  'deepseek-harness',
)
// 版本只由 package.json 提供：之前脚本里另写一份常量，升级时会与锁文件漂移。
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  .dependencies['@deepseek-ai/dsh-sdk-client']
const installed = join(root, 'node_modules', '@deepseek-ai', 'dsh-sdk-client', 'package.json')
const bundledNode = join(
  root,
  'node_modules',
  'node',
  'bin',
  process.platform === 'win32' ? 'node.exe' : 'node',
)
const ready = (
  existsSync(bundledNode) &&
  existsSync(installed) &&
  JSON.parse(readFileSync(installed, 'utf8')).version === version
)
if (!ready) {
  const result = spawnSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) process.exit(result.status || 1)
}

// ── 只留运行时要的东西 ──────────────────────────────────────────────
//
// 两处白拿的体积（2026-09-29 实测，打包后各占一份）：
//
// 1. `node/node_modules/`（打好的 App 里 278M）—— `node` 这个 npm 包的**安装源**：
//    里面是同一个 Node 二进制**又一份**，外加 npm / share / include。
//    前端只用 `node/bin/node` 启动 harness（`src/services/deepSeekHarness.ts`），安装源用不到。
//    注：`node/bin/node` 与安装源里那个是硬链接，删掉后它仍在（链接数减少）——
//    已实测删完二进制照常执行。又：Tauri 打包会把硬链接摊成两份真文件，所以是打包后 278M、
//    而源码树里只有 63M。
//
// 1b. `node_modules/.bin/node` —— npm 给 `node` 包建的 bin 链接，指向 `../node/bin/node`。
//    源码树里是个 19 字节的符号链接，但 **Tauri 打包会解引用符号链接**，于是它在包里变成
//    第二份 107M 的二进制（实测：源码树 node_modules 452M，打进包变 559M，差额就是它）。
//    没有任何东西按这个名字找 node：前端用绝对路径启动 harness，SDK 里也没有裸 `node`
//    的 spawn；Rust 的 `resolve_mcp_node` 走的是系统 Node 与 PATH，不走这里。
//
// 2. `@deepseek-ai/libreoffice-kit*`（打好的 App 里 260M）—— 一整套 LibreOffice，
//    被官方 `dsh-office-to-pdf` 用来把 Office 文档渲染成 PDF。我们不用它：
//    `src/` 与 `src-tauri/src/` 对 officeToPdf 零引用，SDK 侧的引用方只有它自带 web UI 的
//    文档预览侧边栏（我们不渲染那套 UI）；读文档走的是内置 AnyDoc。
//    已实测：删掉后 `dsh --profile sdk` 照常初始化（退出码 0、DSH_HOME 正常创建、零 stderr）。
//
// ponytail: 就是删目录，没做依赖图分析。上游哪天把 officeToPdf 变成 agent 工具、
// 或我们开始用 SDK 自带的文档预览，把第 2 条去掉即可 —— 代价是安装包回到 500M 级。
const deepseekPackages = join(root, 'node_modules', '@deepseek-ai')
const removable = [
  join(root, 'node_modules', 'node', 'node_modules'),
  join(root, 'node_modules', 'node', 'installArchSpecificPackage.js'),
  join(root, 'node_modules', '.bin', 'node'),
  ...(existsSync(deepseekPackages)
    ? readdirSync(deepseekPackages)
        .filter(name => name.startsWith('libreoffice-kit'))
        .map(name => join(deepseekPackages, name))
    : []),
]
for (const target of removable) {
  if (!existsSync(target)) continue
  rmSync(target, { recursive: true, force: true })
  console.log(`[deepseek-harness] 已裁掉 ${relative(root, target)}`)
}

// LibreOffice 已由上面的既有规则裁掉；它的悬空 bin 链接会使 Tauri 资源打包失败。
rmSync(join(root, 'node_modules', '.bin', 'dsoffice'), { force: true })

// SDK client 在无控制台的桌面宿主中仍会再起一个 Node；管道不等于隐藏窗口。
const clientPath = join(root, 'node_modules', '@deepseek-ai', 'dsh-sdk-client', 'lib', 'index.js')
const client = readFileSync(clientPath, 'utf8')
const runtimeSpawn = 'const child = spawn(this.runtime.command, this.runtime.args, {\n'
const hiddenRuntimeSpawn = `${runtimeSpawn}\t\t\twindowsHide: true,\n`
if (!client.includes(hiddenRuntimeSpawn)) {
  if (!client.includes(runtimeSpawn)) throw new Error('Unsupported DeepSeek Harness SDK client spawn layout')
  writeFileSync(clientPath, client.replace(runtimeSpawn, hiddenRuntimeSpawn))
}

// 官方 0.2.1 保留恢复、等待和关闭流程；这里只补 SDK 尚未提供的工作台接口。
const serverPath = join(root, 'node_modules', '@deepseek-ai', 'dsh-sdk-jsonrpc-server', 'lib', 'index.js')
let server = readFileSync(serverPath, 'utf8')
function patch(before, after) {
  if (server.includes(after)) return
  if (!server.includes(before)) throw new Error('Unsupported DeepSeek Harness SDK layout: ' + before.slice(0, 100))
  server = server.replace(before, after)
}
const conversationUiUrl = '../../../../conversation-ui.mjs'
const conversationUiImport = `import { createConversationUi } from ${JSON.stringify(conversationUiUrl)};\n`
if (!server.includes(conversationUiImport)) server = conversationUiImport + server

const injectLine = server.match(/^const inject = (\[[^\n]+\]);$/m)
if (!injectLine) throw new Error('Unsupported DeepSeek Harness SDK injection layout')
const sdkDependencies = [...new Set([...JSON.parse(injectLine[1]), 'sessionQuery', 'commands', 'skills', 'storageDomain', 'sessionTitle', 'sessionProjections', 'sessions', 'tools'])]
patch(injectLine[0], `const inject = [${sdkDependencies.map(name => JSON.stringify(name)).join(', ')}];`)
patch('if (method === "initialize") await ctx.get("loader")?.await();', 'if (method === "initialize" || method === "session/check-tools") await ctx.get("loader")?.await();')
patch('import { ReasoningEffortId, createUserMessage } from "@deepseek-ai/dsh-llm";', 'import { ReasoningEffortId, createUserMessage, freezeMessage } from "@deepseek-ai/dsh-llm";')
const streamBridge = '\t\tthis.disposers.push(ctx.on("agent/assistant-stream", ({ agent, frame }) => {\n\t\t\tthis.transport.notify("session.assistant-stream", { sessionId: String(agent.session.id), frame });\n\t\t}, { global: true }));\n'
patch('\t\tconst serverOptions = this.options;\n', '\t\tconst serverOptions = this.options;\n' + streamBridge)
// Rebuild only our added dispatch cases so repeated preparation cannot duplicate them.
server = server.replace(/\n\t{3}case "session\/(?:list|read|ui|check-tools|permission|approval|update-queue|cancel)":.*(?=\n)/g, '')
const requestExtensions = `
			case "session/check-tools": { const missing = params.names.filter(name => !this.ctx.tools.get(name)); if (missing.length) throw new Error("内置工具未就绪：" + missing.join(", ") + "；请重新连接 App 后重试"); return { ready: true }; }
			case "session/ui": return (this.conversationUi ??= createConversationUi(this))(params);
			case "session/list": return this.ctx.sessionQuery.listSessions();
			case "session/read": return this.readSession(params);
			case "session/permission": return this.permission(params);
			case "session/approval": return this.approval(params);
			case "session/update-queue": return this.updateQueue(params);
			case "session/cancel": return this.cancelSession(params);`
patch('\t\t\tcase "shutdown": return this.shutdown();', '\t\t\tcase "shutdown": return this.shutdown();' + requestExtensions)
patch('case "session/read": return this.ctx.sessionQuery.readSession(brandString(String(params?.sessionId || "")));', 'case "session/read": return this.readSession(params);')
const readSessionMethod = `\tasync readSession(params) {
\t\tconst observation = await this.ctx.sessionQuery.observeSession(brandString(String(params?.sessionId || "")));
\t\ttry {
\t\t\treturn { session: observation.header, events: observation.events, inheritedEventCount: observation.inheritedEventCount,
\t\t\t\tcontextPressure: observation.projections?.values.contextPressure };
\t\t} finally { observation[Symbol.dispose](); }
\t}
`
const permissionMethod = `\tasync permission(params) {
\t\tif (!this.initialized) throw new Error("SDK server is not initialized");
\t\tif (params.existingOnly && !this.sessions.has(params.sessionId) && await this.ctx.get("sessionPersistence")?.stat(brandString(params.sessionId)) === void 0) return { exists: false };
\t\tconst rec = await this.getOrCreateSession(params.sessionId);
\t\tthis.assertLiveAgent(rec, params.sessionId);
\t\tconst agent = rec.handle.agent;
\t\tif (params.preset !== void 0) {
\t\t\tconst preset = String(params.preset);
\t\t\tconst settled = await this.ctx.get("commands").execute(agent, "/permission " + preset, [], new AbortController().signal);
\t\t\tif (settled === void 0) throw new Error("unknown permission preset: " + preset);
\t\t\tif (settled.result.kind !== "success") throw new Error(settled.result.text || "permission preset " + preset + " was rejected");
\t\t}
\t\tconst presets = this.ctx.get("permissionPresets");
\t\treturn { ...presets.permissionState(agent.session), preset: presets.current(agent.session), agentId: agent.id };
\t}
\tasync approval(params) {
\t\tconst rec = this.sessions.get(params.sessionId);
\t\tif (!rec) throw new Error("approval session is not pending");
\t\tthis.assertLiveAgent(rec, params.sessionId);
\t\treturn rec.approvalBridge.answer(params);
\t}
`
const updateQueueMethod = `\tasync updateQueue(params) {
\t\tif (!this.initialized) throw new Error("SDK server is not initialized");
\t\tconst rec = await this.getOrCreateSession(params.sessionId);
\t\tthis.assertLiveAgent(rec, params.sessionId);
\t\tif (this.stoppingSessions?.has(params.sessionId)) throw new Error("session is stopping");
\t\tconst agent = rec.handle.agent;
\t\tconst nextTurn = agent.inbox.nextTurn.find((message) => message.id === params.itemId);
\t\tconst nextStep = agent.inbox.nextStep.find((message) => message.id === params.itemId);
\t\tconst located = nextTurn === void 0 ? nextStep === void 0 ? void 0 : { target: "next-step", message: nextStep } : { target: "next-turn", message: nextTurn };
\t\tif (located === void 0) throw new Error("queued item is no longer pending");
\t\tconst { target, message } = located;
\t\tconst action = params.action;
\t\tif (action?.kind === "edit") {
\t\t\tif (!Array.isArray(action.content) || action.content.some((block) => block?.type !== "text" || typeof block.text !== "string")) throw new Error("queue edits accept text content only");
\t\t\tif (!action.content.some((block) => block.text.trim())) throw new Error("queue edit content must include non-whitespace text");
\t\t\tif (!agent.inbox.replace(params.itemId, freezeMessage({ ...message, content: [...action.content] }))) throw new Error("queued item is no longer pending");
\t\t} else if (action?.kind === "remove") {
\t\t\tif (!agent.inbox.remove(params.itemId)) throw new Error("queued item is no longer pending");
\t\t} else if (action?.kind === "steer") {
\t\t\tif (target !== "next-turn" || agent.status !== "running") throw new Error("current turn no longer accepts steering");
\t\t\tif ((message.source.productionMode !== undefined && message.source.productionMode !== productionModeFor(agent) || message.source.productionRoute !== undefined && message.source.productionRoute !== productionRouteFor(agent))) throw new Error("这条消息使用不同的创作能力范围，请保留在下一轮队列。");
\t\t\tif (!agent.inbox.remove(params.itemId)) throw new Error("queued item is no longer pending");
\t\t\tagent.steer(message);
\t\t} else throw new Error("unknown queue action");
\t\treturn { accepted: true };
\t}
`
const cancelSessionMethod = `\tasync cancelSession(params) {
\t\tconst rec = this.sessions.get(params.sessionId);
\t\tif (!rec) throw new Error("session is not running");
\t\tthis.assertLiveAgent(rec, params.sessionId);
\t\tif (this.stoppingSessions?.has(params.sessionId)) return { accepted: true };
\t\tif (this.stoppingSessions === void 0) this.stoppingSessions = new Set();
\t\tthis.stoppingSessions.add(params.sessionId);
\t\tconst agent = rec.handle.agent;
\t\tconst nextStep = [...agent.inbox.nextStep];
\t\tconst nextTurn = [...agent.inbox.nextTurn];
\t\ttry {
\t\t\tagent.inbox.clear();
\t\t\tagent.cancel({ kind: "user" }, { keepInbox: true });
\t\t\tawait agent.whenIdle();
\t\t\tif (nextStep.length) agent.inbox.splice("next-step", 0, 0, nextStep);
\t\t\tif (nextTurn.length) agent.inbox.splice("next-turn", 0, 0, nextTurn);
\t\t\treturn { accepted: true };
\t\t} finally {
\t\t\tthis.stoppingSessions.delete(params.sessionId);
\t\t}
\t}
`
const scopedBindingMethod = `\tasync applyNativeCapabilities(rec, content) {
\t\tif (this.nativeWikiScopes === void 0) this.nativeWikiScopes = new WeakMap();
\t\tconst agent = rec.handle.agent;
\t\tthis.assertLiveAgent(rec, agent.id);
\t\tif (!this.nativeWikiScopes.has(agent)) this.nativeWikiScopes.set(agent, (async () => {
\t\t\tconst wiki = await attachWikiRuntime(rec);
\t\t\ttry {
\t\t\t\tconst present = await attachPresent(rec);
\t\t\t\treturn async () => { try { await present(); } finally { await wiki(); } };
\t\t\t} catch (error) { await wiki(); throw error; }
\t\t})());
\t\ttry { await this.nativeWikiScopes.get(agent); }
\t\tcatch (error) { this.nativeWikiScopes.delete(agent); throw error; }
\t\tthis.assertLiveAgent(rec, agent.id);
\t}
`
// 删除旧的手势推导/屏蔽链，再安装最小的原生能力挂接。
server = server.replace(/^import \{ (?:attachApprovalBridge|pinManjuSkills|setWikiSourceContent|isUserInvocable|attachWikiRuntime, attachPresent|installProductionSkills, (?:validateProductionMode, productionModeFor|productionSource, productionModeFor, productionRouteFor)) \} from .*;\n/gm, '')
server = server.replace(/\/\*\*\n\* 官方 `dsh-tool-skill`[\s\S]*?\*\/\n/g, '')
server = server.replace(/^const SKILL_GESTURE = .*;\n/gm, '')
server = server.replace(/\tasync (?:updateQueue|applyPinnedSkillScope|pinnedSkillNames|applyNativeCapabilities)\(rec, content\) \{[\s\S]*?\n\t\}\n/g, '')
server = server.replace('await this.applyPinnedSkillScope(rec, content);', 'await this.applyNativeCapabilities(rec, content);')
server = server.replace(/\tasync (?:readSession|cancelSession|updateQueue|permission|approval)\(params\) \{[\s\S]*?\n\t\}\n/g, '')
const imports = 'import { attachApprovalBridge } from "../../../../permission-bridge.mjs";\n'
  + 'import { attachWikiRuntime, attachPresent } from "../../../../wiki-runtime.mjs";\n'
  + 'import { installProductionSkills, productionSource, productionModeFor, productionRouteFor } from "../../../../production-skills.mjs";\n'
patch('import { carrierKeyOf } from "@deepseek-ai/dsh-scope";\n', 'import { carrierKeyOf } from "@deepseek-ai/dsh-scope";\n' + imports)
for (const method of [readSessionMethod, cancelSessionMethod, updateQueueMethod, permissionMethod, scopedBindingMethod]) {
  if (!server.includes(method)) patch('\tassertLiveAgent(rec, sessionId) {', method + '\tassertLiveAgent(rec, sessionId) {')
}
server = server.replace(/^\t\t\tcase "session\/(?:runtime-busy|production-scope)":.*\n/gm, '')
patch('case "session/prompt": return this.prompt(params);', 'case "session/production-scope": return { version: 2 };\n\t\t\tcase "session/runtime-busy": return { busy: [...this.sessions.values()].some(rec => rec.handle.agent.status === "running" || rec.handle.agent.inbox.hasPending) };\n\t\t\tcase "session/prompt": return this.prompt(params);')
patch('\t\tthis.options = options;', '\t\tthis.options = options;\n\t\tinstallProductionSkills(ctx);')
patch('\t\tconst message = createUserMessage({', '\t\tawait this.applyNativeCapabilities(rec, content);\n\t\tconst message = createUserMessage({')
server = server.replace(/source: \{ kind: "user"(?:, productionMode: validateProductionMode\(params.productionMode(?: \?\? productionModeFor\(rec.handle.agent\))?\))? \}/g, 'source: { kind: "user", ...productionSource(params, rec.handle.agent) }')
if (!server.includes('source: { kind: "user", ...productionSource(params, rec.handle.agent) }')) throw new Error('Unsupported SDK production source layout')
patch('\t\trec.handle.agent.followup(message);', '\t\tif (this.stoppingSessions?.has(params.sessionId)) throw new Error("session is stopping");\n\t\trec.handle.agent.followup(message);')

// 保留官方 createSession 的恢复与 failure 状态；兼容 App 的惰性续接和已激活 Agent。
const sessionBridge = `	async createSession(sessionId, resume) {
		const id = brandString(sessionId);
		let agent = this.ctx.agents.get(id);
		let rec;
		let owned;
		if (agent === void 0) {
			try {
				const persisted = resume || await this.ctx.get("sessionPersistence")?.stat(id) !== void 0;
				rec = await this.createOfficialSession(sessionId, persisted);
				owned = rec.handle;
				agent = owned.agent;
			} catch (error) {
				agent = this.ctx.agents.get(id);
				if (agent === void 0) throw error;
			}
		}
		rec ??= { handle: { agent }, failure: void 0 };
		try {
			const parentId = agent.session.header.parentSession;
			const parent = parentId === void 0 ? void 0 : this.ctx.agents.get(parentId);
			if (agent.session.header.origin === "subagent" || parent !== void 0 && this.ctx.agents.isOwnedBy(id, parent))
				throw new Error("session is owned by subagent routing: " + sessionId);
			if (agent.session.header.cwd !== this.cwd) throw new Error("session belongs to another workspace: " + sessionId);
			if (agent.options.provider !== this.provider || agent.options.model !== this.model)
				throw new Error("live session uses a different model route: " + sessionId);
			this.assertLiveAgent(rec, sessionId);
			rec.approvalBridge = await attachApprovalBridge(agent, (method, params) => this.transport.notify(method, params));
			this.assertLiveAgent(rec, sessionId);
		} catch (error) {
			this.sessions.delete(sessionId);
			try { await rec.approvalBridge?.dispose(); } finally { await owned?.dispose(); }
			throw error;
		}
		this.sessions.set(sessionId, rec);
		return rec;
	}
`
patch('\tasync createSession(sessionId, resume) {', sessionBridge + '\tasync createOfficialSession(sessionId, resume) {')
// 官方创建会先登记 Agent；审批桥接完成前，其他消费者必须等待同一个创建任务。
patch(`\t\tconst existing = this.sessions.get(sessionId);
\t\tif (existing) return existing;
\t\tconst pending = this.sessionCreations.get(sessionId);
\t\tif (pending) return pending;`, `\t\tconst pending = this.sessionCreations.get(sessionId);
\t\tif (pending) return pending;
\t\tconst existing = this.sessions.get(sessionId);
\t\tif (existing) return existing;`)
const ownedTeardown = 'records.map((rec) => Promise.resolve().then(() => rec.handle.dispose()))'
const alignedTeardown = `records.map((rec) => Promise.resolve().then(async () => {
\t\t\ttry { await (await this.nativeWikiScopes?.get(rec.handle.agent))?.(); }
\t\t\tfinally { try { await rec.approvalBridge?.dispose(); } finally { await rec.handle.dispose?.(); } }
\t\t}))`
server = server.replace('this.pinnedSkillScopes?.get(rec.handle.agent)?.dispose()', '(await this.nativeWikiScopes?.get(rec.handle.agent))?.()')
patch(ownedTeardown, alignedTeardown)
writeFileSync(serverPath, server)

const skillRegistryPath = join(deepseekPackages, 'dsh-skill', 'lib', 'index.js')
let registry = readFileSync(skillRegistryPath, 'utf8')
const registryImport = 'import { allowsProductionSkill, filterProductionSkills } from "../../../../production-skills.mjs";\n'
if (!registry.includes(registryImport)) registry = registryImport + registry
const scopeFilter = '\n\t\tconst entries = filterProductionSkills(options.scope, [...collected.entries.values()].map((entry) => toSummary(entry.candidate)));'
if (!registry.includes(scopeFilter)) registry = registry.replace('async snapshot(options = {}) {\n\t\tconst collected = await this.collect(options);', 'async snapshot(options = {}) {\n\t\tconst collected = await this.collect(options);' + scopeFilter)
registry = registry.replace('skills: [...collected.entries.values()].map((entry) => toSummary(entry.candidate)).sort(compareSkillSummary)', 'skills: entries.sort(compareSkillSummary)')
const nameGuard = 'if (!allowsProductionSkill(options.scope, name)) return void 0;'
if (!registry.includes(nameGuard)) registry = registry.replace('async get(name, options = {}) {', 'async get(name, options = {}) {\n\t\t' + nameGuard)
const providerGuard = 'if (!allowsProductionSkill(options.scope, name, match.candidate.provider)) return void 0;'
if (!registry.includes(providerGuard)) registry = registry.replace('if (match === void 0) return void 0;', 'if (match === void 0) return void 0;\n\t\t' + providerGuard)
if (!registry.includes('skills: entries.sort') || !registry.includes(nameGuard) || !registry.includes(providerGuard)) throw new Error('官方 Skill 范围补丁锚点不匹配')
writeFileSync(skillRegistryPath, registry)

// Preserve accepted official Inbox entries across a desktop runtime restart.
const loopPath = join(deepseekPackages, 'dsh-agent-loop', 'lib', 'index.js')
if (existsSync(loopPath)) {
  let loop = readFileSync(loopPath, 'utf8')
  const ordinaryDispose = 'machine.cancel({ kind: "disposed" });'
  const durableDispose = 'machine.cancel({ kind: "disposed" }, { keepInbox: true });'
  if (!loop.includes(durableDispose)) {
    if (!loop.includes(ordinaryDispose)) throw new Error('官方 Inbox 重启保留补丁锚点不匹配')
    writeFileSync(loopPath, loop.replace(ordinaryDispose, durableDispose))
  }
}

function patchProductionService(packageName, symbol, before, after) {
  const file = join(root, 'node_modules/@deepseek-ai', packageName, 'lib/index.js')
  let text = readFileSync(file, 'utf8')
  const dependency = `import { ${symbol} } from "../../../../production-skills.mjs";\n`
  if (!text.includes(dependency)) text = dependency + text
  if (!text.includes(after)) {
    if (!text.includes(before)) throw new Error('Unsupported production service layout: ' + packageName)
    text = text.replace(before, after)
  }
  writeFileSync(file, text)
}
patchProductionService('dsh-tool-fs-search', 'productionSearchArguments',
  'const workdir = exec.agent === void 0 ? process.cwd() : await ctx.workingDirectory.ensure(exec.agent, exec.signal);',
  'const workdir = exec.agent === void 0 ? process.cwd() : await ctx.workingDirectory.ensure(exec.agent, exec.signal);\n\targv = await productionSearchArguments(exec.agent, argv, workdir);')

patchProductionService('dsh-goal-round-driver', 'productionGoalAllowed',
  'return ctx.fiber.state === 2 && !state.stopping',
  'return productionGoalAllowed(state.agent) && ctx.fiber.state === 2 && !state.stopping')
patchProductionService('dsh-goal-round-driver', 'productionGoalAllowed',
  'return ctx.fiber.state === 2 && !state.stopping && attempt',
  'return productionGoalAllowed(state.agent) && ctx.fiber.state === 2 && !state.stopping && attempt')

// Upgrade the previous hook before applying the guarded form; preparation must not consume failed inputs.
{
  const text = readFileSync(loopPath, 'utf8')
  writeFileSync(loopPath, text.replace(/^\t{2}await prepareProductionStep\(this, claimed, signal\);\n/m, ''))
}
patchProductionService('dsh-agent-loop', 'prepareProductionStep',
  'const claimed = this.inbox.claim(target, position.turn);\n\t\tconst assembly = await this.loopCtx.systemPrompt.assemble(assembleContextFor(this, signal));',
  `const nextStepCount = this.inbox.nextStep.length;
\t\tconst claimed = this.inbox.claim(target, position.turn);
\t\tlet assembly;
\t\ttry {
\t\t\tawait prepareProductionStep(this, claimed, signal);
\t\t\tassembly = await this.loopCtx.systemPrompt.assemble(assembleContextFor(this, signal));
\t\t} catch (error) {
\t\t\tif (!signal.aborted) {
\t\t\t\tif (nextStepCount) this.inbox.splice("next-step", 0, 0, claimed.slice(0, nextStepCount));
\t\t\t\tif (claimed.length > nextStepCount) this.inbox.splice("next-turn", 0, 0, claimed.slice(nextStepCount));
\t\t\t}
\t\t\tthrow error;
\t\t}`)

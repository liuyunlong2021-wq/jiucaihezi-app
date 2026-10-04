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

// The pinned SDK server omits transient assistant chunks from its JSON-RPC transport.
const serverPath = join(root, 'node_modules', '@deepseek-ai', 'dsh-sdk-jsonrpc-server', 'lib', 'index.js')
let server = readFileSync(serverPath, 'utf8')
let changed = false
const streamBridge = '\t\tthis.disposers.push(ctx.on("agent/assistant-stream", ({ agent, frame }) => {\n\t\t\tthis.transport.notify("session.assistant-stream", { sessionId: String(agent.session.id), frame });\n\t\t}, { global: true }));\n'
const oldStreamBridge = streamBridge.replace(', { global: true }', '')
if (!server.includes(streamBridge)) {
  const anchor = '\t\tconst serverOptions = this.options;\n'
  if (!server.includes(anchor)) throw new Error('Unsupported DeepSeek Harness SDK server layout')
  server = server.includes(oldStreamBridge)
    ? server.replace(oldStreamBridge, streamBridge)
    : server.replace(anchor, `${anchor}${streamBridge}`)
  changed = true
}

// SDK 0.1.7 creates every first-seen session ID, even when persistence already owns it.
// Use the official AgentRegistry resume seam until the SDK server ships the same check.
const createSession = `\tasync createSession(sessionId) {
\t\tconst rec = { handle: await this.ctx.agents.create({
\t\t\tsessionId: brandString(sessionId),
\t\t\tmeta: { cwd: this.cwd },
\t\t\tagentOptions: {
\t\t\t\tprovider: this.provider,
\t\t\t\tmodel: this.model,
\t\t\t\t...this.reasoningEffort === void 0 ? {} : { reasoningEffort: this.reasoningEffort },
\t\t\t\t...this.maxTokens === void 0 ? {} : { maxTokens: this.maxTokens }
\t\t\t}
\t\t}) };
\t\tthis.sessions.set(sessionId, rec);
\t\treturn rec;
\t}`
const resumableSession = `\tasync createSession(sessionId) {
\t\tconst id = brandString(sessionId);
\t\tconst agentOptions = {
\t\t\tprovider: this.provider,
\t\t\tmodel: this.model,
\t\t\t...this.reasoningEffort === void 0 ? {} : { reasoningEffort: this.reasoningEffort },
\t\t\t...this.maxTokens === void 0 ? {} : { maxTokens: this.maxTokens }
\t\t};
\t\tconst persisted = await this.ctx.get("sessionPersistence")?.stat(id);
\t\tconst handle = persisted === void 0
\t\t\t? await this.ctx.agents.create({ sessionId: id, meta: { cwd: this.cwd }, agentOptions })
\t\t\t: await this.ctx.agents.resume({ resumeSessionId: id, agentOptions });
\t\tconst rec = { handle };
\t\tthis.sessions.set(sessionId, rec);
\t\treturn rec;
\t}`
if (!server.includes(resumableSession)) {
  if (!server.includes(createSession)) throw new Error('Unsupported DeepSeek Harness session server layout')
  server = server.replace(createSession, resumableSession)
  changed = true
}

// SDK 0.1.7 exposes prompts but not the official sessionQuery reads yet.
// Keep the bridge at the protocol edge; the UI must never parse DSH_HOME itself.
const baseInject = 'const inject = ["agents"];'
const queryInject = 'const inject = ["agents", "sessionQuery"];'
// 权限切换走官方命令面（commands），点名 skill 要查注册表（skills）—— 都要在 inject 里声明，
// 否则 `this.ctx.skills` 直接抛 `cannot get property "skills" without inject`。
const commandInject = 'const inject = ["agents", "sessionQuery", "commands"];'
const scopeInject = 'const inject = ["agents", "sessionQuery", "commands", "skills"];'
if (!server.includes(scopeInject)) {
  if (server.includes(commandInject)) server = server.replace(commandInject, scopeInject)
  else if (server.includes(queryInject)) server = server.replace(queryInject, scopeInject)
  else if (server.includes(baseInject)) server = server.replace(baseInject, scopeInject)
  else throw new Error('Unsupported DeepSeek Harness injection layout')
  changed = true
}
const requestCases = `\t\t\tcase "initialize": return this.initialize(params);
\t\t\tcase "session/prompt": return this.prompt(params);
\t\t\tcase "shutdown": return this.shutdown();`
const queryCases = `\t\t\tcase "initialize": return this.initialize(params);
\t\t\tcase "session/prompt": return this.prompt(params);
\t\t\tcase "session/list": return this.ctx.sessionQuery.listSessions();
\t\t\tcase "session/read": return this.ctx.sessionQuery.readSession(brandString(String(params?.sessionId || "")));
\t\t\tcase "shutdown": return this.shutdown();`
if (!server.includes(queryCases)) {
  if (!server.includes(requestCases)) throw new Error('Unsupported DeepSeek Harness request server layout')
  server = server.replace(requestCases, queryCases)
  changed = true
}

// 会话把权限记成 durable 事实（permission/preset + sandbox/mode + approval/policy），进程级
// DSH_PERMISSION_MODE 只决定**新会话**的默认值：官方 pinInitialPermission 对已存在的会话
// 保留它自己记下的开关。所以打开 @文件 也松不开老会话的沙箱，写 ~/.agents/skills 会拿到
// 「file access denied under workspace-write mode」。SDK 通道只有 session/prompt|list|read，
// 没有任何权限方法，这里挂一个 session/permission，复用官方命令面（dsh-permission-presets
// 注册的 `/permission <preset>`），而不是自己写 permission/preset 事件绕过官方推导。
// 上游公开会话级权限 RPC 后整体删除。
const permissionCase = '\t\t\tcase "session/permission": return this.permission(params);'
if (!server.includes(permissionCase)) {
  // 锚在整个 switch 的**末行**（shutdown）之后。插到 session/prompt 或 session/read 后面都会
  // 落在 queryCases 那段连续字符串内部，把它切断：上一步的幂等检查 `!server.includes(queryCases)`
  // 于是第二次运行误判成「还没打过」，再去 replace 找不到的 requestCases 就抛错。
  const permissionAnchor = '\t\t\tcase "shutdown": return this.shutdown();'
  if (!server.includes(permissionAnchor)) throw new Error('Unsupported DeepSeek Harness request server layout')
  server = server.replace(permissionAnchor, `${permissionAnchor}\n${permissionCase}`)
  changed = true
}
const permissionMethod = `\tasync permission(params) {
\t\tif (!this.initialized) throw new Error("SDK server is not initialized");
\t\tconst rec = await this.getOrCreateSession(params.sessionId);
\t\tthis.assertLiveAgent(rec, params.sessionId);
\t\tconst preset = String(params?.preset ?? "");
\t\tconst settled = await this.ctx.get("commands").execute(rec.handle.agent, "/permission " + preset, [], new AbortController().signal);
\t\tif (settled === void 0) throw new Error("unknown permission preset: " + preset);
\t\tif (settled.result.kind !== "success") throw new Error(settled.result.text || "permission preset " + preset + " was rejected");
\t\treturn { preset };
\t}
`
if (!server.includes('async permission(params) {')) {
  const liveAgent = '\tassertLiveAgent(rec, sessionId) {'
  if (!server.includes(liveAgent)) throw new Error('Unsupported DeepSeek Harness agent layout')
  server = server.replace(liveAgent, `${permissionMethod}${liveAgent}`)
  changed = true
}

// 用户显式点名 skill（官方 `/name` 手势）时，本会话**只许用点名的这些**：把 `skill` 工具从
// 该 agent 的工具面里掩掉。官方 `dsh-tool-skill` 在工具不可见时**不再发布 skill 目录**
// （`ctx.tools.get(skillTool.name, agent) === skillTool ? snapshot : { skills: [] }`），
// 而 `/name` → `<skill_content>` 的注入是**另一个** pre-step 钩子、不看工具可见性 ——
// 所以点名的那份指令照样进上下文，模型却看不到、也调不到别的 skill。
//
// 判定与官方 `invokedSkillNames()` 逐字同源（同一个 `SKILL_GESTURE` 正则 + `isUserInvocable`）：
// 只按正则匹配会把 `/permission` 这类官方命令也当成点名，把工具面误掩掉；所以必须真去
// `ctx.skills.get()` 查一次，查不到或不许用户调用的名字一律不算。
// 用户的芯片是会话级粘性的，我们每条消息都带一遍手势，所以掩码在清空芯片后的下一轮自动解除。
const skillScopeImport = 'import { isUserInvocable } from "@deepseek-ai/dsh-skill";\n'
const skillScopeAnchor = 'import { carrierKeyOf } from "@deepseek-ai/dsh-scope";\n'
const skillGesture = `/**
* 官方 \`dsh-tool-skill\` 的 \`/name\` 手势正则（逐字搬运）。
* \`/\` 前面必须是行首或空白，后面必须是空白或结尾，这样 \`/usr/bin\` 与 \`5/8\` 不会误命中。
*/
const SKILL_GESTURE = /(^|\\s)\\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\\s|$)/g;
`
const pinnedSkillMethod = `\tasync applyPinnedSkillScope(rec, content) {
\t\tif (this.pinnedSkillScopes === void 0) this.pinnedSkillScopes = new Map();
\t\tlet names = [];
\t\ttry {
\t\t\tnames = await this.pinnedSkillNames(rec, content);
\t\t} catch (error) {
\t\t\t// 查注册表失败只降级成「不禁」：不能因为一个增强把整轮判死。
\t\t\tconsole.error("[skill-scope] 解析点名 skill 失败: " + (error instanceof Error ? error.message : String(error)));
\t\t\treturn;
\t\t}
\t\tconst key = rec.handle.agent.id;
\t\tconst held = this.pinnedSkillScopes.get(key);
\t\tif (held !== void 0 && held.names.join(",") === names.join(",")) return;
\t\tif (held !== void 0) {
\t\t\tthis.pinnedSkillScopes.delete(key);
\t\t\tawait held.dispose();
\t\t}
\t\tif (names.length === 0) return;
\t\ttry {
\t\t\tconst dispose = rec.handle.agent.ctx.tools.restrict({ deny: ["skill"] });
\t\t\tthis.pinnedSkillScopes.set(key, {
\t\t\t\tnames,
\t\t\t\tdispose
\t\t\t});
\t\t} catch (error) {
\t\t\t// 官方改了工具注册名时只记一行，不把这一轮判失败。
\t\t\tconsole.error("[skill-scope] 掩掉 skill 工具失败: " + (error instanceof Error ? error.message : String(error)));
\t\t}
\t}
\tasync pinnedSkillNames(rec, content) {
\t\tconst names = [];
\t\t// 官方的查找签名是 \`{ cwd, signal, scope }\`，缺 signal 注册表会直接抛。
\t\tconst signal = new AbortController().signal;
\t\tfor (const block of content) {
\t\t\tif (block.type !== "text") continue;
\t\t\tfor (const match of block.text.matchAll(SKILL_GESTURE)) {
\t\t\t\tconst name = match[2];
\t\t\t\tif (name === void 0 || names.includes(name)) continue;
\t\t\t\tconst skill = await this.ctx.skills.get(name, {
\t\t\t\t\tcwd: rec.handle.agent.session.header.cwd,
\t\t\t\t\tsignal,
\t\t\t\t\tscope: rec.handle.agent
\t\t\t\t});
\t\t\t\tif (skill !== void 0 && isUserInvocable(skill)) names.push(name);
\t\t\t}
\t\t}
\t\treturn names;
\t}
`
const promptContentAnchor = `\t\tconst content = await durablePromptContent(this.ctx, params.contentBlocks);
\t\tthis.assertLiveAgent(rec, params.sessionId);
\t\tconst message = createUserMessage({`
if (!server.includes('async applyPinnedSkillScope(rec, content) {')) {
  if (!server.includes(skillScopeAnchor)) throw new Error('Unsupported DeepSeek Harness import layout')
  if (!server.includes(promptContentAnchor)) throw new Error('Unsupported DeepSeek Harness prompt layout')
  const liveAgent = '\tassertLiveAgent(rec, sessionId) {'
  if (!server.includes(liveAgent)) throw new Error('Unsupported DeepSeek Harness agent layout')
  server = server
    .replace(skillScopeAnchor, `${skillScopeAnchor}${skillScopeImport}${skillGesture}`)
    .replace(promptContentAnchor, promptContentAnchor.replace(
      '\t\tconst message = createUserMessage({',
      '\t\tawait this.applyPinnedSkillScope(rec, content);\n\t\tconst message = createUserMessage({',
    ))
    .replace(liveAgent, `${pinnedSkillMethod}${liveAgent}`)
  changed = true
}

// 漫剧路由固定到随产品打包的同一套版本；注册在 agent 层，不改变普通对话目录。
const manjuImport = 'import { pinManjuSkills } from "../../../../manju-skills.mjs";\n'
if (!server.includes(manjuImport)) {
  const registerAnchor = '\t\tif (names.length === 0) return;\n\t\ttry {\n\t\t\tconst dispose = rec.handle.agent.ctx.tools.restrict({ deny: ["skill"] });'
  const disposeAnchor = '\t\t\t\tdispose\n\t\t\t});'
  const lookupAnchor = '\t\t\t\tconst skill = await this.ctx.skills.get(name, {'
  if (!server.includes(registerAnchor) || !server.includes(disposeAnchor) || !server.includes(lookupAnchor))
    throw new Error('Unsupported DeepSeek Harness pinned skill scope layout')
  server = manjuImport + server
  server = server.replace(registerAnchor, registerAnchor.replace(
    '\t\ttry {', '\t\tconst manjuDispose = await pinManjuSkills(rec, names);\n\t\ttry {',
  )).replace(disposeAnchor, '\t\t\t\tdispose: async () => { await dispose(); await manjuDispose(); }\n\t\t\t});')
    .replace(lookupAnchor, '\t\t\t\tif (name === "jc-manju-zhizuo") { names.push(name); continue; }\n' + lookupAnchor)
  changed = true
}

// 绑定属于实际 Agent，不属于可被恢复复用的 Session ID；失败不得缓存或继续发送。
const scopedBindingMethod = `\tasync applyPinnedSkillScope(rec, content) {
\t\tif (this.pinnedSkillScopes === void 0) this.pinnedSkillScopes = new WeakMap();
\t\tlet names = [];
\t\ttry {
\t\t\tnames = await this.pinnedSkillNames(rec, content);
\t\t} catch (error) {
\t\t\tif (content.some(block => block.type === "text" && block.text.includes("/jc-manju-zhizuo"))) throw error;
\t\t\tconsole.error("[skill-scope] 解析点名 skill 失败: " + (error instanceof Error ? error.message : String(error)));
\t\t\treturn;
\t\t}
\t\tconst agent = rec.handle.agent;
\t\tthis.assertLiveAgent(rec, agent.id);
\t\tconst held = this.pinnedSkillScopes.get(agent);
\t\tif (held !== void 0 && held.names.join(",") === names.join(",")) return;
\t\tif (held !== void 0) {
\t\t\tthis.pinnedSkillScopes.delete(agent);
\t\t\tawait held.dispose();
\t\t}
\t\tif (names.length === 0) return;
\t\tconst manjuDispose = await pinManjuSkills(rec, names);
\t\tlet dispose;
\t\ttry {
\t\t\tthis.assertLiveAgent(rec, agent.id);
\t\t\tif (rec.handle.agent !== agent) throw new Error("漫剧制作 Agent 已替换");
\t\t\tdispose = agent.ctx.tools.restrict({ deny: ["skill"] });
\t\t\tthis.pinnedSkillScopes.set(agent, {
\t\t\t\tnames,
\t\t\t\tdispose: async () => { try { await dispose(); } finally { await manjuDispose(); } }
\t\t\t});
\t\t} catch (error) {
\t\t\ttry { await dispose?.(); } finally { await manjuDispose(); }
\t\t\tif (names.includes("jc-manju-zhizuo")) throw error;
\t\t\tconsole.error("[skill-scope] 掩掉 skill 工具失败: " + (error instanceof Error ? error.message : String(error)));
\t\t}
\t}
`
const bindingStart = server.indexOf('\tasync applyPinnedSkillScope(rec, content) {')
const bindingEnd = server.indexOf('\tasync pinnedSkillNames(rec, content) {', bindingStart)
if (bindingStart < 0 || bindingEnd < 0) throw new Error('Unsupported DeepSeek Harness skill binding layout')
if (server.slice(bindingStart, bindingEnd) !== scopedBindingMethod) {
  server = server.slice(0, bindingStart) + scopedBindingMethod + server.slice(bindingEnd)
  changed = true
}

if (changed) writeFileSync(serverPath, server)

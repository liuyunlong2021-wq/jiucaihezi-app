import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const version = '0.1.7-alpha.2'
const root = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src-tauri',
  'resources',
  'deepseek-harness',
)
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

if (changed) writeFileSync(serverPath, server)

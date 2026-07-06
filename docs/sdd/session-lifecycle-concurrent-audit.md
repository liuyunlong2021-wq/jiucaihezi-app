# 2026-07-06 并发审计结论 — session-lifecycle（会话生命周期 P0 修复）

## 审计范围
覆盖 5 个文件，~160 行变更
- SSE 重连 / Session API 包装 / 启动同步 / 项目切换同步

## 🔴 无 P0 缺陷

## 🟡 已知不修复（3 项）

| 项目 | 说明 |
|------|------|
| `mergeOpenCodeSessions` 与 `loadAllSessions` 竞态 | `loadAllSessions` 替换 `sessions.value` 可能覆盖刚合并的 OpenCode 会话。实践中 `loadAllSessions` 在挂载时立即完成（IndexedDB < 10ms），`mergeOpenCodeSessions` 需等 server 就绪（秒级），时序天然隔离。ponytail：若后续改成持续轮询需加锁 |
| SSE 重连无限循环 | 无最大重试次数限制。依赖 `controller.abort()` 终止（5 分钟 idle watchdog 兜底）。照抄 OpenCode 行为 |
| `attempt` 变量递增未读 | eventBridge.ts 中 `attempt` 仅递增未消费。ponytail：预留调试用，后续可加 `console.warn` 打日志 |

## ✅ 验证通过（7 项）

| 项目 | 结论 |
|------|:--:|
| ✅ Web 端守卫 | 所有新路径有 `isTauriRuntime()` 守卫 |
| ✅ heartbeatTimer 清理 | catch 块 + abort 监听器双路径清理，无泄漏 |
| ✅ linkedAbort 移除 | stream 结束后 `removeEventListener`，无残留 |
| ✅ session 同步不阻塞启动 | agentStore 中 try/catch 包裹，失败不抛 |
| ✅ session 同步不阻塞项目切换 | ChatPanel 中 try/catch 包裹 + fire-and-forget |
| ✅ 重复调用幂等 | `mergeOpenCodeSessions` 按 `openCodeSessionId` upsert |
| ✅ SSE 重连 await 正确 | while 循环内 `await` 顺序执行，无并发订阅 |
| ✅ `vue-tsc -b` + `vite build` | 零错误 |

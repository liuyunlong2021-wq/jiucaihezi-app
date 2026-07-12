# 胶水层逐项审计清单

> 对照 OpenCode 源码，逐项确认每个胶水层的正确性。
> 每完成一项打 ✅，发现问题打 ❌ 并记录修复。

---

## 1. 进程生命周期

- [ ] **冷启动耗时**: `opencode_ensure_server` 首次启动是否 < 8s？
- [ ] **进程复用**: 同 project+config 不重启进程？
- [ ] **进程切换**: 切 project 时正确杀旧启新？
- [ ] **僵尸进程**: 杀进程后 `child.try_wait()` 正确检测退出？
- [ ] **端口冲突**: `reserve_local_port` 正确分配空闲端口？
- [ ] **WAL 清理**: 启动前清理残留 `-wal/-shm` 文件？

## 2. 事件桥接 (eventBridge.ts)

- [ ] **SSE 订阅**: `client.event.subscribe()` 参数与 SDK 一致？
- [ ] **心跳超时**: 15s 无事件 → 断开重连？
- [ ] **重连延迟**: 250ms 等待？重连后事件连续不丢失？
- [ ] **事件类型**: 所有 OpenCode event type 都能收到？
- [ ] **sessionID 过滤**: 只处理当前 session 的事件？
- [ ] **compaction 事件**: `session.next.compaction.*` 正确捕获？

## 3. 消息同步 (finalizeOpenCodeRun)

- [ ] **全量加载**: `listOpenCodeChatMessages` 不截断？（limit 足够大）
- [ ] **增量同步**: 是否应该只同步新消息而非全量替换？
- [ ] **compaction 感知**: `replaceMessagesPreservingPrompt` 正确处理 compaction 分隔线？
- [ ] **并发安全**: `runId !== activeRunId` 守卫有效？
- [ ] **错误恢复**: finalize 失败后 UI 不崩？

## 4. 看门狗 (watchdog)

- [ ] **idleTimer**: 正确 reset？事件到达 → `resetIdleTimer()` 被调用？
- [ ] **超时时间**: 120s 是否合理？（太短 → 正常长任务被误杀，太长 → 用户等太久）
- [ ] **abort 有效性**: `abortOpenCodeSession` → `Fiber.interrupt` 能否中止 LLM 调用？
- [ ] **杀进程兜底**: `stopOpenCodeServer` 后 zombie 进程是否存在？
- [ ] **重试路径**: kill 后用户重发消息，`ensureOpenCodeServer` 自动重启？

## 5. Provider 配置投影 (providerProjection.ts)

- [ ] **模型路由**: `toOpenCodeModelProjection` 正确映射所有 provider？
- [ ] **API Key**: Keychain 读取 → 注入 OpenCode config？
- [ ] **config 签名**: 同 config 复用进程，不同 config 重启？
- [ ] **Ollama 路径**: 本地模型免 key 但 attachment=true？

## 6. Session 管理

- [ ] **创建**: `createOpenCodeSession` 参数与 SDK 一致？
- [ ] **切换**: 切 session 时清理旧 SSE 订阅？
- [ ] **列表同步**: `listOpenCodeSessions` 按 project 目录过滤？
- [ ] **ID 映射**: 本地 sessionId ↔ OpenCode sessionID 映射正确？

## 7. IPC 调用层

- [ ] **Tauri invoke**: 所有 `invoke('opencode_*')` 参数类型与 Rust 端一致？
- [ ] **超时处理**: IPC 调用有合理的超时和错误处理？
- [ ] **并发去重**: 同 `invoke` 多次调用是否复用同一个 Promise？

## 8. 消息显示 (ChatPanel + MessageBubble)

- [ ] **Part 渲染**: `normalizeOpenCodeParts` 处理所有 part type？
- [ ] **Tool call 展开**: tool 状态 pending/running/completed/error 四种都处理？
- [ ] **TurnDivider**: interrupted / compaction 分隔线正确显示？
- [ ] **DiffSummary**: 用户消息底部的文件变更摘要可点击？

---

## 审计频率

- **每次发版前**: 全部过一遍
- **每次发现 Bug**: 在对应项打 ❌，修复后改为 ✅
- **对照 OpenCode 新版本**: 检查 SDK 变更是否影响胶水层

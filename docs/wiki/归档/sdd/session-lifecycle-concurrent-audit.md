# 2026-07-06 并发审计结论 — session-lifecycle（最终版）

## 审计范围
覆盖 6 个文件，~200 行变更
SSE 重连 / Session API 包装 / 启动同步 / 项目切换同步 / promptAsync 修复 / IndexedDB 分离 / UI 调整

## 🔴 P0 缺陷：0 项

## 🟡 已修复（1 项）

| 项目 | 修复 |
|------|------|
| `fireOpenCodePrompt` 用同步 `prompt()` 等 LLM，503 阻塞 | 改用 `promptAsync()` 立即返回 204，SSE 驱动后续 |

## 🟢 已知不修复（1 项）

| 项目 | 说明 |
|------|------|
| SSE 重连无限循环 | 依赖 `controller.abort()` 终止（idle watchdog 兜底）。照抄 OpenCode 行为 |

## ✅ 验证通过

- vue-tsc -b + vite build: 零错误
- cargo check: 零错误
- 桌面端实机测试: 启动、聊天、切换项目、SSE 心跳 全部正常
- Web 端安全: 所有新路径有 `isTauriRuntime()` 守卫

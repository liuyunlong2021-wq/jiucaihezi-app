# 韭菜盒子 Harness Computer Use 接入（2026-10-03）

## 0. 结论

官方 Computer Use 是「**一个注册位服务 + 一个提供方**」两层，**两层都发在 npm**。我们按官方最小配置
搬两条 `- insert:` 条目，提供方选**原生**（`cua-driver-native`）。开关是部署级的：
`localStorage` 的 `jc_computer_use`（设置 → Computer Use），**默认开**。

## 1. 官方结构（查过再动）

| 层 | 包 | 说明 |
| --- | --- | --- |
| 服务 | `@deepseek-ai/dsh-computer-use@0.2.0-rc.2` | 只占一个提供方注册位。**没有工具、没有配置项**；第二个注册会失败并报出已占用者名 |
| 提供方 A | `@deepseek-ai/dsh-experimental-computer-use-cua-driver-native@0.2.0-rc.2` | 进程内原生运行时，锁 `@trycua/cua-driver@0.28.0` |
| 提供方 B | `@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp@0.2.0-rc.2` | 通过 MCP 连本机已装的 `cua-driver` 可执行文件 |

⚠️ **命名陷阱（本次踩到）**：两个提供方都带 `dsh-experimental-` 前缀。
`npm view @deepseek-ai/dsh-computer-use-cua-driver-native` 回「不存在」，
`npm view @deepseek-ai/dsh-experimental-computer-use-cua-driver-native` 才是 0.2.0-rc.2。
别再据此判断「官方没发」。

官方能力边界（`docs/subsystems/computer-use.zh.md`）：共享服务只注册名字、拒绝第二个提供方，
不含通用桌面操作方法；一个提供方**不为某个 Session 预留桌面**，取消的调用也无法撤销已经传入的输入。

## 2. 我们怎么挂

路由组合两处（`src/services/deepSeekHarness.ts`）：

```yaml
- insert:
    - id: computer-use
      name: '@deepseek-ai/dsh-computer-use'
    - id: computer-use-cua-driver-native
      name: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'
```

- **必须走 `- insert:`**：官方 `applyEntryPatches` 对非 insert 条目按 `id` 匹配**已有**行，匹配不到只 warn + skip（MCP 条目踩过这个坑）。
- **只挂原生那一个**：官方限制一次只能挂一个提供方，挂两个会让第二个注册失败。选原生的理由是不要求用户另装 `cua-driver` CLI。
- 开关进 `runtimeKey()`：否则关掉开关后旧 runtime 还在跑，模型手里仍攥着桌面工具。
- 依赖写在 `src-tauri/resources/deepseek-harness/package.json`（`dsh-computer-use` + 原生提供方两条）。

## 3. 成本与风险（官方原文口径）

- **体积**：平台二进制走 `optionalDependencies` 分发 —— `@trycua/cua-driver-win32-x64-msvc` 24.7 MB、`darwin-arm64` 50.7 MB。官方明写「必须保留可选依赖安装」。
- **原生与宿主同进程**：官方已知限制 —— **原生崩溃可能终止该进程**（即我们的 `runner.mjs`）。要「由独立进程持有权限」就用 MCP 提供方。
- **截图要附件存储 + 图片模态**：截图通过持久化附件传给支持图像的模型；`attachment-local` 已在组合里，模型侧由 route patch 的 `input: [text, image]` 决定（`imageInput`）。
- **系统提示词**：挂载期间会加入固定指导文本 + 上游工具目录 → token 增加、首次请求 KV 前缀变化一次。
- **桌面是共享的**：一个提供方不给某个会话独占窗口，别的会话/应用可以在两次调用之间改动同一桌面。

## 4. 验证现状

已验收（真机，2026-10-03）：

- `dsh --profile sdk --patch <含这两条的 patch> --dump-config` → **退出 0、stderr 空**，composed 树里两条条目逐字命中。
- 用**同一条 patch 真跑 `runner.mjs`** → `{"type":"ready"}`、`list-sessions` 正常、**零 stderr**（没有 `entry did not activate`）。
- 提供方入口可加载：`exports: Config,apply,inject,name`；原生驱动 `@trycua/cua-driver` 可加载（150 个导出）。
- `attachment-local` 在组合里 → 截图的落地路径存在。
- 契约测试 +1（`Computer Use mounts the official provider pair behind the same insert seam`）；聚焦套件 `1797 tests / 1788 pass / 1 fail`（唯一失败是既有的 `scripts/jiucaihezi-creation-mcp/test.mjs` Windows `/tmp` 路径问题）；`vue-tsc -b` 干净、改动文件的 `oxlint` 干净。

未验收（要真机点一遍）：

- 模型真的调用 `cua_driver_native__*` 并拿到截图（需要一轮真实对话 + 声明图片输入的模型）。
- 关掉开关后下一轮重建 runtime、工具从工具表消失。

## 5. 回滚

1. 轻回滚：设置里关掉 → `jc_computer_use=0`，下一轮 `runtimeKey` 变化 → 重建 runtime，patch 里不再有这两条。
2. 彻底移除：删 `package.json` 里那两条依赖 → 重生成 `package-lock.json` → 删 `deepSeekHarness.ts` 的 `computerUsePatch` 与 `runtimeKey` 那行 → 删设置项与契约测试。

## 6. 相关

- [[开发/韭菜盒子Harness会话与可选建库统一合同-2026-09-24]] §12.2 / §12.3（Computer Use 已登记为「官方能力、非默认启用」）
- [[开发/韭菜盒子Harness升级0.2.0-rc.2方案-2026-10-03]]

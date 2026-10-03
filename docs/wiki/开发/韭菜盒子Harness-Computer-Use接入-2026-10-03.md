# 韭菜盒子 Harness Computer Use 接入（2026-10-03）

## 0. 结论

官方 Computer Use 是「**一个注册位服务 + 一个提供方**」两层，**两层都发在 npm**。我们按官方最小配置
搬两条 `- insert:` 条目，提供方选**原生**（`cua-driver-native`）。开关是部署级的：
`localStorage` 的 `jc_computer_use`（设置 → Computer Use），**默认开**。

⚠️ 光写这两条 row **不够**：这两个包不在官方 bundle 依赖图里，而 Loader 按 **profile 目录**解析裸包名，
解析不到时只记一条 `failed to import`（不报错、不失败、工具表里空无一物）。必须在启动前把它们挂进
profile —— 见 §4。

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
- **还要让 profile 目录能解析到它们**：`runner.mjs` 在开关打开时调 `ensureProfilePluginLinks()`
  （`src-tauri/resources/deepseek-harness/profile-plugins.mjs`）。为什么必需见 §4.1。

## 3. 成本与风险（官方原文口径）

- **体积**：平台二进制走 `optionalDependencies` 分发 —— `@trycua/cua-driver-win32-x64-msvc` 24.7 MB、`darwin-arm64` 50.7 MB。官方明写「必须保留可选依赖安装」。
- **原生与宿主同进程**：官方已知限制 —— **原生崩溃可能终止该进程**（即我们的 `runner.mjs`）。要「由独立进程持有权限」就用 MCP 提供方。
- **截图要附件存储 + 图片模态**：截图通过持久化附件传给支持图像的模型；`attachment-local` 已在组合里，模型侧由 route patch 的 `input: [text, image]` 决定（`imageInput`）。
- **系统提示词**：挂载期间会加入固定指导文本 + 上游工具目录 → token 增加、首次请求 KV 前缀变化一次。
- **桌面是共享的**：一个提供方不给某个会话独占窗口，别的会话/应用可以在两次调用之间改动同一桌面。

## 4. 根因与验收（2026-10-03 定案）

### 4.1 根因：图外包解析不到 → profile 只记一条静默记录

官方 Loader 解析裸包名时锚在 **profile 目录**（`dsh-app-boot` 把 `ctx.baseUrl` 设成
`<DSH_HOME>/profiles/<profile>/cordis.yml` 所在目录）。**已发布 bundle 依赖图里的包**能命中
（例如 `@deepseek-ai/dsh-file-reference-local` 是 `dsh-web-app` 的依赖）；**图外的包解析不到时，
Loader 只记一条 `failed to import`** —— 它既不是 `pending`（等服务的）那类，也不让启动失败。
于是「插件没挂上」在正常运行时表现为：不报错、`runner` 零 stderr、模型工具表里空无一物。

把这条静默记录逼出来的唯一办法是**直接起一次启动器**（跑起来的进程里看不到）：

```powershell
$env:DSH_HOME='<该工作区的 DSH_HOME>'
node node_modules\@deepseek-ai\dsh\lib\bin.js --profile sdk --patch <route.cordis.yml> < nul
# dsh: warning: 2 entries did not activate
# computer-use (@deepseek-ai/dsh-computer-use): failed to import
# computer-use-cua-driver-native (@deepseek-ai/dsh-experimental-computer-use-cua-driver-native): failed to import
```

真机对照（同一条命令、同一个 home，只改一处）：

| 条件 | 结果 |
| --- | --- |
| profile 下没有这两条可解析路径 | 上面那 3 行 warning；工具表 `tools=24 cua=0 CUA指导=false` |
| profile 下挂上它们 | **零输出**；工具表 `tools=80 cua=56 CUA指导=true` |

⚠️ **「runner 零 stderr」不能当生效证据**：`dsh-sdk-client` 把子进程 stderr 收进 `stderrTail`、
**只在运行时死亡时才抛**（`child.stderr.on('data')` → `appendStderr`），第一条静默记录永远到不了我们手里。
判定只看**模型实际收到的工具表**（`runner.mjs` 的 `diagnostics` 命令能取到这段尾巴，但实测它对这些
静默失败也是 0 行）。

### 4.2 修法：启动前把图外包挂进 profile（`profile-plugins.mjs`）

官方给用户装插件的手段是 `dsh plugin <profile> add <pkg>`（在 profile 目录跑 pnpm）。打包运行时不能联网、
也不该在用户机上跑 pnpm，所以 `runner.mjs` 在 `config.computerUse` 打开时调 `ensureProfilePluginLinks()`：

1. `<DSH_HOME>/profiles/sdk/` 不存在时，先用 `dsh --profile sdk --dump-config` 按官方模板催生
   （它只组合、不启动，是官方的同一初始化路径），否则链接没有落点。
2. 把运行时里的 `@deepseek-ai/dsh-computer-use` 与 `...-cua-driver-native` 挂成 Windows
   **目录联接**（无需管理员权限）。Node 默认解析真实路径，包自己的依赖（`@trycua/cua-driver`、
   `dsh-mcp-client`…）照旧从运行时 `node_modules` 找。
3. 失败只跳过：装不上就退化成「没有这一项能力」，不该让整轮起不来。

### 4.3 验收（真机，2026-10-03）

- 从**全新 home**（`profiles/` 一开始都不存在）跑假模型回显探针 → `tools=80 cua=56 CUA指导=true`；
  同一次运行里 `@skill` 硬限制照旧（点名 `/jc-daoju` → `skill=false`、工具 79）。
- 修前同一条探针 → `tools=24 cua=0 CUA指导=false`。
- **真机（用户自己的 App）**：重启后 **18:03:58** 两条链接是 **App 自己建出来的**（排查期手工建的那两条
  已在清理时删掉）。同一批会话里能直接看到分界 —— `c37ea3f4` 从 18:06 起、`81342a0c` 从 18:11 起、
  `9de500f5` 首轮起，每次 `request/header` 都是 `tools=80 cua=56`、请求上下文里有 `Cua Driver` 指导段；
  此前的请求一律 `tools=24 cua=0`。
- **执行侧**（直接问驱动，不经模型）：`check_permissions` → elevated / UIA 可用 / PostMessage 可用；
  `get_screen_size` → 2560x1440；`list_windows` → 32 个窗口 / 19 个应用；`health_report` →
  `cua-driver 0.28.0 on win32 — ok`；`list_apps` → 175 个应用。
- 新增 `scripts/__tests__/deepseek-harness-profile-plugins.test.mjs`（6 用例：链接、幂等、缺包跳过、
  profile 催生/催不出来、无 DSH_HOME、runner 受开关约束）。
- 聚焦套件 `1774 tests / 1773 pass / 1 fail`（唯一失败是既有的 `scripts/jiucaihezi-creation-mcp/test.mjs`
  Windows `/tmp` 路径问题）；`vue-tsc -b` 干净。

### 4.4 还没验收（要真机点一遍）

- 模型真的调用 `cua_driver_native__*` 拿到截图（需要一轮真实对话 + 声明图片输入的模型 + 桌面权限）。
- 关掉开关后下一轮重建 runtime、工具从工具表消失。

### 4.5 顺带查清的两件事

- 用户当时「操作电脑成功」是模型用 **`pwsh`（20 次）+ `job_output`（7）+ `read_image`（2）** 自己敲命令
  + 看截图办成的，**不是** Computer Use。
- `file-reference-local` 不需要这一步就能激活 —— 它是 `dsh-web-app` 的依赖，在 bundle 依赖图里。
  「在 `- insert:` 里写了就生效」这个印象对**图内包**成立、对**图外包**不成立，是本次误判的来源。

## 5. 回滚

1. 轻回滚：设置里关掉 → `jc_computer_use=0`，下一轮 `runtimeKey` 变化 → 重建 runtime，patch 里不再有这两条。
2. 彻底移除：删 `package.json` 里那两条依赖 → 重生成 `package-lock.json` → 删 `deepSeekHarness.ts` 的 `computerUsePatch` 与 `runtimeKey` 那行 → 删设置项与契约测试。

## 6. 相关

- [[开发/韭菜盒子Harness会话与可选建库统一合同-2026-09-24]] §12.2 / §12.3（Computer Use 已登记为「官方能力、非默认启用」）
- [[开发/韭菜盒子Harness升级0.2.0-rc.2方案-2026-10-03]]

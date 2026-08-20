# 韭菜盒子 Codex 创作 MCP 服务 TDD

> 状态：核心链路已实施并通过自动验证；正式安装包与跨平台人工验收待执行
> 日期：2026-08-20
> 范围：Desktop 韭菜盒子、Codex 自定义 MCP、创作模型目录、统一媒体任务、创作历史、项目落盘与画布回流
> 依据：`AGENTS.md`、[[架构/产品架构]]、[[开发/韭菜盒子原生媒体编排能力SDD]]、[[开发/创作任务统一取消TDD-2026-08-16]]、[[开发/自定义MCP添加SDD]]

## 1. 一句话目标

Codex 通过一个本地 MCP 调用正在运行的韭菜盒子创作能力；任务仍由韭菜盒子现有模型注册表、Creation Runtime 和 `mediaTaskStore` 执行，并进入同一创作历史、项目媒体目录和画布链路，不复制 `jc_media.py`、静态模型表、API Key、轮询器或任务数据库。

```text
Codex
  -> jiucaihezi-creation MCP（协议适配）
  -> Desktop 本机鉴权桥接
  -> creationModelRegistry / buildCreationRunPlan()
  -> mediaTaskStore.submitTask()
  -> 现有提交、轮询、取消、落盘、历史与画布回流
  -> MCP 返回结构化任务状态和本地媒体结果
```

## 2. 已确认决策

1. 核心是 MCP Server；个人本机使用第一期不要求 Codex 插件。
2. 韭菜盒子已经保存 `api.jiucaihezi.studio/NewAPI` Key，MCP 不再要求填写、复制或返回 Key。
3. 不把 Vue 创作面板 UI 塞进 Codex；复用的是面板背后的模型、计划、任务、历史、落盘和画布能力。
4. 不复制 `jc_media.py`。它是独立 CLI 执行器，不能写入正在运行的 Pinia 状态和同一 IndexedDB 历史，也会形成第二套同步/异步响应处理。
5. 不打包静态模型能力表。Codex 看到的模型、字段、选项、默认值、价格和当前可用性必须来自韭菜盒子现有创作模型目录与校验链路。
6. 第一阶段只面向 Desktop 本机 Codex。Web/Mobile 不能启动本机 MCP，不新增替代入口；现有媒体能力不受影响。
7. MCP 可接收本机绝对参考图路径、data URL 或 HTTPS 图片 URL；本机路径由 Desktop 读取为图片数据后交给现有 Creation Runtime。输出可通过 `directory` 指定本机绝对目录；未指定时沿用当前画布/项目目录。

## 3. 根因

仓库已有完整创作执行闭包，但没有供外部客户端安全调用的服务端入口：

- `CreationPanel.vue` 负责交互，最终调用 `mediaTaskStore.submitTask()`。
- `mediaTaskStore` 是任务状态、取消、恢复、历史和结果落盘的唯一所有者；历史键为 `jc_media_tasks_v1`。
- `creationMediaRuntime`、`media-generation.ts` 和创作模型注册表已经处理各模型参数、路由、同步图片、异步任务、轮询和结果提取。
- 现有 MCP 代码让韭菜盒子充当 MCP 客户端，不能反向让 Codex 调用韭菜盒子。
- 独立 stdio 进程不能直接导入正在运行的浏览器 Pinia Store；读取数据库或重写 API 调用只能制造第二套状态与执行器。

因此缺口不是“再写一个媒体生成脚本”，而是“让外部 MCP 请求安全进入正在运行的应用任务引擎，并把结果返回给 Codex”。

## 4. 最小架构

### 4.1 stdio MCP 适配器

- 使用仓库已安装的 `@modelcontextprotocol/sdk`，提供 Codex 可配置的 stdio MCP Server。
- 只负责工具 schema、MCP 内容格式和到本机桥接的请求转发，不持有 API Key、模型表、任务状态或媒体业务判断。
- 发布形态使用可直接由 `node` 启动的构建产物；开发命令与发布命令分开验证，不要求 Codex 通过 `pnpm` 启动。

### 4.2 Desktop 本机桥接

- Desktop 应用启动时只监听 `127.0.0.1`，不监听局域网地址。
- 每次应用启动生成随机端口和高熵临时令牌，写入 `~/.jiucaihezi/mcp-bridge.json`，Unix 权限为 `600`；退出时删除。
- stdio MCP 读取该发现文件，以 Bearer Token 调用桥接；不得读取 `.jc_api_key`。
- Rust/本机层只传输经过大小限制的结构化请求，通过单一事件/回执通道交给前端运行时，不复制模型路由或任务逻辑。
- 前端新增一个无 UI 的创作桥接适配器，调用现有注册表、计划构建、`mediaTaskStore` 和项目服务；不得从 `CreationPanel.vue` 抽取一套平行业务实现。
- 应用未运行、令牌过期、桥接超时或前端未就绪时快速失败，提示“请启动韭菜盒子 Desktop”，不回退到 `jc_media.py`。

### 4.3 为什么不直接读历史数据库

`jc_media_tasks_v1` 是应用历史合同，不是外部写入 API。独立进程直接读写会绕过 Pinia 内存状态、任务控制器、持久化队列、项目归属和画布写入门闩；本方案只允许通过运行中的 Store 访问。

## 5. MCP 工具合同

第一期只暴露现有创作闭包需要的工具：

| 工具 | 责任 | 副作用 |
| --- | --- | --- |
| `get_creation_context` | 返回当前项目、当前画布、上下文版本和 Desktop 就绪状态 | 无 |
| `list_creation_models` | 从现有注册表与可用性返回模型、任务类型、字段、选项、默认值和价格 | 无 |
| `submit_creation_task` | 校验上下文、构建现有 Creation Run Plan 并调用 `mediaTaskStore.submitTask()` | 付费、写历史与项目 |
| `get_creation_task` | 返回一个任务的真实状态、进度、错误和结果资源 | 无 |
| `list_creation_history` | 分页读取 `mediaTaskStore` 中 `source=creation` 的现有历史 | 无 |
| `cancel_creation_task` | 调用现有 `mediaTaskStore.cancelTask()`，沿用真实取消语义 | 有 |
| `retry_media_persistence` | 调用现有结果重新落盘入口，不重新生成 | 写项目 |
| `add_creation_result_to_canvas` | 对成功且已落盘结果执行现有显式“放到画布”动作 | 写画布 |

不新增清空历史、删除媒体、修改 API Key、充值、后台渠道管理或任意文件读取工具。重新生成不需要独立工具：Codex 读取旧任务参数后重新调用 `submit_creation_task`。

## 6. 提交与上下文边界

- `submit_creation_task` 必须携带最近一次 `get_creation_context` 返回的 `contextVersion`；项目或画布切换后旧版本失效，禁止把结果写进错误项目。
- 模型 ID、参数和参考素材必须通过现有注册表、输入校验和 `buildCreationRunPlan()`；MCP 不接受任意 endpoint、Base URL、API Key 或轮询 URL。
- 参考图可传本机绝对路径、data URL 或 HTTPS URL；本机路径只在 Desktop 桥接层读取并转换为 data URL，不直接透传给上游。参考图数量、大小和模型能力继续由现有模型表与计划校验决定，不在 MCP 复制“11 张”等静态限制。
- `directory` 只接受本机绝对目录路径，用于把结果写入用户指定位置；目录不传时沿用当前画布/项目目录。
- 提交成功立即返回本地任务 ID。同步图片仍由现有执行层完成；异步视频/音频由现有 Store 继续跟踪。MCP 不保持第二份任务列表。
- 所有付费提交必须在工具 schema 和返回值中标记副作用；Codex 客户端的工具审批策略不得被桥接绕过。

## 7. 历史、落盘与画布合同

1. Codex 提交的任务使用 `source: 'creation'`，立即出现在创作面板右上角同一历史记录中。
2. 成功结果继续由现有 `writeProjectMedia` / `writeMediaAsset` 链路保存；MCP 不自行下载到另一套 `jc-media` 目录。
3. 历史中的进度、取消、失败、重新保存和画布写入状态与创作面板一致；任一入口操作后另一入口读取到同一状态。
4. “放到画布”保持显式动作，不因 Codex 生成成功自动写画布；目标画布必须来自有效上下文且通过现有写入门闩。
5. 应用退出后正在运行任务继续遵守现有恢复合同；MCP 重连后通过任务 ID 或历史读取，不自行恢复轮询。

## 8. Codex 媒体交付合同

- MCP 结果统一返回结构化字段：`taskId`、`status`、`mediaType`、`projectPath`、可用时的本机绝对路径、MIME 类型和文件大小。
- 图片：文件可控时返回 MCP `image` 内容和本地路径，使 Codex 可直接预览；不得把大体积 Base64 写入历史或日志。
- 音频：返回本地音频资源与 MIME；Codex 是否直接显示播放器必须以真实客户端验收为准。
- 视频：返回本地 MP4 资源和绝对路径，不把整段视频编码进 MCP JSON；Codex 是否内嵌播放器必须以真实客户端验收为准，未通过前只能承诺可访问文件路径。
- 远程临时 URL 不是最终交付。只有项目落盘完成后才返回稳定本地资源；落盘失败时返回真实错误和可用的重试动作。
- MCP 响应和诊断必须脱敏，不输出 API Key、Authorization Header、签名下载 URL 或完整 data URL。

### 8.1 自然语言调用示例

```text
用 GPT Image 2 中质量，生成一张 16:9、2K 图片；
参考图使用 /Users/by3/Desktop/ref-1.png 和 /Users/by3/Desktop/ref-2.png；
保存到 /Users/by3/Desktop/preview。
```

Codex 只负责把模型、比例、分辨率、参考图和输出目录填入 MCP 工具参数；具体可用模型、参考图上限、参数校验、上传、轮询、落盘和历史仍由韭菜盒子现有链路负责。

## 9. 安全与可靠性

- 桥接只允许固定工具和严格 schema；拒绝未知字段、超长提示词、超量参考素材和超过现有模型合同的参数。
- 本机令牌只用于 MCP 桥接，不等于 NewAPI Key；两者不共用文件、环境变量或日志字段。
- 发现文件必须防符号链接覆盖并原子写入；端口只绑定回环地址。Windows 使用等价的当前用户可读写限制。
- 同一 `requestId` 幂等：网络重试不得重复创建付费任务。桥接保存短期请求 ID 到任务 ID 映射，应用重启后失效并明确返回状态未知，不猜测。
- 工具超时不等于任务失败。提交已被 Store 接受后，MCP 超时响应必须携带可恢复的本地任务 ID；客户端随后用查询工具继续。
- 图片、音频和视频字节读取设置大小上限；超限时只返回资源路径，不把大文件塞入 MCP 响应。

## 10. TDD 阶段

### Phase 0：红灯合同

1. 证明当前仓库没有可被 Codex 连接的 MCP Server 入口。
2. 合同测试禁止独立 stdio MCP 进程导入 `mediaTaskStore`、`media-generation.ts` 或读取 `.jc_api_key`；只有应用内前端桥接可以调用现有 Store。
3. 对桥接鉴权、过期令牌、非回环绑定、未知工具、重复 `requestId` 和旧 `contextVersion` 写失败测试。
4. 对同步图片、异步视频、取消、历史、落盘失败和画布目标失效建立跨桥接红灯测试。

### Phase 1：只读与连接

1. 实现运行时发现文件、本机鉴权桥接和 stdio MCP 初始化。
2. 接通 `get_creation_context`、`list_creation_models`、`get_creation_task`、`list_creation_history`。
3. 验证应用未运行、应用退出、重启换 Token、Codex 重连和无 API Key 的准确错误；只读工具不得触发付费请求。

### Phase 2：提交闭环

1. `submit_creation_task` 只进入现有计划和 Store。
2. 先用模拟执行器验证同步图片与异步任务，再执行一次用户明确批准的真实图片生成。
3. 验证任务立即进入创作历史、状态实时一致、结果只由现有项目落盘链路保存。

### Phase 3：操作与交付

1. 接通取消、重新落盘和显式放入画布。
2. 验证图片 MCP 预览、本地音频资源和本地 MP4 资源；分别记录 Codex 当前客户端的真实显示能力。
3. 收口请求幂等、超时恢复、应用退出、任务恢复和大文件响应上限。

### Phase 4：安装与跨平台

1. 生成稳定的 MCP 构建产物和 Codex STDIO 填写说明。
2. macOS 开发版验收后，再验证正式安装包、Windows Intel/ARM 可用命令与权限。
3. 只有需要一键安装或分享时才包装为 Codex 插件；插件不得复制媒体业务逻辑。

## 11. 自动验收

1. MCP 初始化、`tools/list` 和所有工具 schema 可由 MCP SDK 客户端读取。
2. 未启动韭菜盒子时只读和提交均快速返回可操作错误，不挂起。
3. 错误 Token、旧 Token、非回环请求和未知工具全部拒绝；日志不含 Key、Token、签名 URL 或 data URL。
4. 模型列表与创作面板共享同一事实源；测试禁止 MCP 内出现第二份模型 ID 表。
5. 同一 `requestId` 并发或重试只创建一个任务；不同 ID 正常创建两个任务。
6. 同步图片无上游任务 ID 时仍完成同一个 Store 任务并落盘；MCP 不实现特殊图片分支。
7. 异步任务返回本地任务 ID，后续状态、取消和历史与 Store 完全一致。
8. 项目或画布切换后旧 `contextVersion` 提交失败，不写错项目或画布。
9. 落盘失败不伪装成功；`retry_media_persistence` 成功后返回稳定项目路径。
10. 画布只通过显式工具写入，重复调用遵守现有幂等与写入门闩。
11. 执行相关定向测试、完整 focused tests、`pnpm exec vue-tsc -b`、Rust tests 和 `git diff --check`。

## 12. 真实验收矩阵

1. macOS Codex 以 STDIO 连接，能看到工具和韭菜盒子当前创作模型。
2. 用户明确批准后生成一张 GPT Image 2 图片：任务进入右上角历史、保存进当前项目、Codex 显示图片或稳定本地文件。
3. 生成一个异步视频：Codex 查询期间与创作面板进度一致，完成后返回 MP4；单独记录是否内嵌播放。
4. 从 Codex 取消一个在途任务，创作面板同步显示现有准确取消文案。
5. 关闭韭菜盒子后工具明确提示启动应用；重开后 Codex 重连且旧 Token 失效。
6. 切换项目后使用旧上下文提交被拒绝；新上下文提交只写入新项目。
7. 将成功图片显式放入当前 `.jccanvas`，刷新后仍存在；不测试自动入画布。

没有执行的真实付费请求、正式安装包、Windows、Intel Mac、Codex 视频/音频内嵌显示和跨重启任务恢复，不得写成已通过。

## 13. 预计文件责任

| 模块 | 最小责任 |
| --- | --- |
| `scripts/jiucaihezi-creation-mcp/` | stdio MCP schema、转发和 Codex 构建产物 |
| `src-tauri/src/commands/creation_mcp.rs` 或同级本机模块 | 回环监听、临时令牌、发现文件、请求/回执传输 |
| `src/runtime/creation/creationMcpBridge.ts` | 注册表、上下文和现有 Store 的唯一外部适配器 |
| `src/stores/mediaTaskStore.ts` | 仅在缺少稳定公开方法时补最小入口；继续拥有任务和历史 |
| `src/runtime/creation/__tests__/` | 模型、上下文、提交和媒体交付桥接合同 |
| `src-tauri` tests | 回环、鉴权、令牌生命周期、发现文件与超时 |

实施时如果现有公开方法已经够用，不修改 `CreationPanel.vue`、`media-generation.ts` 或 `mediaTaskStore.ts`。先复用，再补最小公开入口。

## 14. 禁入边界

- 不复制 `jc_media.py`、模型能力表、媒体 API、轮询、任务历史或下载器。
- 不让 MCP 直接读取/写入 `jc_media_tasks_v1` 或项目数据库。
- 不把 API Key 放入 Codex MCP 环境变量、插件、命令参数或响应。
- 不恢复旧 Studio/OpenCode 产品，也不把本功能做成第二个创作面板。
- 不开放局域网监听，不接受任意命令、任意 URL、任意文件路径或任意数据库访问。
- 不承诺 Codex 必然内嵌播放视频/音频；真实客户端未验收前只承诺稳定本地资源交付。
- 不因 MCP 请求成功自动把结果写进画布，不绕过付费工具审批和现有取消语义。

## 15. 当前实施与验证状态

- 已实施：stdio MCP、Desktop 回环鉴权桥接、内置 MCP 一键配置、动态 Node/入口路径解析、`memory: true` 项目落盘、可选输出目录、本机参考图路径转 data URL、模型注册表复用、同一历史/任务/画布链路。
- 已验证：MCP schema/build、`pnpm exec vue-tsc -b`、完整 focused `1104/1104`、参考图与目录相关合同测试、`git diff --check`。
- 用户已真实确认：通过 Codex 调用韭菜盒子生成图片并成功保存到项目目录；本轮新增参考图路径能力和目录能力已完成代码级验证。
- 未验证：正式安装包一键配置、Windows/Intel Mac 真机、视频/音频在 Codex 内嵌播放、跨应用重启任务恢复，以及新的多参考图付费生成矩阵。

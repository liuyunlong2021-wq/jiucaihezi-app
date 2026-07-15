# 创作模式双端统一 SDD

> 日期：2026-07-15  
> 状态：完成
> 分支：`0715-chuangzuomoshi`  
> 目标：把已经在 Web 运行的“直连模型 + Skill + 当前项目工具 + 创作面板”定义为独立的创作模式，并适配到 Desktop。创作模式升级一次，Web 与 Desktop 同时获得业务能力。

## 1. 产品定义

模式入口固定为：`文`、`武`、`创`。

| 模式 | 运行方式 | 用户任务 |
|---|---|---|
| 文 | 现有 OpenCode plan | 对话、分析、写作 |
| 武 | 现有 OpenCode build | 编程、本机工具、复杂 Agent |
| 创 | 直连模型运行时 | Skill、Wiki、项目文件、媒体生成、画布 |

创作模式不是 Web 页面复制，也不是从武模式拆 OpenCode。它是不启动、不调用 OpenCode 的独立运行时；Web 已是其浏览器适配，Desktop 新增本地项目适配。

## 2. 统一运行时

```text
用户消息 + 已选 Skill 或 Skill 目录
  -> runDirectChatCompletion
  -> 模型按需调用 skill / read / glob / grep / write / edit
  -> 当前项目工具执行并回传结果
  -> 模型继续，直到给出最终文本
```

工具执行过程不展示模型的原始思维链。每轮 function call 与结果会保存到会话，并复用现有折叠工具摘要；最终助手文本仅在整个工具循环结束后提交，避免工具轮次的中间文本闪现并覆盖最终答复。

复用现有：

- `src/runtime/direct/directEngine.ts`：工具循环、取消、12 轮上限；
- `src/utils/directMessageBuilder.ts`：模型消息拼装；
- `src/utils/skillContentResolver.ts`：内置 Skill 目录、按需加载及资源读取；
- `src/stores/mediaTaskStore.ts`、`src/components/creation/`、`src/components/canvas/`：媒体任务、项目媒体和画布。

模型只看到当前项目；工具的所有路径均为项目相对路径，拒绝绝对路径和 `..`。

## 3. 双端适配

| 能力 | Web 创作模式 | Desktop 创作模式 |
|---|---|---|
| 项目真源 | IndexedDB + OPFS | 用户选择的本地项目文件夹 |
| 项目工具 | `webProjectFiles` | 现有 Tauri `dev_*` 文件 IPC，root 固定为当前项目目录 |
| 图片读取 | OPFS Blob data URL | Tauri `dev_read_file` 返回的本地文件 data URL |
| 模型请求 | 现有云端请求 | `safeFetch` + 相同 NewAPI 配置 |
| 媒体与画布 | 当前 Web 实现 | 当前 Desktop 实现 |

Desktop 不向模型暴露 `dev_*` 名称。模型看到的工具名必须与 Web 一致：`skill`、`read`、`glob`、`grep`、`write`、`edit`。

Desktop 工具实现规则：

1. `read`：目录列举、UTF-8 文本分页；项目图片转 data URL；音频和视频仅返回类型、大小和相对路径。
2. `glob`：基于现有 `dev_list_files` 的项目内递归清单做路径模式过滤。
3. `grep`：基于现有 `dev_list_files` 与 `dev_read_file` 在文本文件中执行模式匹配，最多返回 1000 项。
4. `write`：调用现有 `dev_write_file`，自动建立父目录。
5. `edit`：调用现有 `dev_replace_in_file`，默认精确替换一处。
6. `skill`：继续使用公共 `/skills/index.json` 和 `skillContentResolver`，不复制 Skill 仓库。

不增加 Shell、FFmpeg、Office 或 Whisper 到创作模式。它们继续属于武模式或现有创作面板的独立能力。

## 4. 会话与界面

1. Desktop 在现有 ChatPanel 模式按钮中增加 `创`；Web 直接使用创作模式，不显示文/武选择。
2. 创作会话使用独立 `creativeSessionStore`，以现有 IndexedDB `conversations/messages` 保存，记录 `scopeKey: "creative"` 和当前项目标识。
3. 创作会话绝不创建 `ses_*`、绝不写入 `openCodeSyncStore`、绝不继承文/武会话权限。
4. FileTree 的历史列表在创作模式显示当前项目的创作会话；切回文/武后继续显示原 OpenCode 会话。
5. 创作模式发送前必须已有项目：Desktop 要有 `projectStore.projectDir`，Web 要有 `projectStore.webProjectId`。缺少项目时不发送，提示先选择项目。
6. 现有创作面板、媒体历史、画布和项目文件树不复制 UI；创作模式只把对话、Skill 和项目工具接到它们已有的数据边界。

## 5. 实施顺序

### Task 1：模式与创作会话（完成 2026-07-15）

- 新增 `src/stores/chatModeStore.ts`：唯一状态为 `plan | build | creative`，沿用 `jc_agent_mode` 持久化键。
- 新增 `src/stores/creativeSessionStore.ts`：只管理创作会话的 IndexedDB 记录与当前项目过滤。
- `ChatPanel.vue`、`FileTreePanel.vue` 通过模式 Store 选择 OpenCode 会话或创作会话。
- 验收：切换文、武、创三种模式不丢各自历史；创作模式不调用 OpenCode SDK。

实现记录：`chatModeStore` 用既有 `jc_agent_mode` 保存 `plan | build | creative`；`creativeSessionStore` 以 `scopeKey: "creative"` 和项目标识隔离 IndexedDB 会话，ID 不使用 `ses_*`。Desktop 进入创模式时不建立 OpenCode 连接，FileTree 和 ChatPanel 改读创作会话。直连模型发送、项目工具和 Skill 执行严格留待 Task 3。

### Task 2：公共创作工具合同（完成 2026-07-15）

- 从 `webProjectTools.ts` 抽出唯一的工具定义、参数校验和 Skill 资源限制；Web 行为保持不变。
- 新增 Desktop 项目执行器，调用已有 Tauri 文件 IPC，不新增 Rust 文件协议。
- 验收：Web 与 Desktop 对同一项目结构给出同名工具、同样的相对路径、相同的越界拒绝结果。

实现记录：`creativeToolContract.ts` 是六个工具名、JSON 参数验证、相对路径验证和 Skill 已加载资源白名单的唯一来源；Web 保持原执行器，Desktop 新增 `desktopProjectTools.ts`，仅调用 `dev_list_files`、`dev_read_file`、`dev_write_file`、`dev_replace_in_file`。没有新增 Rust IPC，也没有向模型暴露 `dev_*` 工具名。

### Task 3：Desktop 直连创作对话（完成 2026-07-15）

- 新增 `src/composables/creativeChat.ts`，复用 `buildDirectMessages`、`runDirectChatCompletion`、`resolveApiConfig`、`buildHeaders` 与 `safeFetch`。
- 仅将模型声明为支持 function calling 时开放创作模式；否则在发送前给出明确提示，不回退到 OpenCode。
- `ChatPanel.vue` 在 `creative` 时调用此 composable；文、武原发送路径不改。
- 未手动选择 Skill 时，Desktop 与 Web 都注入同一份 Skill 目录，模型按需调用 `skill(name)` 读取对应 `SKILL.md`。
- 工具调用及成功或非取消失败的结果以折叠摘要保留；没有工具轮次文本写入最终答复气泡。
- 验收：Desktop 选中 Skill 后可读写当前项目 Wiki，取消会停止后续工具轮次，工具调用超过 12 轮会停止并报错。

### Task 4：创作面板联动（完成 2026-07-15）

- 创作模式生成媒体继续走既有 `mediaTaskStore`；生成结果仍进入当前项目 `jc-media`，并由既有画布流程引用。
- 验收：Desktop 与 Web 各完成一次“Skill 写 Wiki -> 创作面板生成图片 -> 图片进入项目并加入画布”。

### Task 5：回归与文档（完成 2026-07-15）

- 工具单测：目录/文本/图片读取、glob、grep、write、edit、路径越界、Skill 资源边界。
- 会话单测：创作会话与 OpenCode `ses_*` 隔离、切模式、切项目、取消。
- 运行检查：`pnpm run test:focused`、`pnpm exec vue-tsc -b`、`cargo check --manifest-path src-tauri/Cargo.toml`、`pnpm run build`、`git diff --check`。
- 收尾更新本 SDD、`docs/wiki/hot.md`、`docs/wiki/开发/开发历史.md` 和 `AGENTS.md` 索引。

实现记录：公共 Direct Engine 为缺失的兼容模型工具 id 补齐稳定值，并在两端上报同一调用记录。Web 与 Desktop 都将工具结果保存为关联 `tool` 消息，复用现有折叠摘要 UI；所有工具轮次文本先缓冲，只有循环完成后的最终文本才写入助手消息。已通过 `pnpm run test:focused`、`pnpm exec vue-tsc -b`、`cargo check --manifest-path src-tauri/Cargo.toml`、`pnpm run build` 与 `git diff --check`。

交互修正：工具状态改由执行器明确写入 `succeeded | failed | cancelled`，摘要不再扫描结果正文中的“失败/error”等字样，因此 Skill 教程内容不会被误报为执行失败；真正失败时在折叠详情显示原始错误。创模式不展示原始思维链，也不使用逐帧揭示器：工具执行期间以折叠摘要呈现，工具循环完成后一次性提交最终助手文本。

稳定性修正：创模式首次发送先将用户消息与响应式 assistant 占位消息持久化，再激活会话，避免会话水合读到空记录并覆盖可见消息；回调始终更新数组内的 Vue proxy。未激活会话在创建时绑定项目归属，切项目、切创模式时同步清空共享 OpenCode 消息并进入水合锁；同会话重发使用运行 token，旧请求不能释放新请求的水合锁。模型目录、Skill/command catalog 与共享 OpenCode 命令入口在每个连接前重新检查创模式，因此异步切换后不会再建立或继续使用 OpenCode 连接。

## 6. 完成标准

1. Desktop 用户可在同一模式入口选择 `创`，无需启动或使用 OpenCode 即可完成创作对话。
2. Web 与 Desktop 都使用同一套 Skill 目录和六个创作工具名。
3. 两端的项目文件、生成媒体和画布只归属当前项目。
4. 文模式与武模式的 OpenCode 会话、权限、工具和事件流行为没有变化。
5. 创作模式的业务规则升级在公共直连运行时完成；双端只保留存储与文件读取适配差异。

# 文武道模式 OpenCode Prompt 上下文对齐 SDD

> 日期：2026-07-22  
> 状态：已实施（2026-07-22；专项、完整 focused、类型检查与 Desktop 前端 quick 构建通过）
> 基线：OpenCode SDK/runtime v1.18.4  
> 范围：Desktop 文、武、道共用 Prompt 输入合同

## 1. 目标

保留 OpenCode v1.18.4 官方 Agent 循环和 Skill 两阶段加载机制，只修正韭菜盒子适配层丢失的 Prompt 上下文：

```text
用户文本 + @文件/文件夹 + 显式 Skill
-> OpenCode text/file/agent parts + 会话 Skill permission
-> promptAsync
-> OpenCode 官方 Agent 循环
```

## 2. 已确认事实

### 2.1 Skill 加载本身已对齐

OpenCode v1.18.4 官方分两阶段：

1. 每轮把当前 Agent 有权使用的 Skill `name + description + location` 放入系统上下文。
2. 模型调用 `skill({ name })` 后，才把该 Skill 的完整 `SKILL.md` 正文和抽样资源返回给模型。

韭菜盒子不重写这套机制。自动 Skill 模式仍使用官方全量可用索引；本轮不做自定义预路由、候选截断或隐藏 Skill。

### 2.2 固定 Skill 首轮存在时序缺口

当前 `ChatPanel` 在 session 激活后以不等待的 watcher 调用 `session.update(permission)`。新会话立即发送时，`promptAsync` 与权限更新存在竞争条件，首轮会在权限落库前暴露全部 Skill。

### 2.3 `@` 上下文只完成了界面

当前真实缺口：

- 项目文件搜索尚未实现。
- `recentFiles` 恒为空数组。
- `extractPills()` 已实现但发送时未消费。
- 用户看到的 `@` 引用标签最终只变成普通文本，没有进入 OpenCode `file part`。

## 3. 设计

### 3.1 固定 Skill

- 自动模式：不设置 Skill 限制，保持 OpenCode 官方行为。
- 用户显式选择 Skill：使用现有 `buildSkillPermissionScope()` 产生“拒绝全部 + 只允许选中名称”的官方 permission。
- 新会话：在首次 `promptAsync` 前确保该 permission 已落到当前 session。
- 已有会话切换 Skill：沿用 session 生命周期更新，同一 session + Skill 不重复提交。

### 3.2 `@` 文件和文件夹

- 候选项来自当前项目的真实文件/目录搜索，不扫用户 Home，不扩大边界。
- 当前编辑器已打开的项目文件作为最近项；没有真实来源时不伪造。
- 选中后继续使用现有非可编辑 pill，发送时调用 `extractPills()`。
- `file` pill 转为 OpenCode 官方 `file part`：Desktop 项目路径使用 `file://` URL，目录使用 `application/x-directory`。
- `agent` pill 继续按 OpenCode agent part 表达，不拼成隐藏系统提示。
- 一次发送只消费当前输入框中的 pill，发送后清空，不跨轮暗中继承。

### 3.3 错误语义

- 引用资源在发送前已不存在：不发起 Prompt，保留输入和引用，明确提示失效路径。
- OpenCode 拒绝越界路径：原样展示官方错误，不改成 Home 或其他目录。
- permission 更新失败：不带错误的 Skill 权限发送，保留草稿并显示失败。

## 4. 不做

- 不修改 OpenCode runtime 源码。
- 不改写官方 Gemini 系统提示词。
- 不限制官方 Agent 工具循环次数。
- 不为“查看”等短词加本地硬编码意图。
- 不实现 Skill 预路由、Top-K 候选、摘要或缓存。
- 不改创模式、Web 直连、媒体任务或 New API。

## 5. 验收标准

1. 自动 Skill 模式保持 OpenCode 官方可用 Skill 索引。
2. 显式选择一个 Skill 后，新会话第一轮只暴露该 Skill，且模型通过官方 `skill` 工具加载正文。
3. `@`搜索能找到当前项目内的文件和文件夹。
4. 发送 `@短视频剧本项目 查看` 时，数据库中的用户消息同时包含 text part 和指向该目录的 file part。
5. 删除 pill 后发送，不得携带已删除资源。
6. 引用失效时不进入 Agent 循环，输入不丢失。
7. 文、武、道共用同一构造和发送入口；创模式行为不变。
8. 专项测试、`vue-tsc -b`、Desktop 构建和 `git diff --check` 通过。

## 6. 实施回执（2026-07-22）

- `ChatPanel` 通过 `ProjectFileService.searchPaths()` 查询当前项目，并从编辑器会话提供最近已打开的 Desktop 项目文件；`plan`、`build`、`dao` 继续作为官方 agent part。
- `extractPills()` 只消费本轮仍在输入框内的引用。发送前会再次以项目服务确认文件或目录存在，失效时保留草稿和 pill；项目目录使用 `application/x-directory`，路径经共享构造器转为 `file://`。
- 新会话在 `session.create` 时携带所选 Skill permission；既有会话由 Store 按规则集串行去重并在 `promptAsync` 前完成更新，快速切换时最后选择不会被旧请求覆盖。失败时不发送 prompt，输入恢复并显示错误。
- 项目搜索忽略软链接，引用 URL 对路径段编码并覆盖常用图片、PDF、音视频 MIME，避免借项目链接扫描 Home 或将原生媒体降级为普通文本。
- 通过：本轮 Session/Sync Store/ChatPanel/ContentEditable 专项测试、完整 `pnpm run test:focused`、`vue-tsc -b`、`pnpm run build:desktop:quick`、`git diff --check`。
- 真实 Desktop 文/武/道 Provider 验收和三平台安装包矩阵仍待补。

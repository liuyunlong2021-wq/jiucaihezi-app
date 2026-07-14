# Web 项目与工具适配 SDD

> 日期：2026-07-14
> 目标：把 Desktop 已有的项目、工具和 Skill 按需加载能力等价适配到 Web。

## 1. 第二列项目适配

### Desktop 现状

- `FileTreePanel.vue` 的项目页签渲染 `ProjectFileTree.vue`；
- `projectStore.ts` 保存当前项目目录；
- `ProjectFileTree.vue` 通过 Tauri `dev_*` 命令读写本地文件系统；
- 支持选择项目、新建文件/文件夹、打开、编辑、重命名、删除、复制路径和刷新。

### Web 适配

复用 `FileTreePanel.vue`、`ProjectFileTree.vue`、`projectStore.ts` 和 `useFileStore.ts`，只增加 Web 数据分支：

1. 在现有 IndexedDB `documents` 中，用顶层文件夹记录一个项目；
2. `projectStore.ts` 在 Web 保存当前项目 ID，在 Desktop 继续保存本地目录；
3. `ProjectFileTree.vue` 的 Web 分支从 `documents` 读取当前项目的子树；
4. 新建、打开、编辑、重命名和删除操作写回 `documents`；
5. 文件仍用 `folderId` 组成目录树，工具使用相对路径定位文件；
6. 文本内容直接存入 `documents`，图片和视频项目条目保存可访问 URL 与媒体信息；
7. 创作面板生成的文本、图片和视频写入当前项目；
8. 右键“另存为”调用 Desktop 原生保存或 Web 浏览器下载。

Web 第二列最终与 Desktop 使用同一套界面和交互，只替换底层文件来源：

```text
Desktop → 本地项目目录 + Tauri dev_* 命令
Web     → 当前项目 ID + IndexedDB documents
```

## 2. 工具适配

### 文件工具

Web 向模型提供 OpenCode 同名工具：

| 工具 | Web 执行方式 |
|---|---|
| `read` | 从当前项目读取目录、文本或图片 |
| `glob` | 按路径模式查找当前项目文件 |
| `grep` | 搜索当前项目文本内容 |
| `write` | 在当前项目创建或覆盖文件，并建立父目录 |
| `edit` | 修改当前项目已有文本文件 |

这些工具统一调用 `useFileStore.ts` 和 IndexedDB。当前项目 ID 由 Web 执行器绑定，所有路径限制在当前项目内。

### 连续工具调用

改造 `directEngine.ts` 和 `directTools.ts`：

1. `directTools.ts` 按工具名分发到对应 Web 执行函数；
2. 工具结果追加到当前消息，再交给模型；
3. 模型继续调用下一个工具或返回最终文本；
4. 工具循环支持取消、最大轮数和错误结果回传。

## 3. Skill 按需加载适配

### 首轮输入

Web 首轮向模型发送：

- 当前会话；
- 用户本次输入；
- 已安装 Skill 的 frontmatter `name` 和 `description`；
- 可用工具说明。

### 加载流程

1. 模型根据用户输入匹配 Skill；
2. 模型调用 OpenCode 同名的 `skill({ name })`；
3. Web 通过现有 `skillContentResolver.ts` 加载对应 `SKILL.md` 和资源清单；
4. 模型按 Skill 指令调用 `read/glob/grep/write/edit`；
5. Skill 要求使用另一个 Skill 时，模型再次调用 `skill`；
6. 用户手动选择 Skill 时，直接加载用户选择的 Skill。

```text
用户输入
  → 模型匹配 Skill description
  → skill 加载 SKILL.md
  → Skill 指挥模型读取或写入当前项目
  → 需要时继续加载其他 Skill
  → 完成任务
```

产品只提供 Skill 目录、工具和执行结果，具体调用顺序由模型按照 Skill 决定。

## 4. 实施顺序

1. 给 `ProjectFileTree.vue` 和 `projectStore.ts` 增加 IndexedDB 项目分支；
2. 让编辑器和创作面板读写当前 Web 项目；
3. 实现 `read/glob/grep/write/edit` 的 Web 执行函数；
4. 实现 `skill` 的目录注入和按需加载；
5. 把 Web 直连链路改成连续工具循环；
6. 验证项目操作、Skill 建库和 Skill 联动。

## 5. 验收

- Web 第二列可以创建、切换和管理项目文件；
- 创作面板生成内容可以进入当前项目；
- 模型可以用 `read/glob/grep/write/edit` 操作当前项目；
- 模型可以自动加载命中的 Skill；
- 一个 Skill 可以按指令加载另一个 Skill；
- Skill 可以创建并持续维护项目 Wiki；
- 模型可以读取项目图片。

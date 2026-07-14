# Web 项目与工具适配 SDD

> 日期：2026-07-14
> 状态：代码完成，分支 `0713-webchonggou`
> 目标：把 Desktop 的项目、文件工具和 Skill 渐进加载能力适配到 Web。

## 1. Web 项目

Web 复用第二列 `ProjectFileTree.vue`，项目数据保存在浏览器 IndexedDB 的 `documents` 中：

1. `projectStore.ts` 保存当前 Web 项目 ID 和名称；
2. `webProjectFiles.ts` 负责项目隔离、相对路径校验、目录和文件 CRUD；
3. 文本直接存 IndexedDB，图片、视频和音频保存远程 URL 与媒体信息；
4. `ProjectFileTree.vue` 负责创建、切换、打开、编辑、重命名、删除和刷新；
5. 模型写入文件后发送变更事件，第二列立即刷新；多标签页通过 `BroadcastChannel` 同步刷新；
6. 失效的本地项目 ID 在加载项目列表时自动清理；
7. 右键“另存为”在 Web 触发浏览器下载，在 Desktop 由 Rust 原生复制文件，不把大视频读入前端内存。
8. 同一项目的写入由浏览器 Web Locks 串行化，稳定路径 ID 防止并发首次写入产生重复文件。

```text
Desktop -> 本地项目目录 + Tauri dev_* 命令
Web     -> 当前项目 ID + IndexedDB documents
```

## 2. Web 文件工具

`webProjectTools.ts` 向模型提供六个工具：

| 工具 | 执行内容 |
|---|---|
| `skill` | 按名称加载 Skill 的 `SKILL.md` 和资源清单 |
| `read` | 读取当前项目目录、文本、图片或已加载 Skill 的资源 |
| `glob` | 按路径模式查找当前项目文件 |
| `grep` | 搜索当前项目文本 |
| `write` | 创建或覆盖文件并自动建立父目录 |
| `edit` | 精确替换已有文本 |

当前项目 ID 由执行器绑定，不由模型传入；绝对路径和 `..` 会被拒绝，因此工具不能越过当前项目。

`directEngine.ts` 最多执行 12 轮连续工具调用，支持取消、工具错误回传，以及 SSE 和普通 JSON 两种标准 `tool_calls` 响应。

## 3. Skill 渐进加载

1. `build-skills-index.mjs` 递归扫描 `public/skills/**/SKILL.md`；
2. 首轮只向模型提供 Skill 的 `name` 和 `description`；
3. 模型命中需求后调用 `skill` 加载完整 `SKILL.md`；
4. Skill 可以继续调用 `read/glob/grep/write/edit`，也可以再加载另一个 Skill；
5. 用户手动选择 Skill 时，继续使用原有手动 Skill 内容；
6. Web Skill 仓库和模型目录都以 `public/skills/**/SKILL.md` 为唯一来源，目录增加或删除 Skill 后重新构建索引即可同步变化。

```text
用户输入
  -> 模型匹配 Skill description
  -> skill 加载 SKILL.md
  -> Skill 调用项目文件工具
  -> 按需加载其他 Skill
  -> 返回结果
```

## 4. 验证

2026-07-14 已执行 `pnpm run build`：

- Node 聚焦测试：771/771；
- Rust：372 通过，1 忽略，0 失败；
- `vue-tsc -b`：通过；
- Vite Production 构建：通过；
- Web 产物裁剪与 `audit:web-dist`：通过；
- `http://127.0.0.1:1420/`：HTTP 200；
- `/skills/index.json`：与所有包含标准 `SKILL.md` 的目录双向一致，无名称白名单。

真实对话验收使用支持 OpenAI 标准 `tool_calls` 的模型；读取图片时使用支持 `image_url` 的多模态模型，并保证项目中的远程媒体 URL 仍在有效期内。

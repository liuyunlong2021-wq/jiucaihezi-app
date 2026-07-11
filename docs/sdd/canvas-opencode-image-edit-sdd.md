# 画布 OpenCode 协同改图 SDD

> **状态**: 提案，待评审后实施
> **日期**: 2026-07-12
> **范围**: 桌面端 Tauri + OpenCode；Web 端不在本期范围
> **前置决策**: 画布内核独立，Canvas Bridge 是唯一写入口；第一期通过本地命令连接 OpenCode，MCP 作为未来适配器，不先建设。

## 1. 目标

让用户在画布中选中一张图片后，在 OpenCode 对话中用自然语言发起改图；Agent 调用 `JC-瞬间创作` 完成图生图，再通过 Canvas Bridge 把结果安全替换回画布。

首期用户路径：

```text
选中画布图片 → 对话输入“把背景改成夜景，保留人物”
  → OpenCode 加载 JC-瞬间创作
  → jc_media.py 将选中图片作为 images 输入提交改图
  → 任务完成后产物写入 {projectDir}/jc-media/images/
  → jc_canvas.py replace-image 以目标元素 ID 替换图片来源
  → Canvas Bridge 写入新 revision
  → 画布检测 revision 并刷新，用户可撤销
```

## 2. 非目标

- 不让 Agent 直接访问 Leafer DOM、Vue ref 或浏览器窗口。
- 不让 Agent 任意编辑画布 JSON。
- 不在本期创建 MCP Server、云端协作、多人实时同步或 Web 端 Agent 执行。
- 不重新实现 `JC-瞬间创作` 的模型路由、计费、轮询或下载。
- 不让 AI 在没有用户选中目标时默认替换任意画布图片。

## 3. 事实与约束

| 事实 | 影响 |
|---|---|
| OpenCode Desktop 有 Skill、shell、文件、MCP 配置能力，但没有画布模块 | Canvas 是本产品胶水层，不能假称为官方逐行翻译 |
| `JC-瞬间创作/scripts/jc_media.py` 支持本地图片作为 `images` 输入 | 改图直接复用 Skill，不新建媒体执行器 |
| 生成产物已经落入项目 `jc-media/` | Bridge 只保存文件引用，不保存媒体字节 |
| 当前 `canvasStore` 只保存图层元数据 | 无法让 Agent 可靠读写文字、箭头、画笔、编号，必须先升级 |
| OpenCode 与 Vue/Leafer 是不同进程边界 | 同步只能经项目文件与受控命令，不能直接调用 DOM |

## 4. 总体架构

```text
Leafer Canvas UI
  │ 读写完整场景文档、维护选择状态、呈现历史
  ▼
Canvas Core
  ├─ scene document + revision
  ├─ stable node ID
  ├─ selection context
  └─ validation / history boundary
  │
  ▼
Canvas Bridge (唯一写入口)
  ├─ jc_canvas.py 本地命令，第一期
  └─ MCP adapter，后续复用同一操作契约
  │
  ▼
OpenCode Agent + JC-瞬间创作
  ├─ 读取选择上下文
  ├─ jc_media.py 图生图/改图
  └─ 调 Bridge replace/add/annotate
```

Canvas Core 是产品内核；Canvas Bridge 与 MCP 都只是该内核的适配器。先实现 Bridge 不会限制未来接入 MCP。

## 5. P0：完整画布场景文档

### 5.1 存储位置

```text
{projectDir}/.jiucaihezi/canvas/default.json
{projectDir}/.jiucaihezi/canvas/default.lock
{projectDir}/.jiucaihezi/canvas/default.operations.jsonl
```

- `default.json` 是唯一画布真源。
- 画布只引用 `jc-media/` 下的文件或兼容的既有远程 URL，媒体字节不进入 JSON。
- 写入必须为原子替换：先写同目录临时文件，再 rename。
- `lock` 只覆盖单次 Bridge 事务；超时为 120 秒，符合慢机器约束。

### 5.2 文档契约

```ts
interface CanvasSceneDocument {
  version: 2
  canvasId: 'default'
  revision: number
  updatedAt: number
  scene: LeaferNodeJson[]
  selection: {
    ids: string[]
    updatedAt: number
  }
  assets: Record<string, CanvasAsset>
}

interface CanvasAsset {
  nodeId: string
  kind: 'image'
  path: string               // project-relative jc-media path preferred
  fallbackUrl?: string
  source: 'creation' | 'drop' | 'agent-edit' | 'agent-generate'
  prompt?: string
  parentAssetId?: string     // 改图来源，便于追溯
  createdAt: number
}
```

`LeaferNodeJson` 来自 Leafer 官方 `toJSON()` / `UI.one()`；每个可操作根节点必须有稳定 `id`。编号标注作为一个 `Group` 根节点保存，内部圆与文字不是独立的 Agent 目标。

### 5.3 UI 同步规则

1. 画布初始化：读取完整 `scene`，用 `UI.one()` 恢复到 `app.tree`。
2. 手工增删改：2 秒 debounce 后写入 revision + 1 的文档。
3. 编辑器选择变化：仅更新 `selection.ids`，不改 scene；300ms debounce。
4. 画布面板打开时轮询文档 revision，周期 1 秒；revision 变化才 reload。第一期只在桌面端启用。
5. 外部 revision 到来时，UI 先保存当前场景为本地撤销快照，再加载新场景；Ctrl+Z 可撤销最近一次外部操作。
6. 若 UI 有尚未落盘的本地修改，先 flush 再读取外部 revision，不能覆盖用户手工修改。

### 5.4 兼容迁移

- 读取旧版 `CanvasDocument` 时，按旧 `layers[]` 构建 `scene[]`，为每个图片生成 `canvas_<uuid>` ID。
- 首次保存升级为 v2；保留原文件副本 `.v1.bak` 一次。
- 历史没有画布文件时创建空 v2 文档。

## 6. Canvas Bridge 命令契约

第一期提供 `public/skills/JC-瞬间创作/scripts/jc_canvas.py`。它是本地 CLI，不是新服务。

```text
python3 jc_canvas.py inspect --project-dir <absolute-project-dir>
python3 jc_canvas.py replace-image --project-dir <dir> --target-id <id> --image <path> --if-revision <n>
python3 jc_canvas.py add-image --project-dir <dir> --image <path> --x <n> --y <n> --if-revision <n>
python3 jc_canvas.py move --project-dir <dir> --target-id <id> --x <n> --y <n> --if-revision <n>
python3 jc_canvas.py delete --project-dir <dir> --target-id <id> --if-revision <n>
python3 jc_canvas.py annotate --project-dir <dir> --target-id <id> --text <text> --if-revision <n>
```

### 6.1 每条命令的共同规则

- 标准输出只输出一个 JSON 对象：`{ ok, revision, changedIds, documentPath, error? }`。
- 非 `inspect` 命令必须带 `--if-revision`；不匹配返回 `REVISION_CONFLICT`，不得写入。
- `target-id` 必须在当前 scene 根节点中存在；`replace-image` 只接受 `assets` 中的图片节点。
- `image` 必须 canonicalize 后仍位于项目 `jc-media/` 内；拒绝任意绝对路径、`..`、符号链接越界。
- 命令写入前后将操作摘要追加到 `default.operations.jsonl`，不记录 API Key 或图片字节。
- Bridge 不调用模型、不读取 Key、不承担媒体下载。

### 6.2 图片替换语义

`replace-image` 保留目标图片节点的：ID、位置、缩放、旋转、层级、锁定状态；只替换 `url/path` 与 asset 元数据。

默认行为是替换，不是叠加。用户明确说“新增一版”“保留原图”时，Agent 使用 `add-image`，并在原图右侧偏移 24px 放置新版本。

## 7. OpenCode 与 Skill 编排

### 7.1 选择上下文注入

当用户在画布选中一个或多个元素后，对话发送前追加隐藏上下文：

```text
Canvas selection:
- canvas: default
- revision: 17
- node: canvas_img_a1b2
  type: image
  path: /absolute/project/jc-media/images/source.png
  annotations: ["1: 换成夜景"]
```

- 没有选中图片时，不注入改图上下文。
- 多选图片时，Agent 必须先说明将批量处理哪些目标并获得确认；第一期不自动批量提交。
- 选中的文字/箭头/编号只作为标注上下文，不可作为 `replace-image` 目标。

### 7.2 固定 Skill 规则

用户以选中图片提出“改图、修图、去背景、扩图、替换文字、换风格”等请求时：

1. 前端选择 `JC-瞬间创作`，沿用 `buildFixedSkillSystemInstruction()` 的官方 Skill 加载链路。
2. Skill 先执行 `jc_canvas.py inspect`，确认 revision、目标 ID、输入路径。
3. Skill 使用 `jc_media.py submit --type image --input <path>` 提交图生图任务；模型和参数仍以 Skill 的能力表为准。
4. Skill 轮询任务并将最终图片写入 `{projectDir}/jc-media/images/`。
5. Skill 使用 `replace-image` 或 `add-image` 写回，带提交前读取的 revision。
6. 如返回 `REVISION_CONFLICT`，Skill 重新 `inspect`，向用户说明目标已变化后重新规划；不得盲目覆盖。

### 7.3 标注驱动改图

编号、箭头、文字、画笔都是 scene 的一部分。Agent 读取选中图片附近的标注，将其压缩为改图提示词，例如：

```text
以参考图为基础：
1. 编号 1 箭头指向左上角人物，改为微笑。
2. 编号 2 圆圈位置替换为霓虹灯招牌。
保持构图、人物身份和其余区域不变。
```

第一期只传与选中图片发生空间相交或距离最近的标注，避免把整张画布无关信息塞入模型上下文。

## 8. 权限与安全

| 边界 | 规则 |
|---|---|
| OpenCode Skill | 只允许固定的 `JC-瞬间创作`，沿用现有 Skill permission scope |
| Shell | 首次执行媒体脚本与 Bridge 命令按 OpenCode 权限流程展示；不静默放开任意命令 |
| 文件路径 | Bridge 限制在当前项目 `.jiucaihezi/canvas/` 与 `jc-media/` |
| API Key | 仅由 `jc_media.py` 现有三级 Key 解析处理，Bridge 完全不可见 |
| 并发 | revision + 原子写入 + 120 秒锁；冲突返回，不做最后写入者覆盖 |
| Web | 本期禁用该链路，浏览器不执行本地脚本、不读取项目绝对路径 |

## 9. 实施阶段

### Phase 0：场景真源

- v2 `CanvasSceneDocument`、稳定 ID、旧数据迁移。
- Leafer scene 完整保存/恢复。
- 选择上下文写入/恢复、revision 轮询同步。
- 验收：重启后图片、文字、箭头、画笔、编号、群组、位置和层级均恢复。

### Phase 1：Canvas Bridge

- 实现 `inspect`、`replace-image`、`add-image`；其余 `move/delete/annotate` 预留到第二小步。
- 路径校验、revision 冲突、原子写、操作日志。
- 验收：CLI 不能越出项目目录；错误 revision 不改文件；替换保留元素几何属性。

### Phase 2：选中图片改图

- `canvasStore` 暴露选择上下文。
- Chat 提交时注入选择上下文。
- 为 `JC-瞬间创作` 增加画布改图参考与调用规则。
- 验收：选中一张图并说“改成夜景”后，产物落入 `jc-media/images/`，原位置显示改图，原图可通过撤销恢复。

### Phase 3：标注理解与版本分支

- 将附近箭头、文字、编号、画笔转为结构化标注提示词。
- 支持“新增一版”而不是替换，并记录 `parentAssetId`。
- 验收：编号标注对应的修改要求稳定进入提示词；新版本与原图可并排比较。

### Phase 4：MCP 适配器，按需

仅在以下任一条件满足时建设：外部 Agent/第三方客户端需要调用；命令数量超过 10 且 shell 参数难以维护；需要资源订阅或远程会话。

MCP Server 只映射 Canvas Bridge 的同名操作，禁止复制业务逻辑。

## 10. 验收矩阵

| 场景 | 期望结果 |
|---|---|
| 手工创建完整场景后重启 | 所有 Leafer 元素和顺序恢复 |
| Agent inspect | 返回选中图片、revision、项目内路径，不含媒体字节 |
| 选中单图改图 | Skill 使用该图输入，结果替换原节点并保留位置/缩放 |
| 用户说“新增一版” | 原图保留，新图偏移加入且可比较 |
| Agent 与用户同时改图 | revision 冲突，不覆盖用户最新修改 |
| Ctrl+Z | 恢复 Agent 操作之前的场景 |
| 非法 `--image /etc/passwd` | Bridge 拒绝且 scene 不变 |
| Web 端发送同类请求 | 明确提示桌面端专属，不尝试执行本地命令 |

## 11. 风险与取舍

| 风险 | 处理 |
|---|---|
| 当前 `CreationPanel.vue` 过大 | P0 可先在现有文件验证契约；Bridge、scene serializer 必须独立到 `src/components/canvas/`，避免继续膨胀 |
| Agent 误解标注 | 第一期开启用户选中目标，结构化提取附近标注，不允许全画布猜测 |
| 异步生成期间用户移动原图 | replace 命令按 revision 冲突，要求重新确认，不覆盖 |
| 生成失败 | 不写 Canvas Bridge；原图和场景不变化 |
| 画布复杂后的 JSON 变大 | 首期接受整文档原子写；超过 5 MB 再评估增量操作日志/分块存储 |

## 12. 决策记录

- 2026-07-12：不让 OpenCode 操控 DOM；采用项目文件 + Canvas Bridge。
- 2026-07-12：第一期只支持用户显式选中单张图片后改图。
- 2026-07-12：先用本地 CLI，不先建设 MCP；未来 MCP 只能适配同一 Bridge 契约。
- 2026-07-12：媒体生成完全复用 `JC-瞬间创作`，不复制 NewAPI/RH 调用链。

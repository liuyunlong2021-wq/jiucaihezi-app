# jc_media.py 脚本内置方案

> **状态**: ✅ 已完成  
> **日期**: 2026-07-17  
> **关联**: `public/skills/JC-瞬间创作/SKILL.md` · `~/.jiucaihezi/tools/jc_media.py`

---

## 0. 问题

`JC-瞬间创作` 的 SKILL.md 使用 `{baseDir}/scripts/jc_media.py` 引用执行脚本，但 `{baseDir}` 在不同运行时解析结果不同：

| 运行时 | `{baseDir}` 解析为 | 脚本存在？ |
|--------|-------------------|-----------|
| Codex CLI | `~/.codex/skills/JC-瞬间创作/` | ❌ |
| Web/Desktop | `/skills/JC-...`（URL 路径） | ❌ |
| 项目源码 | `public/skills/JC-瞬间创作/` | ✅ |

结果：AI 执行 `python3 {baseDir}/scripts/jc_media.py` → 文件不存在 → 任务提交后无法轮询/下载。

---

## 1. jc_media.py 是什么

零外部依赖 Python CLI（stdlib + curl），覆盖全部媒体生成流程：

| 子命令 | 功能 |
|--------|------|
| `submit` | POST NewAPI → 返回 task_id（异步） |
| `poll` | GET 任务状态 → completed 后自动下载 |
| `run` | submit + poll + download（同步一键） |
| `list` | 列出可用模型 |
| `info` | 查看模型参数 |
| `check` | 验证 API 连接 |
| `app-info` | 查看 AI 应用节点 |
| `app-run` | 运行 AI 应用（ComfyUI 工作流） |

Key 解析：`--api-key` → `JC_API_KEY` → `~/.jiucaihezi/.jc_api_key`

---

## 2. 方案：内置到 `~/.jiucaihezi/tools/`

`~/.jiucaihezi/` 已是韭菜盒子的用户级配置目录：
- `.jc_api_key` ← Key 文件
- `plugins.json` ← 插件配置
- `opencode-runtime/` ← OpenCode 运行时
- **`tools/jc_media.py`** ← 媒体生成脚本（本次新增）

所有运行时（Codex / Web / Desktop）统一路径 `~/.jiucaihezi/tools/jc_media.py`。

### SKILL.md 改动

将 `{baseDir}/scripts/jc_media.py` 替换为 `~/.jiucaihezi/tools/jc_media.py`，保留 `{baseDir}` 作为回退。

### 后续扩展

`~/.jiucaihezi/tools/` 可扩展为 CLI 工具集（`jc_project.py`、`jc_config.py` 等）。

---

## 3. 改动文件

| 文件 | 操作 |
|------|------|
| `~/.jiucaihezi/tools/jc_media.py` | 新增（从 `public/skills/` 复制） |
| `public/skills/JC-瞬间创作/SKILL.md` | 修改 3 处路径引用 |
| `docs/wiki/开发/jc-media脚本内置方案.md` | 新增（本文档） |

原 `public/skills/JC-瞬间创作/scripts/jc_media.py` 保留作为回退副本，不做删除。

---

## 4. 执行验证

**时间**: 2026-07-17

| 验证项 | 命令 | 结果 |
|--------|------|------|
| 脚本可执行 | `python3 ~/.jiucaihezi/tools/jc_media.py check` | ✅ NewAPI 就绪，88 模型 |
| 轮询已有任务 | `poll --task-ids "2077798525055688705" --type image` | ✅ 7s 完成，下载 494KB PNG |
| 产出位置 | `jc-media/images/2077798525055688705.png` | ✅ 正确 |

### 审计结论

- **功能完整性**：脚本 8 个子命令全部保留，check + poll 双验证通过
- **过度设计**：无。改动量 = 1 文件复制 + 3 行路径 + 1 文档
- **回退路径**：原 `public/skills/` 副本未删除，SKILL.md 保留 `{baseDir}` 回退提示

# Skill Creator 无法读取已安装 Skill

> 日期：2026-09-05

## 根因

Skill 管理器通过中央 Skill 仓库读取用户已安装的 Skill；对话中的 `skill-creator` 原先只有校验、测试、评审、打包和保存工具，没有按 Skill ID 读取已安装 `SKILL.md` 的入口。模型因此错误退回当前项目的 Terminal 搜索，而项目目录不包含中央 Skill 根目录，最终误报“找不到”。

## 修复

- 新增只读工具 `skill_creator_load_installed_skill`，只接受已扫描 Skill 的精确 ID 或唯一名称。
- 工具复用 `agentStore` 已加载的中央 Skill 数据和现有安全资源目录读取能力，不开放任意文件路径。
- 用户 Skill 返回完整 `SKILL.md`、目标 ID 和包内文件清单；缺失、名称冲突、空文件和只读 Skill 返回明确错误。
- 修改现有 Skill 时必须先调用该工具，禁止使用 Terminal、项目文件、Wiki 或绝对路径查找目标。
- 更新时保留原 YAML `name`；现有安装卡识别同 ID 为更新，并继续由用户点击后写入中央 Skill 根目录。后端只覆盖原 `SKILL.md`，不删除同目录的 `references/`、`scripts/` 或 `assets/`。

## 边界与验证

没有增加通用文件权限、第二套 Skill 管理器或自动写入。`skill-creator` 仍不能隐式执行目标 Skill；目标 Skill 只是待编辑源码。

自动验证：新增读取成功、缺失和只读边界测试；定向 `28/28`、完整 focused `1212/1212`、`vue-tsc -b` 和定向 lint 通过。真实 Desktop 中选择 `skill-creator` 修改已安装 Skill、点击更新卡并重启复查尚未人工验收。

## 后续维护与发布

- 「我的 Skill」的“修改”按钮自动选择 `skill-creator`，并把 `skill_id` 与展示路径填入输入框；实际加载必须使用 `skill_creator_load_installed_skill`，不能按路径搜索。
- 中央 Skill 根目录是 `~/.agents/skills`（本机示例：`/Users/by3/.agents/skills`）；`.agent/skills/...` 是错误路径写法。
- 修改后的安装卡仍由用户点击确认，同一 `skill_id` 覆盖原 `SKILL.md`，保留同目录的 `references/`、`scripts/` 和 `assets/`。
- 桌面三平台发布由 `.github/workflows/build.yml` 的 `v*` tag 触发，顺序是提交版本文件、创建 annotated tag、分别推送 `main` 和指定 tag；不能直接推送不存在的 tag，也不能使用 `git push --tags`。

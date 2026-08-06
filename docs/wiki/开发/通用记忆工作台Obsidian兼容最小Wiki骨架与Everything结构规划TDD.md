# 通用记忆工作台 Obsidian 兼容最小 Wiki 骨架与 Everything 结构规划 TDD

> 日期：2026-08-05
> 状态：已实施

## 决策

Obsidian Vault 可以是普通空目录，笔记、目录和内部链接均按需创建，官方没有“每次必读文件”。韭菜盒子因此不创建 README、CLAUDE 或其他替代性的强制读取页，也不把任何 Wiki 页面固定注入每轮请求。

“新建记忆空间”只生成 App 当前生命周期需要的四个文件：

```text
wiki/
├── index.md
├── hot.md
├── log.md
└── 来源索引.md
```

- `index.md` 只导航顶层分类。
- 分类目录的 `_index.md` 说明本目录用途并导航直属子目录。
- 初始化不猜业务类型，不创建 `方向.md`、业务分类或空模板。
- 重复初始化只补缺失项，不覆盖已有内容。

`jc-everything-wiki` 只负责在现有 Wiki 上设计结构：读取现状和目标，只追问会改变目录设计的问题，先给最小方案，用户确认后创建并复查。内容填充不属于本 Skill。

## 测试

1. generic scaffold 只创建四个生命周期文件。
2. generic validate 不要求 README、CLAUDE、`方向.md` 或业务目录。
3. 记忆请求不自动注入任何 Wiki 页面。
4. 顶层分类写入 `index.md`；嵌套分类只写入直接父目录的 `_index.md`。
5. Everything Skill 不包含旧 scaffold、Reference 或内部工具动作，只保留结构规划合同。

## 非目标

- 不迁移、删除或覆盖已有 README、CLAUDE、Wiki、Raw 和用户文件。
- 不照搬 Obsidian 插件、模板或 `.obsidian/` 配置。
- 不为尚未发生的业务类型预建目录。

# Wiki 四 Skill 产品化升级 SDD

> 日期：2026-07-20
> 状态：已完成自动验证；真实普通用户长流程与打包后 Desktop 工具环境仍待人工验收
> 范围：`jc-cha-wiki`、`jc-raw-wiki`、`jc-jian-wiki`、`jc-xiu-wiki`

## 1. 根因

四个 Skill 已有正确职责边界，但脚本出口仍偏向开发工具：查询会被归档高频结果淹没，Raw 验证只检查入口文件存在，巡检把归档示例与现行风险混报，修正脚本虽默认预览却没有统一问题依据、精确 diff 和修后回执。

本次不增加后台服务、数据库或配置层，直接收敛四个现有脚本与 Skill 合同。

## 2. 最终能力

### `jc-cha-wiki`

- 搜索默认只查现行知识，排除 `归档/` 与 `log.md`；追溯历史时显式使用 `--scope all`。
- 结果按 `hot.md/CLAUDE.md -> 架构 -> 开发 -> 运维 -> 排障 -> 学习 -> 巡检报告` 排序，每页最多展示三条，避免单篇高频文档占满结果。
- 状态查询识别当前 `架构/开发/运维` 目录，并按 `log.md` 最新在上的真实顺序读取最近操作。
- Skill 最终回答固定覆盖“结论、证据、风险、下一步”，脚本输出只作为证据候选。

### `jc-raw-wiki`

- 新增只读 `closeout`：预览建议落位、Git 变更、测试/构建证据状态、证据文件与 Git status/diff 的短 SHA-256 指纹、未验证项。
- 缺少测试或构建证据时明确禁止写成已通过；指纹只证明读取内容未变，不代表覆盖充分。
- `validate` 除检查 `hot.md`、`log.md`、`来源索引.md` 存在，还验证 `hot.md` 与 `来源索引.md` 的 Wiki 链接可达。

### `jc-jian-wiki`

- 先区分现行页面与 `归档/`、头部标为历史/已归档/已替代的页面；归档问题单列为“归档卫生”，不改变现行巡检退出码。
- 使用仓库已有 `marked` 解析 Markdown 文本 token，排除 fenced code、inline code、HTML 注释和转义语法。
- `marked` 已由 `esbuild` 打进自包含 helper；每次 `build-skills-index.mjs` 自动重建，运行时不依赖用户项目的 `node_modules`。
- 真实复巡：现行断链 0；归档卫生断链 16；现行孤儿建议 16，仍由用户决定补链或废弃，不自动修。

### `jc-xiu-wiki`

- `replace`、`link`、`scaffold` 均支持 `--reason` 和 `--basis`，修前显示问题、依据和精确 diff/路径预览。
- 实际执行后输出 `[修复回执]`：受影响文件、修前/修后指纹，以及旧值剩余、链接存在或分类入口存在的验证结果。
- 语义冲突仍必须由用户确认；回执增强不扩大机械脚本的裁决权。

## 3. 验证证据

- Wiki Skill 专项：`python3 -m unittest discover -s public/skills/tests -p 'test_*.py'`，20/20 通过。
- Raw Wiki 专项：`python3 -m unittest public.skills.jc-raw-wiki.scripts.test_jc_raw_wiki_contract`，17/17 通过。
- 完整门禁：`pnpm run test:focused` 通过；Rust 394/394，1 条人工隔离测试忽略。
- 正式 Web 构建：`pnpm run build` 通过；TypeScript、Vite 构建、Skill 索引生成与 `audit:web-dist` 全部通过。
- 独立运行：把打包后的 Markdown parser 复制到没有 `node_modules` 的临时目录后，仍能由 Node 正确解析 Wiki 链接。

## 4. 已知边界

- 四个脚本是模型工具，不是 Web 页面直接执行能力；Web 创模式没有终端时，仍由模型使用可用项目工具完成等价读取与写入。
- `closeout` 不主动运行测试或构建，只核对模型提供的真实证据文件；模型仍负责判断证据是否覆盖目标平台。
- `jc-jian-wiki` 的孤儿页是建议，不自动删除。当前 16 个现行孤儿页面和 16 条归档卫生项仍保留。
- Desktop 正式安装包内的 Python/Node 工具可用性、Windows/Intel 路径与一次普通用户四 Skill 闭环尚未人工验收。

## 5. 下一次入口

1. 先读本文和 [[学习/Wiki-Skill改造规范]]。
2. 用真实普通用户项目跑一次“查询 -> 巡检 -> 修正 -> 收尾压缩”闭环。
3. 分别在正式 Desktop ARM、Intel、Windows 环境确认 Python/Node 命令可用；不可用时应由产品工具层提供运行时，不能把安装依赖推给普通用户。

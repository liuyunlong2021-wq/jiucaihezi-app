# 通用记忆工作台 Raw Wiki 精准沉淀 TDD

> 日期：2026-08-05
> 状态：已实施
> 范围：`public/skills/jc-raw-wiki/` 及引用其旧合同的产品 Skill、测试和 Wiki 文档

## 1. 根因

`jc-raw-wiki` 的唯一必要能力是把新产生的确认信息沉淀进已有 Wiki。当前实现却同时承担项目类型模板、内容填充、来源索引、双链、热缓存、Canvas、Bases、资料摄入、催化提取和开发收尾，并依赖 17 份 Reference、一个 219 行脚本和大量项目专属目录规则。

这与上一轮 Everything Wiki 的问题相同：预设模板代替了对现有 Wiki 和真实材料的判断。Obsidian 不规定知识库类型、目录模板或必读页面；韭菜盒子也不应要求 Raw Wiki 先识别小说、漫剧、开发等类型再写入。

## 2. 唯一职责

把用户明确指定范围内新增的、已经确认且后续会复用的信息，增量写入现有 Wiki，并让重要结论可回到真实来源。

Raw Wiki 不负责：

- 设计目录结构；缺少分类时交给 `jc-everything-wiki` 先规划。
- 查询回答、全库巡检或确定性改错；分别属于 `jc-cha-wiki`、`jc-jian-wiki`、`jc-xiu-wiki`。
- 自动生成 Canvas、Bases、关系图、统计表或行业模板。
- 扫描全部 `.raw/` 猜测哪些内容要写入。
- 运行开发测试、构建、Git 收尾或发布审计。

派生视图不因此消失：关系图和标准 `.canvas` 继续由 `jc-cha-wiki` 生成；普通统计也由查询 Skill 直接回答，用户要求保存时写成 Markdown 表格。当前 App 没有 `.base` 解析和显示能力，因此不新增 Bases Skill，也不生成无法在产品内使用的 `.base` 文件；以后先补产品能力，再扩展 `jc-cha-wiki`。

## 3. 输入边界

只有用户明确要求写入或更新 Wiki 时触发，例如“把本轮结论写入 Wiki”“用这几份文件更新知识库”。“我刚写完”“开发收尾”“续写前整理”本身不授权修改 Wiki。

来源范围按以下顺序确定：

1. 用户点名的文件、页面、URL 或对话范围。
2. 用户明确说“本轮”时，只使用当前对话中已确认的内容。
3. 范围不明确且不同选择会改变写入结果时，先问一个范围问题。

不得默认遍历全部 Raw、全部项目文件或历史对话。

## 4. 写入合同

1. 定位已有 `wiki/` 或 `docs/wiki/`，沿用其真实结构；不创建平行 Wiki，不读取固定必读页。
2. 读取指定来源、相关目标页、直接父目录 `_index.md` 和 `来源索引.md`。
3. 将候选信息分为新增、更新、冲突、重复和过程信息；只写新增或已确认更新。
4. 优先增量更新已有页面。现有分类明确但页面缺失时可创建最小页面，并补直接父目录 `_index.md`；缺少合适分类时先交给 Everything Wiki 规划。
5. 重要结论在 `来源索引.md` 登记真实来源和已处理范围；不复制原文、完整会话或附件内容。
6. 当前状态确实变化时才更新 `hot.md`；发生实际写入时才向 `log.md` 追加一条事实。不修改 CLAUDE 或其他特殊入口。
7. 写后重新读取受影响文件，报告实际写入、来源、冲突和未处理项。

已有事实与新来源冲突、无法判断正式稿、需要移动/合并/删除内容时停止并请用户决定。不得整篇覆盖已有正文，不得编造或把参考资料写成项目已确认事实。

## 5. Skill 包目标

### 保留

- `public/skills/jc-raw-wiki/SKILL.md`
- `jc-raw-wiki` 名称，避免破坏现有路由和用户习惯
- 增量写入、来源追溯、冲突停手、Raw 不移动不删除四个产品合同

### 移出产品包

- `references/项目语境/` 全部 8 个项目模板
- `references/能力标准/` 全部 9 个能力模板
- `scripts/digest_raw.py`
- `scripts/test_jc_raw_wiki_contract.py` 及其旧模板、旧脚本断言；新合同测试迁到公共测试目录

删除前逐字备份到：

`/Users/by3/Documents/jiucaihezi-legacy-local-artifacts/wiki-skills/jc-raw-wiki-2026-08-05/`

### 新 Skill 约束

- 只保留标准 frontmatter 的 `name`、`description`，触发语义全部写进 `description`。
- 整个包只包含 `SKILL.md`，正文不超过 50 行。
- 不出现项目类型表、行业目录、Canvas、Bases、`closeout`、内部工具动作或外部脚本出口。
- 只写模型不知道的产品合同，不解释 Markdown、Wiki、文件夹等常识。

## 6. 红灯测试

实施前先新增 `public/skills/tests/test_raw_wiki_precision.py`，让以下断言在旧实现上失败；旧专项测试随 `scripts/` 删除：

1. Skill 包最终只有 `SKILL.md`，且通过官方 `quick_validate.py`。
2. `SKILL.md` 不超过 50 行，frontmatter 无 `triggers`。
3. `description` 只命中明确的 Wiki 写入请求，不包含“我刚写完”“开发收尾”“续写前整理”“刷新热缓存”。
4. Skill 明确只读取用户指定来源或本轮已确认内容，禁止默认扫描全部 Raw 和历史对话。
5. Skill 沿用现有 Wiki 根目录和目录结构，不含小说、漫剧、广告、开发等类型路由或固定业务目录。
6. 增量写入不得整篇覆盖；重复内容不重复写；冲突必须停手。
7. 新页面只可进入已有明确分类，并更新直接父目录 `_index.md`；缺分类时交给 `jc-everything-wiki`。
8. 重要结论更新 `来源索引.md`；`hot.md` 条件更新；`log.md` 仅在实际写入后追加；不修改 CLAUDE。
9. `references/`、`scripts/` 不存在，Skill 索引只登记 `SKILL.md`。
10. `jc-jian-wiki`、`jc-xiu-wiki` 和现行 Wiki 文档不再引用已删除的 Raw Wiki Reference 或脚本。
11. `jc-cha-wiki` 继续拥有关系图和标准 `.canvas`；统计查询归它回答，`.base` 在 App 支持解析和显示前不得宣称支持。

## 7. 实施顺序

```text
备份当前 jc-raw-wiki
  -> 写红灯合同测试并确认失败
  -> 将 SKILL.md 重写为精准沉淀合同
  -> 删除 references/ 与 scripts/
  -> 修正 jc-jian-wiki、jc-xiu-wiki 和 Wiki 文档引用
  -> 重建 public/skills/index.json
  -> 运行 Skill 校验、Wiki 专项、focused、TypeScript 和 git diff --check
```

## 8. 完成标准

- 用户明确指定来源后，Raw Wiki 能按现有结构沉淀确认事实并保留来源。
- 未明确授权写入、来源范围不清或存在冲突时不会静默修改 Wiki。
- 旧项目类型模板、派生视图能力和开发收尾脚本不再随 App 分发。
- 既有 Wiki、Raw、用户正文和历史文件没有被迁移、删除或覆盖。
- 自动测试全部通过；至少用“当前对话沉淀”和“指定文档沉淀”各做一次独立前向测试。

## 9. 实施结果

- 旧包已逐字备份到 `/Users/by3/Documents/jiucaihezi-legacy-local-artifacts/wiki-skills/jc-raw-wiki-2026-08-05/`，`diff -qr` 一致。
- 新合同测试在旧实现上红灯 `5/5`，重写后绿灯 `5/5`；`jc-raw-wiki` 现只包含 19 行 `SKILL.md`。
- 旧 17 份 Reference、`digest_raw.py` 和旧专项测试已移出产品包；现有 Wiki、Raw 和用户正文未迁移、删除或覆盖。
- 关系图、标准 `.canvas` 和统计归 `jc-cha-wiki`；统计需保存时写 Markdown，`.base` 等 App 支持解析和显示后再实现。
- 自动验证：Wiki Skill `26/26`、单产品分离门禁 `11/11`、Skill Creator 校验、`pnpm run test:focused`、Rust `395 passed / 1 ignored`、TypeScript 均通过。
- “当前对话沉淀”和“指定文档沉淀”的独立模型前向检查通过；两者均为只读合同验证，没有改动项目 Wiki。

# 通用记忆工作台 Xiu Wiki 精准修正 TDD

> 日期：2026-08-05
> 状态：已实施（2026-08-05）
> 范围：`public/skills/jc-xiu-wiki/`、原生 Wiki `replace/link`、对应测试、新手指南和现行 Wiki 合同

## 1. 根因

`jc-xiu-wiki` 的唯一核心能力，是把已经确认正确答案的 Wiki 错误改到准确位置，并证明只改了预期内容。当前包却包含 51 行主 Skill、160 行重复 Reference、232 行 Python 修正器和 Python 缓存，还同时承担改错、扩目录、更新巡检报告和写日志。

这造成六个问题：

1. 目录规划和创建已经属于 `jc-everything-wiki`；Xiu 再维护“架构扩展”会让同一请求命中两个 Skill。
2. 当前个人创作 Reference 包含换皮、映射撞车、命运走向和伏笔等规则，不属于通用个人或企业知识库。
3. 原生 `replace` 不要求目标文件；缺少 `path` 时会对整个 Wiki 做全文替换，范围远大于一次确定性修正。
4. 原生 `replace` 在同一文件命中多处时全部替换，没有要求用户确认“全部命中都该改”，也没有展示行号或上下文。
5. 原生 `link` 只把裸 `[[链接]]` 追加到文末，既不能把错误链接改成正确目标，也没有说明这条关系属于哪段内容。
6. 当前流程默认修改巡检报告并追加 `log.md`。巡检报告是可重新生成的派生结果，普通错字或断链修复也不应制造额外日志噪音。

## 2. 对照结论

Obsidian 官方 Help 提交 `8a59e12f6bcffb487ae8d6a40773e41e9c6017bc` 表明：

- Wiki 页面是普通文件；用户可以直接编辑现有内容，不存在必须套用的自动修正 Schema。
- 重命名页面时，Obsidian 会更新指向该文件的内部链接；这是一项文件生命周期能力，不等于在正文末尾追加一个裸链接。
- 删除默认进入系统废纸篓或 Vault `.trash/`，File recovery 还提供页面快照；不可恢复删除必须显式选择。
- 官方不会自动裁决矛盾、删除孤儿页或合并重复页面。

`claude-obsidian/wiki-lint` 可借鉴“先展示问题再询问是否修复”和“矛盾、删除、合并必须人工判断”，但不照搬自动补 frontmatter、创建 stub、全库模式、固定报告和项目专属 Schema。

当前 App 已有跨平台 `move` 与 recoverable `delete` 文件工具，但移动/重命名不会同步更新 Wiki 内部链接。本轮不把它们包装成安全的 Xiu 能力；Obsidian 等价的“重命名并更新所有链接”应另写文件生命周期 TDD 后实施。

## 3. 唯一职责

把已有 Wiki 中一个已确认、边界明确的错误，精确改成用户或可靠证据已经给出的唯一正确内容，并复查结果。

Xiu Wiki 负责：

- 修正用户明确指出的错字、错误名称、错误值或错误 Wiki 链接。
- 执行 Jian 报告中已经给出唯一答案、且用户确认要修的条目。
- 对用户已经裁决的语义冲突执行不需要重新组织正文的精确修改。
- 先预览、经批准后写入，再读取目标文件验证结果。

Xiu Wiki 不负责：

- 查询事实、巡检问题、写入新知识或规划/创建目录；分别属于 Cha、Jian、Raw 和 Everything。
- 把“普通未解析链接”“孤儿候选”或“语义冲突”直接当成错误处理。
- 创作新段落、重组内容、迁移资料、更新项目状态或决定哪个事实正确。
- 自动改巡检报告、`log.md`、`hot.md`、`来源索引.md`、CLAUDE、Canvas 或 Bases。
- 自动移动、重命名、删除、合并页面或目录。

## 4. 触发与边界

当用户明确要求修复已有 Wiki 中已经确定正确答案的问题时触发，例如“把这个错字改掉”“把 `[[旧页面]]` 改成 `[[新页面]]`”“按我刚确认的答案修正这条”“执行报告里这条已确认修复”。

以下请求不应触发：查询 Wiki、更新知识库、巡检 Wiki、规划目录、新建分类、整理 Raw、移动/合并/删除页面。用户只说“执行巡检报告”时，先区分已确认修复项与候选/冲突；不得把整份报告直接批量套用。

同时存在 `wiki/` 与 `docs/wiki/` 时先请用户确认唯一知识库；不存在 Wiki 时停止，不替用户建库。

## 5. 精准修正合同

### 修前判断

1. 每项修正必须具备四个值：一个明确 Markdown 文件、精确旧内容、精确新内容、可追溯依据。
2. 依据可以是用户当前明确决定、Jian 的确定性问题项或用户指定的现行事实页；模型常识和候选建议不是修正依据。
3. 如果正确答案、目标文件或影响范围不唯一，停止并只问会改变修正结果的一个问题。
4. 需要创作或重组自然语言才能完成时交给 `jc-raw-wiki`；需要设计或创建目录时交给 `jc-everything-wiki`。

### 预览与执行

1. 原生 `wiki replace` 必须提供一个现有 Wiki 内 `.md` 文件的 `path`、`oldText`、`newText`、`reason` 和 `basis`；禁止省略 `path` 的全库替换。
2. 默认只允许旧内容在目标文件中出现一次。命中多处时列出行号并停止；只有用户明确确认目标文件内全部命中都要修改时，才传 `replaceAll: true`。
3. 单处文字、名称和值修正直接替换最小唯一文本；同文多处但只改一处时，扩大 `oldText` 到足以唯一定位的上下文块。
4. 错误 Wiki 链接使用精确替换，例如 `[[旧页面]]` 到 `[[新页面]]`；不把裸链接追加到文末。
5. 第一次调用只预览，不写盘；预览至少显示目标文件、命中行号、命中数、精确旧值和新值。用户批准后才使用 `apply: true`。
6. 一次原生修正只写一个文件。多文件修正逐文件预览和执行；任一项失败即停止，不继续制造部分完成状态。

### 修后验证

1. 写后重新读取同一文件，确认预期新值存在、目标旧值按合同消失，其他文件未被本次操作写入。
2. 回执包含目标文件、实际命中数、修前/修后短指纹和验证结果；没有回执不能宣称完成。
3. 不回写 Jian 派生报告。需要全局复检时交给 `jc-jian-wiki`，由 Jian 标明已解决、仍存在或新发现。
4. 默认不写 `log.md` 或 `hot.md`；只有用户明确要求留痕，或它们本身就是已确认的修正目标时，才作为另一项独立预览处理。

## 6. 原生修正最小调整

继续复用 Web/Desktop 共用的 `wiki replace`，不建设第二套修正服务。

实施时只修正：

- `replace` 强制要求单个 Wiki 内 Markdown `path`，删除无路径全库替换。
- 新增 `replaceAll`；单文件多命中且未显式开启时拒绝写入并返回真实行号。
- 预览输出目标文件、命中数、行号及精确旧值/新值；`apply: false` 保持零写入。
- 执行后重新读取目标文件并输出修前/修后指纹、旧值剩余和新值存在状态。
- 删除只会向文末追加裸链接的 `link` action、工具参数、审批分支和专项测试；断链修复统一走 scoped `replace`。
- 保留 `extend` 原生 action 供 `jc-everything-wiki` 在结构方案确认后使用，但 Xiu Skill 不再声明或触发它。

本轮不新增 rename/move/delete/merge、事务层、版本库或 File recovery。它们只有在产品具备自动更新内部链接和可恢复保障后，才能成为 Xiu 的正式能力。

## 7. Skill 包目标

### 保留

- `public/skills/jc-xiu-wiki/SKILL.md`
- `jc-xiu-wiki` 名称和“修复已确认 Wiki 错误”的触发语义
- 唯一依据、范围确认、先预览后批准、修后验证和跨 Skill 交接合同

### 移出产品包

- `references/能力标准/巡检修正规范.md`
- `references/能力标准/架构扩展规范.md`
- `scripts/apply_fix.py`
- `scripts/__pycache__/`

删除前完整备份到：

`/Users/by3/Documents/jiucaihezi-legacy-local-artifacts/wiki-skills/jc-xiu-wiki-2026-08-05/`

新包只包含标准 frontmatter 的 `name`、`description` 和不超过 50 行的 `SKILL.md`。新手指南把“给 Wiki 加分类”改由 Everything 负责，并删除“执行整份报告后自动打勾、更新 log”的表述。

历史日志和旧巡检报告中对 `apply_fix.py` 的真实记录保留，不能篡改历史证据。

## 8. 红灯测试

实施前新增 `public/skills/tests/test_xiu_wiki_precision.py`，并在旧实现上确认失败：

1. Skill 包最终只有 `SKILL.md`，通过 Skill Creator 校验，正文不超过 50 行，frontmatter 只有 `name`、`description`。
2. `description` 命中“已确认的 Wiki 精确修复、错字、错误链接、名称和值”，不命中普通查询、巡检、更新知识库、规划目录或新建分类。
3. Skill 明确“一个文件 + 唯一旧值 + 唯一新值 + 依据”，缺任一项或语义未裁决时停止。
4. Skill 不扫描 Raw、不创作新事实、不规划结构、不改派生报告、不默认更新 `log.md`/`hot.md`。
5. Skill 不含项目类型、换皮、映射、伏笔、Python、脚本或 Reference 出口。
6. 原生 `replace` 缺少 `path`、目标不在 Wiki、目标不是 Markdown、缺少 `reason/basis` 时拒绝。
7. 单一命中预览显示文件、行号、命中数、旧值和新值且零写入；批准后只改目标文件并输出验证回执。
8. 多处命中默认拒绝；`replaceAll: true` 才允许修改该文件内全部命中，仍不得扩大到其他文件。
9. 原生和工具合同不再暴露 `link`；`extend` 继续存在但由 Everything 合同与测试覆盖。
10. 新手指南将结构扩展归 Everything；`public/skills/index.json` 只登记 `SKILL.md`，产品代码不再引用已删除 Reference、Python 修正器或缓存。

## 9. 实施顺序

```text
备份当前 jc-xiu-wiki
  -> 写 Skill 与原生 replace 红灯测试并确认失败
  -> 将 SKILL.md 重写为单文件精准修正合同
  -> 删除 Reference、Python 修正器和缓存
  -> 收紧原生 replace 的 path、单命中、replaceAll、预览和回执
  -> 删除裸追加 link action；保留 Everything 使用的 extend
  -> 修正旧迁移测试、新手指南和现行 Wiki 引用
  -> 重建 public/skills/index.json
  -> 运行 Skill 校验、Wiki 专项、原生运行时、审批策略、分离门禁、focused、TypeScript 和 git diff --check
```

## 10. 完成标准

- 已确认的单处错字、名称、值和错误 Wiki 链接可以预览、批准、精确修正并验证。
- 无路径全库替换和未确认的单文件多处替换均被拒绝；候选、孤儿和语义冲突不会被自动处理。
- Xiu 不再与 Everything 的结构规划、Raw 的事实写入或 Jian 的巡检/复检重叠。
- 旧 Reference、Python 修正器和缓存不再随 App 分发；现有 Wiki、Raw、正文和历史报告未被删除或批量改写。
- 自动测试全部通过；“单处精确修复”“错误链接修复”“多命中拒绝”“语义冲突不裁决”四类独立模型前向检查作为发布前人工验收项。

## 11. 实施回执

- 已备份原包到 `/Users/by3/Documents/jiucaihezi-legacy-local-artifacts/wiki-skills/jc-xiu-wiki-2026-08-05/`，并确认备份与旧包一致。
- `jc-xiu-wiki` 已收缩为仅含 `SKILL.md` 的单文件 Skill；旧 Reference、Python 修正器和缓存不再随 App 分发。
- 原生 `wiki replace` 已强制单文件 Markdown 路径，默认单命中；预览显示行号，`replaceAll: true` 才能在同一文件执行多命中替换，写后重读并返回指纹。
- 原生 `link` 已从工具枚举、参数解析、审批策略和运行时移除；`extend` 保留给 `jc-everything-wiki`。
- 红灯测试先在旧实现失败，绿色验证已通过 Skill 契约 `34/34`、focused `980/980`、TypeScript、Rust `395 passed / 1 ignored` 和 `git diff --check`。

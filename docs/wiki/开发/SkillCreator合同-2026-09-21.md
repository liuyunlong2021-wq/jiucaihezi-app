# Skill Creator 合同（统一版）

> 日期：2026-09-21；2026-09-22 收回草稿写入职责
> 状态：**现行合同；Runtime 事务提交待实施**
> 性质：本文是 Skill 创建/修改能力的**唯一权威合同**。运行时文本仍以 `public/skills/skill-creator/SKILL.md` 为流程正文；本文是裁决记录与实现依据。
> 公共执行边界：[[通用记忆工作台任务事务Runtime合同-2026-09-22]]

## 0. 为什么要统一

同一套合同现在散落在 **5 处**，彼此矛盾，模型在一个会话里会同时收到互相冲突的指令：

| # | 位置 | 现在说的 | 问题 |
| --- | --- | --- | --- |
| 1 | `public/skills/skill-creator/SKILL.md` | 流程正文 + 「全程携带 `draft_id/revision/content_hash`」 | 三件套与流程闸门要被取代 |
| 2 | `skillConnectionAdapter.ts` → `SKILL_CREATOR_RUNTIME_APPENDIX` | **第二份完整流程**（步骤 1–8），且自称「优先于上文」 | 与 SKILL.md 双重描述，措辞不同 |
| 3 | 同文件 → `SKILL_BUILDER_RUNTIME_APPENDIX_BASE` / `_WITH_ADVANCED_RUNTIME` | **第三条闭环**（素材转 Skill），以 `draft_id` 为中心 | 三件套要被路径取代 |
| 4 | `skillUtils/skillTestRunner.ts` 的 tool schema | **第三遍**描述「必须原样携带」三件套 | 参数形状应只由 schema 描述一次 |
| 5 | `开发/通用记忆工作台Skill Creator七项能力适配方案-2026-09-06.md` §2/§3.1 | 明文规定草稿在**系统临时目录**，以 `(session_id, draft_id)` 隔离 | 本次唯一变更点 |

第 2 处里有个被忽略的事实：它**已经允许**「用户给绝对路径时，直接用 `read`/`write`/`edit` 读写该 Skill 目录」。也就是说**文件树路线本来就在合同里**，是内存状态机在同一份合同里跟它打架。

## 1. 所有权与边界（不变）

- 安装目标唯一：中央 Skill 根目录 `~/.agents/skills/<skill-id>/`。
- 模型、普通文件工具、项目文件树**不得直接写**中央 Skill 根目录。
- 安装**只能由用户点击安装卡触发**，且必须经过 Tauri/Rust 专用命令；Web 继续使用浏览器存储，不伪造 Desktop 落盘。
- `triggers` 是韭菜盒子的手动搜索与筛选扩展，不承担自动模型触发。
- 测试可选；用户未要求测试时，允许在结构校验与用户确认后直接安装。
- 测试、评分、分析使用应用当前选择的 provider/model，不硬编码模型品牌。

## 2. 草稿：文件树是真源，Runtime 是唯一写入者

**落点**：项目文件树 `.raw/jc-media/文档/skill-<target-skill-id>/`

```text
.raw/jc-media/文档/skill-jc-minimax-fenjing/
├── SKILL.md
├── references/
├── scripts/
├── assets/
└── iteration-1/          # 测试与评审产物（可选）
```

**规则**

- 模型负责生成完整新正文或唯一章节替换提案，**不再负责调用 `write_text_batch` / `write` / `edit` 写草稿**。
- Runtime 复用 `ProjectFileService` 的修订与批处理能力写入，写后立即读回，校验内容、结构、替换次数和当次任务断言。
- **路径就是身份**。文件在不在、内容是什么，一查便知，不需要模型复述任何不透明标识。
- **不再有** `draft_id` / `revision` / `content_hash` 三件套；**不再有**内存状态机。
- 草稿目录不是安装目录；包路径只允许 `SKILL.md`、`references/`、`scripts/`、`assets/` 和经确认保留的扩展目录。
- 测试与评审产物落草稿目录下的 `iteration-N/`，与草稿同级可见。
- 安装成功后**删除**草稿目录（避免文件树堆积、避免下次误读旧草稿）。
- 写入、读回、验证和冻结是一条 Runtime 事务；未读回验证的版本不得出安装卡。

**为什么这条是根治**：文件是可观测的真源，而执行状态归 Runtime。模型只要产出合格提案，后续写入、验证和出卡不再受工具轮数、上下文压缩或最终空正文影响。

## 3. 工具面

| 工具 | 处置 |
| --- | --- |
| `skill_creator_load_installed_skill` | **保留**。已安装 Skill 在 `~/.agents/skills`，在项目树外，这个工具值得留 |
| Skill 草稿提交 | **改为 Runtime 能力**。模型只提交完整文件或章节替换意图；Runtime 负责乐观锁写入与读回验证 |
| `skill_creator_validate` | **保留为纯函数式结构校验**：入参 `draft_path`，出参校验结论。不写任何状态 |
| `run_skill_tests` | 保留（可选），入参改 `draft_path` |
| `skill_creator_open_eval_review`、`submit_eval_feedback`、`load_eval_feedback`、`compare_outputs`、`analyze_comparison` | 保留，入参改 `draft_path` |
| `skill_creator_improve_description` | 保留生成语义，但产出的新正文由 Runtime 立即写回并验证，不再让模型转调写工具 |
| `skill_creator_package` | 保留，只读取已验证的 `draft_path` 版本 |
| `save_skill` | 保留出卡语义，入参 `draft_path` + `target_skill_id`；只能冻结 Runtime 已验证的版本 |
| `build_skill_from_text`、`compile_skill_materials`、`local_extract_attachment`、`document_to_markdown` | 保留（素材转 Skill 线），产出的草稿同样落文件树 |
| `skillCreatorRuntime` 状态机 | **删除** |
| `skillBuilderRuntime` 状态机 | **删除** |
| 三件套标识 | **从工具协议删除** |

参数形状**只由 tool schema 定义一次**；SKILL.md 不再重复描述。模型发出的提交调用只表示变更意图；执行、验证和成功状态全部由 Runtime 回执决定。

## 4. 安装卡：出卡即冻结

```json
{"schemaVersion":2,"draftId":"draft_xxx","sessionId":"...","revision":1,"contentHash":"...","targetSkillId":"jc-minimax-fenjing"}
```

- **出卡时** Runtime 只接受已写入、读回且通过结构/任务断言的草稿版本，然后**冻结成一份受控快照**（现有草稿库，临时目录 + 哈希），卡里带快照的 `draftId` 与 `contentHash`。
- **点击时**Rust 读快照、重算哈希、比对；不一致 → 拒绝安装。保留「出卡后被改过就不给装」这道保护，而卡里的内容与用户看到的那一版完全一致。
- **安装目标与授权不变**：Rust 只认快照，模型给的路径永远不会被当成安装来源。
- **零新增通道**：现有 V2 卡、现有 Rust 命令、现有安装卡 UI 全部照用，不需要新的 schemaVersion 或新的解析分支。

把合同草稿从 V3 卡改成「出卡即冻结」的原因：V3 要求 Rust 新增一个「从项目文件树读目录并校验哈希」的命令，卷轴又要新增一个 `jc-skill-install-v3` 的解析与渲染分支；而出卡冻结用现有通道就能拿到**同样的保证**（冻结不可变、点击时校验、模型无法指定安装来源）。

## 5. 合同的唯一来源

| 内容 | 唯一来源 |
| --- | --- |
| 流程正文（步骤、话术、安装卡格式） | `public/skills/skill-creator/SKILL.md` |
| 宿主差异（不能调 Claude/Codex 专属工具、路径权限规则、受限脚本执行） | `skillConnectionAdapter.ts` 附录，**只保留宿主差异，不再复述流程** |
| 参数形状 | tool schema |
| Skill Creator 设计裁决 | 本文 |
| 写入、读回、验证、恢复与程序收尾 | [[通用记忆工作台任务事务Runtime合同-2026-09-22]] |

## 6. 实施顺序与验收

| 步 | 动作 | 验收 |
| --- | --- | --- |
| 0 | 冻结本文 | 本文提交 |
| 1 | 为 Skill 修改增加 Runtime 草稿提交口 | 模型提交完整文件或章节替换意图；Runtime 通过现有 `ProjectFileService` 写入并读回 |
| 2 | 让校验、打包和 `save_skill` 只消费已验证版本 | 内容不一致或任务断言不通过时不冻结、不出卡 |
| 3 | 写入验证成功后由 Runtime 直接返回回执和安装卡 | 不发起额外模型收尾请求；模型空正文不影响已完成结果 |
| 4 | 改写 Skill Creator `SKILL.md` 与宿主附录 | 模型不再收到“把正文用文件工具写回”的要求 |

## 7. 状态机删掉之后，原先由它把守的规则去了哪

状态机不只是身份校验，它还拦过两件事。删除后这两条从「宿主强拦」变成「契约约定」：

| 原先的强拦 | 现在 |
| --- | --- |
| 不能安装未校验的草稿 | **仍然把守**：Runtime 写后读回并验证当次任务断言；`save_skill` 内部再跑 `validateSkillDraft`，两关都通过才能冻结 |
| 测过之后必须先开评审才能出卡 | **不再强拦**，写在 SKILL.md 流程里由模型遵循 |
| 素材转Skill 保存前至少 3 个测试用例 | **不再强拦**，同样写在流程里（且该线不可达，见下） |

判定标准：能装不能装是数据完整性问题，必须把守；「有没有先看看评审再保存」是体验问题，不值得用宿主状态去强拦 —— 上一版正是在这里制造了死锁。

### 素材转Skill 线当前不可达

`build_skill_from_text` / `compile_skill_materials` / `local_extract_attachment` / `document_to_markdown` 这一线靠 `agentId` 为 `skill-builder` / `preset_skill-builder` 触发，但 `public/skills/index.json` 只有 `jc-new-user-guide` / `jc-watch` / `skill-creator` / `wiki-memory` 四个预设，**没有 skill-builder**。所以这一线目前没有入口。

本次只删了它的状态机，没把它迁到文件树（合同 §3 写的是「产出的草稿同样落文件树」）。迁还是删，待定。

## 8. 明确不做

- 不建设第二套 Skill 管理器；复用现有扫描与安装卡。
- 不增加 `should_trigger` / 训练集 / 自动 description 搜索循环。
- 不模拟 Claude 的 `available_skills`、`.claude/commands` 或 `claude -p`。
- 不改「用户手动选择 Skill」这条产品前提。

## 修订记录
- 2026-09-22：用户确认把「写草稿、读回验证、冻结出卡」从模型收回 Runtime；Skill Creator 成为任务事务 Runtime 的第一个适配器。
- 2026-09-21（实施完成）：第 3 步与第 5 步已落地 —— 草稿按 `draft_path` 读写（11 个工具的 schema 只剩一个路径参数，旧的 `draft_id`/`revision`/`content_hash`/`skill_md`/`draft_skill_md`/`references`/`manifest` 全部退出协议）；两个状态机及其测试删除（-892 行）；原先被状态机把守的三条规则改由 §7 接管。
- 2026-09-21（实施中修订）：第 3 步落地时把「安装卡 V3」改成「出卡即冻结」——参考 §4 的说明。零 Rust 改动、零 UI 改动就拿到了同样的保证。
- 2026-09-21：制定。把散在 5 处的合同收敛为一份；草稿从系统临时目录改到项目文件树；三件套与内存状态机退出合同；安装卡升级为引用草稿路径的 V3 并保留出卡后防篡改校验。

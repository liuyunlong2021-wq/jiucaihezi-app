# 知识库内循环 v3.1 — 设计文档

> **v3.1 由 Claude 接手裁决**（2026-07-01）。在 DeepSeek 的 v3 基础上，回到源头 [Karpathy 的 LLM Wiki 模式](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 和 [nashsu/llm_wiki](https://github.com/nashsu/llm_wiki) 校准，修正三处偏差。
> **v3 原件保留**：`knowledge-base-inner-loop-v3.md`（DeepSeek 版，作对照）。

---

## 0. 这套系统要解决什么（创始人的目标）

**打造一个不会丢失上下文、方便大模型检索的持久化创作系统，服务于创作 skill。**

大模型有上下文窗口限制，写长篇小说/剧本时写着写着就忘了前面的角色设定、悬念、世界观。解法不是"每次把全书塞进 prompt"（塞不下），而是——

```
创作 skill 产出内容 → 压缩进 wiki/ 结构化检索空间 → 下次续写精准召回 → 不失忆
```

---

## 1. 理论根：Karpathy 的 LLM Wiki 模式

参考项目 llm_wiki 是 Karpathy 这个模式的完整桌面实现。它的内核一句话：

> **wiki 是一个持续累积的产物。知识编译一次、之后只做维护，而不是每次查询都从头检索（RAG）。**

传统 RAG：每次提问都从原始文档里重新捞碎片、重新拼答案，什么都不沉淀。
本模式：LLM 把新素材**读进来、提炼、整合进已有 wiki**——更新条目、修订摘要、标记矛盾、加强交叉引用。知识被编译一次后保持更新。

**人负责策展、探索、提好问题；LLM 负责所有苦力**——总结、交叉引用、归档、记账。这正是"不失忆"的本质：不失忆 = LLM 帮你把该记的都记进结构，并保持它是最新的。

### Karpathy 原版的三层 + 三操作（我们必须忠实的骨架）

| 层 | 原版 | 我们的落地 |
|----|------|-----------|
| Raw sources（不可变，只读） | 原始素材 | `.raw/` |
| Wiki（LLM 拥有，读写归档） | LLM 生成的结构化 md | `wiki/` |
| Schema（配置，人和 LLM 共同演化） | CLAUDE.md / AGENTS.md | `CLAUDE.md` |

| 操作 | 原版 | 我们的落地 |
|------|------|-----------|
| Ingest（写入 + 更新索引 + 追加日志） | 读源→写条目→更新 index→追加 log | 创作 skill 写 `wiki/`，追加 `log.md`，jiyiyasuo 刷 `index.md`/`hot.md` |
| Query（召回） | 读 index→drill 相关页 | 续写前读 `CLAUDE.md`/`hot.md`→召回相关档案 |
| Lint（体检） | 查矛盾/断链/孤儿/伏笔 | JC-yizhixing 巡检 |

---

## 2. 对 DeepSeek v3 的三处裁决

### 裁决一：加回 `log.md`（v3 把它丢了）

Karpathy 原版有两个导航文件，v3 只保留了 `index.md`，漏掉了 `log.md`。这是最可惜的遗漏——`log.md` 是最便宜、最可靠的防失忆手段。

- `index.md` = **内容目录**（有哪些条目，各是什么）。jiyiyasuo 维护。
- `log.md` = **时间线**（先后发生了什么）。追加式，永不重写。**每条用固定前缀**：

```markdown
## [2026-07-01] 写作 | 第5集：林风觉醒
## [2026-07-01] 巡检 | 发现苏婉压力值未更新
## [2026-07-02] 压缩 | 归档 .raw/ 3 个素材，刷新 hot.md
```

固定前缀让大模型（和你）能用一行命令秒查最近动向：

```bash
grep "^## \[" wiki/log.md | tail -5   # 最近 5 条发生了什么
```

`hot.md`（续写小抄，v3 新增）和 `log.md`（时间线，原版有）分工不同，都保留：
- `hot.md` — 当前状态快照，续写前召回用（主角当前状态、活跃伏笔、下一集承接钩子）。
- `log.md` — 历史流水账，追溯"第几集干过什么"用。

### 裁决二：一键建库"保留但收窄"（v3 要全砍，太激进）

Karpathy 说目录结构应由"你和 LLM 共同演化"，这支持**创作类**项目由 skill 按需自建目录，不必强制先建库。但项目里 `vaultTemplates.ts` 还有**律师案件知识库**这类结构化模板，一键建库对它们仍有价值。

裁决：
- **创作 skill 自建目录**——用户选个空文件夹，发指令，skill 自己 `mkdir` 出 `.raw/` `wiki/作品/` 等，不再要求"前置先一键建库"。
- **一键建库保留**——服务律师案件库这类结构化项目模板，不动。
- 要改的只是 `kbCommandPresets.ts` 里几条写着"前置：先一键建库"的临摹指令。

### 裁决三：真正的病根是"说了没做"，不是设计

v3 交接文档声称四个创作 skill 已对齐 `wiki/`，实际核查（2026-07-01）发现只有一个真的对齐了。巡检官 yizhixing 和压缩官 jiyiyasuo 都在规范地读写 `wiki/`，但它们期待的目录，四个创作 skill 里有一半根本不产出——内循环因此空转。**v3.1 的主要工作就是把落地做实。**

核查结论（真实现状，非交接文档所述）：

| 创作 skill | 交接文档声称 | 实际 | v3.1 动作 |
|-----------|:-----------:|------|----------|
| JC-duanju-shijiemoxing | 已对齐 | ✅ 真的对齐 `wiki/` | 仅补 log.md |
| JC-manjuxiezuo | 已重写 | ❌ 仍用 `角色档案/世界设定/剧情管理/` | 迁到 `wiki/` + CLAUDE.md 区块 |
| JC-linmoxiaoshuo | 待改 | ⚠️ 用 `换皮工程/` | 迁到 `wiki/映射表.md` `wiki/改写稿/` |
| JC-linmoduanju | 待改 | ⚠️ 用 `换皮工程/` `剧本正文/` | 迁到 `wiki/` |
| novel-writing | 待改 | ⚠️ 含糊的"Vault" | 明确成 `wiki/` |

---

## 3. 目录结构（v3.1 定稿）

```
项目根/
├── .raw/                    ← 原始素材（不可变，只读）。用户扔进来的范本/录音/截图/对话记录
│   └── 范本/                ← 临摹类 skill 的参考源
├── wiki/                    ← ★ LLM 检索主目录（Obsidian 可打开，主要服务大模型）
│   ├── 作品/                ← 从零创作产出（duanju-shijiemoxing / novel-writing / manjuxiezuo）
│   │   └── 第X集.md
│   ├── 改写稿/              ← 临摹换皮产出（linmoduanju / linmoxiaoshuo）
│   │   └── 第X集.md
│   ├── 角色/                ← 角色档案
│   │   └── 角色名.md
│   ├── 世界观/              ← 世界设定/关系网/势力
│   ├── 悬疑管理/            ← 悬念账本/伏笔账本/历史记录
│   ├── 映射表.md            ← 临摹类维护（范本名→新名，全篇一致的事实源）
│   ├── 巡检报告/            ← JC-yizhixing 产出（每次一份）
│   │   └── 2026-07-01.md
│   ├── log.md               ← ★ 时间线，追加式，固定前缀可 grep（Karpathy 原版）
│   ├── hot.md               ← ★ 续写小抄，当前状态快照（jiyiyasuo 刷新）
│   └── index.md             ← ★ 内容目录（jiyiyasuo 刷新）
└── CLAUDE.md                ← ★ Schema/记忆锚点，各 skill 各写自己的区块
```

---

## 4. 谁读谁写（对齐后的权责）

| Skill | 类型 | 产出路径 | 读 | 追加 log.md |
|-------|------|---------|----|:----------:|
| JC-duanju-shijiemoxing | 从零短剧 | `wiki/作品/` `wiki/角色/` `wiki/世界观/` `wiki/悬疑管理/` | CLAUDE.md 自区块 | ✅ 写作 |
| JC-manjuxiezuo | 梗概逐集成稿 | `wiki/作品/` `wiki/角色/` `wiki/悬疑管理/` | 全剧梗概 + CLAUDE.md | ✅ 写作 |
| novel-writing | 从零小说 | `wiki/作品/` `wiki/角色/` `wiki/世界观/` | CLAUDE.md 自区块 | ✅ 写作 |
| JC-linmoduanju | 短剧换皮 | `wiki/改写稿/` `wiki/映射表.md` | `.raw/范本/` + 映射表 | ✅ 写作 |
| JC-linmoxiaoshuo | 小说换皮 | `wiki/改写稿/` `wiki/映射表.md` | `.raw/范本/` + 映射表 | ✅ 写作 |
| JC-yizhixing | 巡检（只读挑错） | `wiki/巡检报告/` | 整个 `wiki/` | ✅ 巡检 |
| JC-jiyiyasuo | 压缩（归档养库） | `wiki/`（归档）+ `hot.md` `index.md` | `.raw/` + 整个 `wiki/` | ✅ 压缩 |

**CLAUDE.md 三段式**（各 skill 只改自己的区块，互不覆盖）：

```markdown
# 短剧：《重生之异能觉醒》

## [创作] JC-duanju-shijiemoxing
- 最新: [[wiki/作品/第5集]]（2026-07-01）
- 主角: [[wiki/角色/林风]]（压力值:65）
- 悬念: [[wiki/悬疑管理/悬念账本]]（已埋5, 待收3）

## JC-yizhixing
- 最近巡检: [[wiki/巡检报告/2026-07-01]] · 结果 ❌0 🔻0 ⚠️1

## JC-jiyiyasuo
- hot.md 刷新: 2026-07-01 · index.md 条目:15 · .raw/ 待处理:3
```

---

## 5. 协作流程

```
1. 创作 skill 写一集 → wiki/作品/第X集.md → 追加 log.md → 更新 CLAUDE.md 自区块
2. 写完 3-5 集 → JC-yizhixing 巡检 → wiki/巡检报告/ → 追加 log.md
   ├─ 有问题 → 创作 skill 修 → 再巡
   └─ 没问题 → 继续
3. 素材堆多了/续写前 → JC-jiyiyasuo 归档 .raw/ → 刷新 hot.md/index.md → 追加 log.md
```

---

## 6. 参考

- [Karpathy — LLM Wiki 模式](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — 理论根，三层三操作
- [nashsu/llm_wiki](https://github.com/nashsu/llm_wiki) — 该模式的完整桌面实现（含知识图谱、Lint、index.md/log.md）
- [Obsidian](https://obsidian.md) — 可选可视化浏览
- `knowledge-base-inner-loop-v3.md` — DeepSeek v3 原件（对照）

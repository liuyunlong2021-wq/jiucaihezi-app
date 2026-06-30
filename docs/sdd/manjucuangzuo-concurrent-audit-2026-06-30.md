# manjucuangzuo 并发审计 — 2026-06-30

三份独立审计报告合并：TDD合规性、Bug/回归风险、架构清理。

---

## 审计 1: TDD 合规性 (Agent A)

**总评: 52% — PARTIAL IMPLEMENTATION**

- Phase 1-2 (Backend): 85% ✅
- Phase 3 (Frontend): 15% ❌ — 仅删了 SKILL_PRESETS，5个消费者未迁移
- Phase 4 (Cleanup): UNVERIFIED

### 🔴 关键缺失

| # | 问题 | 严重度 |
|---|------|:--:|
| D1 | seed_preset_skills 用 INSERT OR IGNORE，scan 会覆盖 source='builtin' | HIGH |
| D2 | upsert_skill 在 is_central=1 时覆盖 source | HIGH |
| D5 | 5个 skill:// 消费者全部未迁移 | HIGH |
| D6 | SkillCard.vue 仍用 skillCommands.json，不用 skill.commands | HIGH |
| D4 | getPresetSkills 未删除（改为过滤） | MEDIUM |
| D7 | index.json commands 格式与 TDD 不一致 | MEDIUM |

---

## 审计 2: Bug/回归风险 (Agent B)

### 竞态条件

| # | 问题 | 严重度 |
|---|------|:--:|
| RR-1 | lib.rs spawn seed + scan_all_skills 并发跑 seed → 两个 rename 冲突 | 🟡 |
| RR-2 | scan_all_skills_impl 无并发锁 → 两次扫描并行可能互相删除 | 🟡 |
| RR-3 | seed 写 source='builtin' → scan 用 link_type 覆盖 → 内置skill从预设消失 | 🟡 |
| RR-4 | 崩溃恢复：种子中途崩溃留下不完整目录 → 永远不修复 | 🟡 |

### 边界情况

| # | 问题 | 严重度 |
|---|------|:--:|
| BE-1 | frontmatter 无 name 字段 → 降级为目录名但不记录 warning | 🟢 |
| BE-2 | ```commands 无闭合 ``` → 返回空 vec（静默） | 🟢 |
| BE-3 | agent目录不存在 → builtin_agents中路径静默跳过 | 🟢 |
| BE-4 | SKILL.md 编码非 UTF-8 → read_to_string 失败 → 降级 | 🟢 |

---

## 审计 3: 架构清理 (Agent C)

### 死代码（约 25 个文件可删除）

| 类别 | 文件 | 影响 |
|------|------|------|
| 4个死亡面板 | PlatformPanel, MarketplacePanel, DiscoverPanel, CollectionsPanel + 子组件 | ~20 文件 |
| 死亡数据 | superpowerSkills.ts, officialSources.ts | 2 文件 |
| 死亡工具 | platformSkillViewModel.ts, marketplaceViewModel.ts, discoverViewModel.ts, collectionsViewModel.ts | 4 文件 |
| 死亡测试 | 4 个 viewModel 测试文件 | 4 文件 |
| zombie常量 | SKILL_ID_PATTERN, MAX_SKILL_SIZE, _skillContentCache | agentStore.ts |
| zombie导出 | PRESETS, SUPERPOWER_SKILLS import | agentStore.ts |
| 旧Vault引用 | obsidianVaults, loadObsidianVaults 等 | skillsManageStore.ts |

### 重复代码

| 重复 | 位置 |
|------|------|
| resolveSkillUriContent 重复3份 | agentStore.ts, chatCloud.ts, useChat.ts |
| 加载内容双路径 | skillContent字段 vs read_skill_content invoke |

---

## 汇总优先级

### 🔴 P0 — 阻塞（必须先修）

1. **D1+D2+RR-3**: source 字段被 scan 覆盖 → 修 upsert_skill CASE 逻辑 + seed 用 ON CONFLICT UPDATE
2. **D5**: 迁移 5 个 skill:// 消费者（useChat.ts, chatCloud.ts, ChatPanel.vue, agentRuntime.ts, skillConnectionAdapter.ts）
3. **D6**: SkillCard.vue 改用 skill.commands 而非 skillCommands.json

### 🟡 P1 — 重要（本次修）

4. **RR-1**: scan_all_skills 加并发锁（AtomicBool）
5. **RR-4**: 崩溃恢复哨兵文件
6. **D7**: index.json commands 格式对齐
7. **死代码清理**: 删 ~25 个文件 + zombie 常量/导出
8. **重复消除**: 合并 resolveSkillUriContent 到共享模块

### 🟢 P2 — 优化（后续）

9. 组件合并（4→1详情弹窗等）
10. 旧Vault引用清理
11. skillContent 统一加载路径

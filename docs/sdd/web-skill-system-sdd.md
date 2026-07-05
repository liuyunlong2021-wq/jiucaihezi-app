# Web 端 Skill 系统 SDD

> **状态**: 已审计，待实施
> **日期**: 2026-07-05
> **分支**: 0705-xiu
> **原则**: 只影响 Web 端，不动桌面 APP 一行代码

---

## 一、目标

Web 端用户能像桌面端一样：
1. 在 Skill 选择器（SkillPickerBar）下拉列表里选 Skill 使用
2. 在 Skill 仓库面板里浏览/创建/编辑/删除 Skill
3. 用 JC-taijianskill-creator 一键生成纯文本 Skill

---

## 二、端隔离保证

### 桌面端 — 零改动

| 数据路径 | 保持不变 |
|---------|---------|
| Skill 来源 | `centralSkillCache`（Tauri `scan_all_skills`） |
| Skill 管理 | `CentralSkillsPanel.vue`（14 个组件） |
| 安装方式 | `git clone` 到 `~/.agents/skills/` |
| Skill 注入 | OpenCode Agent 调用 `buildFixedSkillSystemInstruction` |

### Web 端 — 新增独立路径

```
┌──────────────────────────────────────────────┐
│                  Web 端 Skill 系统            │
│                                              │
│  数据层                                       │
│  ├── public/skills/*/SKILL.md  ← 内置 Skill   │
│  └── localStorage  ← 用户自建 Skill           │
│                                              │
│  运行时                                       │
│  ├── 启动时 fetch 内置 Skill → inMemorySkills  │
│  └── 用户创建/编辑 → localStorage 持久化       │
│                                              │
│  UI 层                                       │
│  ├── SkillPickerBar  ← 不改，数据到位即用      │
│  └── WebSkillPanel   ← 新建，Web 版 Skill 管理 │
└──────────────────────────────────────────────┘
```

### 隔离机制

```typescript
// agentStore.ts 所有操作已有分支判断：
function loadSkills() {
  if (isTauriRuntime()) { /* 桌面端路径，不动 */ }
  return inMemorySkills.value  // Web 端走这里
}

// 新增的 Web 启动加载：
// 只在 !isTauriRuntime() 时执行
// 桌面端完全不受影响
```

---

## 三、Phase 1 — 内置 Skill 数据管道

### 3.1 新建 `public/skills/` 目录

```
public/
├── skills/
│   ├── JC-taijianskill-creator/
│   │   └── SKILL.md          ← 从 GitHub 仓库同步
│   ├── JC-meitichuangzuo/
│   │   └── SKILL.md          ← 现有
│   └── JC-360huanjing/
│       └── SKILL.md
└── ...
```

部署时随 `pnpm build` → `dist/skills/` → Cloudflare Pages。

### 3.2 SKILL.md 格式

标准 Anthropic Skill 格式，纯文本（无 scripts/）：

```markdown
---
name: JC-taijianskill-creator
description: 创建纯文本 Skill 的 Skill。引导用户描述需求，输出标准 SKILL.md
---

你是一个 Skill 创建专家。你的唯一职责是帮用户创建纯文本 Skill。
...
```

### 3.3 启动加载逻辑

在 `agentStore.ts` 或 `main.ts` 的 Web 分支中新增：

```typescript
// Web 端启动时加载内置 Skill
async function bootstrapWebSkills() {
  if (isTauriRuntime()) return  // 桌面端跳过
  
  const skillDirs = ['JC-taijianskill-creator', 'JC-meitichuangzuo', 'JC-360huanjing']
  const skills: SkillConfig[] = []
  
  for (const dir of skillDirs) {
    try {
      const resp = await fetch(`/skills/${dir}/SKILL.md`)
      if (!resp.ok) continue
      const markdown = await resp.text()
      const parsed = parseSkillMd(markdown)
      skills.push({
        ...parsed,
        id: dir,
        source: 'builtin',
        skillContent: markdown,  // 直接存全文，避免二次 fetch（skill:// URI 需要 /SKILL.md 后缀否则路径不对）
      })
    } catch { /* skip missing */ }
  }
  
  // 合并已有的用户 Skill（从 localStorage 恢复）
  const stored = loadWebSkillsFromStorage()
  inMemorySkills.value = [...skills, ...stored]
}
```

### 3.4 数据流

```
用户刷新页面
  → main.ts initBackend()
  → isTauriRuntime() === false
  → bootstrapWebSkills()
  → fetch /skills/JC-taijianskill-creator/SKILL.md
  → parseSkillMd() → inMemorySkills
  → SkillPickerBar 自动响应式更新
```

---

## 四、Phase 2 — Web 版 Skill 管理面板

### 4.1 入口

`WorkspaceLayout.vue` 当前：

```typescript
const WEB_UNSUPPORTED_PANELS = new Set(['skills', 'tools', 'files', 'review', 'context'])
```

改为：

```typescript
// skills 面板在 Web 端用 WebSkillPanel 替代 CentralSkillsPanel
const WEB_UNSUPPORTED_PANELS = new Set(['tools', 'files', 'review', 'context'])
```

在面板渲染处，Web 端加载 `WebSkillPanel` 而非 `CentralSkillsPanel`：

```vue
<CentralSkillsPanel v-if="activePanel === 'skills' && !isTauriRuntime()" />
<!-- 改为 -->
<WebSkillPanel v-if="activePanel === 'skills' && isWebRuntime" />
<CentralSkillsPanel v-if="activePanel === 'skills' && isTauriRuntime()" />
```

### 4.2 WebSkillPanel 组件设计

**新建文件**: `src/components/skills/WebSkillPanel.vue`

**功能清单**：

| 功能 | 实现方式 |
|------|---------|
| Skill 列表 | 读取 `inMemorySkills`，卡片展示 |
| 搜索/筛选 | 本地 `computed` 过滤 |
| 查看详情 | 展开/弹窗显示完整 SKILL.md |
| 新建 Skill | 表单（name + description + markdown） |
| 编辑 Skill | 同新建，预填数据 |
| 删除 Skill | `confirmAction` → `inMemorySkills` splice → localStorage 同步 |
| 一键创建 | 选 JC-taijianskill-creator → 跳转对话区 → 用户描述需求 → AI 生成 SKILL.md → 自动保存 |

**不需要的功能**（桌面端专属）：

| 功能 | 原因 |
|------|------|
| `git clone` 安装 | Web 无 shell |
| 文件系统扫描 | Web 无 fs |
| GitHub 导入 | Phase 3 |
| Agent 关联 | Web 无 OpenCode Agent |

### 4.3 localStorage 持久化

```typescript
const WEB_SKILLS_KEY = 'jc_web_skills_v1'

function persistWebSkills(skills: SkillConfig[]) {
  const userSkills = skills.filter(s => s.source !== 'builtin')
  localStorage.setItem(WEB_SKILLS_KEY, JSON.stringify(userSkills))
}

function loadWebSkillsFromStorage(): SkillConfig[] {
  try {
    const raw = localStorage.getItem(WEB_SKILLS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}
```

每次 `inMemorySkills` 变更时自动 `persistWebSkills()`。

### 4.4 JC-taijianskill-creator 工作流

```
用户点击「新建 Skill」
  → 选择「用 AI 创建」
  → 自动切换到对话区
  → 自动选中 JC-taijianskill-creator
  → 用户描述需求："我要一个帮小红书写爆款文案的助手"
  → AI 生成标准 SKILL.md
  → 用户确认 → 保存到 inMemorySkills + localStorage
  → SkillPickerBar 立即可用
```

### 4.5 UI 布局

```
┌─ WebSkillPanel ──────────────────────────┐
│  🔍 搜索...              [+ 新建 Skill]  │
│                                           │
│  ┌─────────────┐ ┌─────────────┐         │
│  │ 📦 taijian- │ │ 🎨 meiti-   │         │
│  │   creator   │ │   chuangzuo │         │
│  │   内置       │ │   内置       │         │
│  └─────────────┘ └─────────────┘         │
│  ┌─────────────┐ ┌─────────────┐         │
│  │ ✏️ 小红书    │ │             │         │
│  │   爆款文案   │ │             │         │
│  │   用户创建   │ │             │         │
│  └─────────────┘ └─────────────┘         │
└───────────────────────────────────────────┘
```

### 4.6 SkillPickerBar 文案优化

Web 端"自动选择"描述文案从：
```
不注入固定 Skill，按普通云端对话回复
```
改为：
```
Skill 轻量版 · 仅文本提示词生效。下载桌面 APP 解锁脚本执行等完整能力
```

---

## 五、审计结论（2026-07-05）

### 已修复 Bug
1. **skill:// URI 路径**: 直接存 markdown 全文到 `skillContent`，避免 `skill://dir` 缺少 `/SKILL.md` 后缀导致 fetch 404
2. **fetch 静默失败**: 启动时验证 fetch 成功，失败时 console.warn

### 桌面端隔离确认
- 所有新增代码在 `!isTauriRuntime()` 分支
- `CentralSkillsPanel` / `scan_all_skills` / `centralSkillCache` 完全不动
- `inMemorySkills` 是 Web 专属数据源，桌面端走 `centralSkillCache`

### Web vs 桌面差异
| 功能 | 桌面 | Web |
|------|:--:|:--:|
| Skill 来源 | git clone | 内置 + 手动创建 |
| 脚本执行 | ✅ Tauri sidecar | ❌ |
| 管理面板 | CentralSkillsPanel（3tab） | WebSkillPanel（平列表） |
| GitHub 导入 | ✅ | Phase 3 |
| Agent 关联 | ✅ | ❌ |

---

## 六、涉及文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `public/skills/` | **新建目录** | 内置 Skill 的 SKILL.md |
| `src/stores/agentStore.ts` | **改** | 新增 `bootstrapWebSkills()` + localStorage 持久化 |
| `src/layouts/WorkspaceLayout.vue` | **改** | `skills` 移出 `WEB_UNSUPPORTED_PANELS` |
| `src/components/skills/WebSkillPanel.vue` | **新建** | Web 版 Skill 管理面板 |
| `src/components/chat/SkillPickerBar.vue` | **不改** | 数据到位即用 |
| `src/composables/web/chatCloud.ts` | **不改** | 注入链路已通 |
| 桌面端所有文件 | **不改** | 零影响 |

---

## 六、不改的东西（确认清单）

- ❌ `src-tauri/` — 零改动
- ❌ `src/components/skills/CentralSkillsPanel.vue` — 不动
- ❌ `src/components/chat/SkillPickerBar.vue` — 不动
- ❌ `src/composables/useChat.ts` — 不动（桌面端路径）
- ❌ `src/opencodeClient/` — 不动
- ❌ 任何 Tauri invoke 调用 — 不动

---

## 七、验收标准

1. Web 端 SkillPickerBar 下拉列表显示内置 Skill（JC-taijianskill-creator 等）
2. 选中内置 Skill 后，对话正确注入 SKILL.md 内容
3. WebSkillPanel 能浏览/新建/编辑/删除 Skill
4. 用户新建的 Skill 刷新页面后仍存在（localStorage）
5. 桌面端所有功能不受影响
6. `pnpm build` 后 `dist/skills/` 正确生成

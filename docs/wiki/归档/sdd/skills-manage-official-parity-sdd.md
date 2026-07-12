# Skills Manage 官方对齐与中文本地化 SDD

> 状态：待执行规格  
> 决策日期：2026-06-08  
> 官方仓库：`https://github.com/iamzhihuix/skills-manage`  
> 官方基准版本：`467d0423beaf71a31c520d4e3795ec88acae5ab2`  
> 本地参考仓库：`/Users/by3/Documents/1OKAPP/skills-manage`  
> 目标项目：`/Users/by3/Documents/jiucaihezi-app`

---

## 1. 决策摘要

韭菜盒子内置的 Skill 管理模块必须与官方 `skills-manage` 在功能模型、术语体系、后端能力上对齐。

这次不再把官方术语改造成另一套产品名。原因：

- 专业用户已经熟悉 Skill、Central Skills、Marketplace、Collections、Discover、Platform 等概念。
- 小白用户也需要从一开始接触标准术语，后续才能顺利学习官方文档和社区资料。
- 韭菜盒子要做的是中文本地化和新手解释层，而不是改变信息架构。

最终原则：

```text
术语跟官方同步，界面做中文本地化。
专有名词保留英文，普通说明汉化。
后端能力 100% 继承官方。
前端 UI 尽量补齐官方能力，但交互说明要适合小白用户。
```

---

## 2. 术语本地化准则

### 2.1 保留英文的专有名词

这些词不翻译，直接保留：

| 官方术语 | 韭菜盒子显示 |
|---|---|
| Skill | Skill |
| SKILL.md | SKILL.md |
| Central Skills | Central Skills |
| Marketplace | Marketplace |
| GitHub | GitHub |
| Registry | Registry |
| Platform | Platform |
| Collections | Collections |
| Discover | Discover |
| Obsidian | Obsidian |
| Claude Code | Claude Code |
| Codex CLI | Codex CLI |
| OpenCode | OpenCode |
| symlink | symlink |
| copy | copy |
| frontmatter | frontmatter |
| Markdown | Markdown |
| AI Summary | AI Summary |

### 2.2 汉化普通动作和说明

普通动词、状态和提示必须中文化：

| 英文 | 中文 |
|---|---|
| Install | 安装 |
| Uninstall | 卸载 |
| Import | 导入 |
| Export | 导出 |
| Sync | 同步 |
| Search | 搜索 |
| Refresh | 刷新 |
| Preview | 预览 |
| Delete | 删除 |
| Edit | 编辑 |
| Settings | 设置 |
| Not detected | 未检测到 |
| Already installed | 已安装 |
| Read-only | 只读 |
| Shared / Always included | 共享 / 自动包含 |
| Force refresh | 强制刷新 |
| Scan | 扫描 |
| Stop and show | 停止并显示结果 |

### 2.3 小白解释层

保留官方术语，但在空状态、提示、详情说明里补一句解释：

| 术语 | 新手解释 |
|---|---|
| Central Skills | 这里是本机统一管理的 Skill 根目录，默认是 `~/.agents/skills`。 |
| Platform | Platform 是能读取或安装 Skill 的 AI 工具。 |
| Marketplace | Marketplace 用来从官方或社区来源查找并安装 Skill。 |
| Registry | Registry 是 Marketplace 的一个来源列表。 |
| Collections | Collections 是一组 Skill 的集合，可以批量安装。 |
| Discover | Discover 会扫描本机项目目录，找出里面已有的 SKILL.md。 |
| symlink | symlink 是推荐安装方式，不复制文件，只创建引用。 |
| copy | copy 会复制一份 Skill 到目标 Platform。 |
| Read-only | 只读 Skill 由 Platform 或共享目录自动提供，不能在这里卸载。 |

### 2.4 本地显示别名

为了照顾中文用户阅读，韭菜盒子允许给每个 Skill 添加一个**本地显示别名**。

这个别名是“便利贴”，不是官方 Skill 字段：

```text
官方 Skill name = 执行、扫描、安装、OpenCode 调用使用的真实名称。
本地显示别名 = 只在韭菜盒子 UI 上展示，帮助用户记忆用途。
```

边界要求：

- 不写入 `SKILL.md`。
- 不修改 frontmatter `name`。
- 不修改目录名。
- 不参与 Skill id 生成。
- 不影响 OpenCode / Codex / Claude Code 的 Skill 扫描。
- 不影响 install / uninstall / Marketplace / Collections / Discover 的后端逻辑。
- 可以参与前端搜索，方便中文用户查找。

推荐 UI 展示：

```text
帮我整理文件
file-organizer
整理本地文件、批量重命名、归档目录...
```

其中：

- `帮我整理文件` 是用户自定义显示别名。
- `file-organizer` 是官方 Skill name，必须始终可见。

---

## 3. 产品边界

### 3.1 保持官方模型

官方模型保留：

- `~/.agents/skills` 是 Central Skills。
- Platform 代表不同 AI 工具的 Skill 目录。
- Marketplace 负责从 Registry/GitHub 获取 Skill。
- Discover 负责扫描项目和外部来源。
- Collections 负责批量管理 Skill。

### 3.2 韭菜盒子特殊边界

韭菜盒子已有一个重要适配：

```text
如果某个 Platform 的 global_skills_dir 等于 Central Skills 根目录，
它不是第二个仓库，也不是独立安装目标。
它应该显示为共享/只读/自动包含状态。
```

当前已实现前端过滤：

- `src/stores/skillsManageStore.ts` 暴露 `platformAgents`
- `src/components/skills/PlatformPanel.vue` 使用 `platformAgents`
- `src/stores/__tests__/skillsManageStore.test.ts` 固定“同路径 Platform 不进入安装目标”

后续应把这个语义下沉到后端字段，而不是长期依赖前端路径比较。

---

## 4. 官方 UI 功能点对齐清单

### 4.1 总览

| 官方 UI 区域 | 官方文件 | 韭菜盒子现状 | 缺口 | 目标状态 |
|---|---|---|---|---|
| AppShell / Sidebar | `src/components/layout/*` | ActivityRail 单入口 + panel tabs | 缺官方式 Skill 管理导航、Settings、Obsidian、Platform 分类 | 保留韭菜盒子 ActivityRail，进入后显示官方一致的二级导航 |
| Central Skills | `src/pages/CentralSkillsView.tsx` | 有列表、搜索、刷新、详情 | 缺排序、文件夹视图、bundle、安装抽屉、GitHub 导入入口 | 补齐官方 Central Skills 页面能力 |
| Skill Card | `UnifiedSkillCard.tsx` | 有基础卡片 | 缺状态图标、platform drawer、folder/card 模式、本地显示别名 | 对齐官方卡片信息层级和状态表达，并额外支持 UI-only 显示别名 |
| Skill Detail | `SkillDetailPage.tsx`, `SkillDetailDrawer.tsx`, `SkillDetailView.tsx` | 有 Markdown 预览 | 缺源码、目录树、AI Summary、文件管理操作 | 补成官方详情视图 |
| Platform View | `src/pages/PlatformView.tsx` | 有平台列表和 Skill 列表 | 缺搜索、文件夹模式、Claude source filter、detail drawer | 补齐每个平台的 Skill 管理视图 |
| Platform Install Drawer | `PlatformInstallDrawer.tsx` | 无 | 缺按 Platform 快速安装/卸载抽屉 | 增加官方抽屉式管理 |
| Install Dialog | `InstallDialog.tsx` | 简化单目标安装 | 缺多选、symlink/copy、只读状态说明 | 对齐官方多 Platform 安装对话框 |
| Marketplace | `MarketplaceView.tsx` | 有 Registry 列表、同步、搜索、安装 | 缺推荐/官方来源、标签、publisher、repo preview | 补齐官方 Marketplace 结构 |
| GitHub Import Wizard | `GitHubRepoImportWizard.tsx` | 后端有，UI 缺完整流程 | 缺预览、选择、进度、Markdown、AI Summary | 补三步导入向导 |
| Discover | `DiscoverView.tsx` | 有根目录展示、扫描、导入 Central | 缺配置、进度、停止、项目/Skill 搜索、虚拟列表、导入 Platform | 补齐官方 Discover 交互 |
| Discover Config | `DiscoverConfigDialog.tsx` | 无 | 缺扫描根目录配置 | 增加官方配置弹窗 |
| Collections | `CollectionsListView.tsx`, `CollectionEditor.tsx` | 有创建、查看、批量安装基础流 | 缺编辑、导入/导出、Skill Picker、单 Skill 安装、滚动恢复 | 补齐官方 Collections |
| Obsidian | `ObsidianVaultView.tsx` | 后端有命令，UI 缺页面 | 缺 Vault 列表和只读 Skill 视图 | 补 Obsidian 子页面 |
| Settings | `SettingsView.tsx` | 全局设置已有，Skill 专项缺 | 缺扫描目录、自定义 Platform、GitHub PAT、AI 设置、主题局部对齐 | 补 Skill 管理设置页面/分区 |
| Global Search | `GlobalSearchDialog.tsx` | 无 | 缺全局搜索 | P2 补齐 |
| Large List UX | `virtualized-list.tsx` | 无 | 大库性能不足 | Discover/Platform/Central 按需接虚拟列表 |

---

## 5. 前端补全任务

### Task UI-1: 建立官方术语与中文文案表

**目标：** 所有 Skill 管理 UI 使用官方术语，不再使用自造概念名。

**文件：**

- 修改：`src/i18n/index.ts`
- 修改：`src/components/skills/**/*.vue`
- 新建：`src/components/skills/shared/SkillTerminologyHelp.vue`

**要求：**

- 所有 tab 名称使用：
  - `Central Skills`
  - `Platform`
  - `Discover`
  - `Marketplace`
  - `Collections`
  - `Settings`
- 普通按钮使用中文：
  - `刷新`
  - `扫描`
  - `安装`
  - `卸载`
  - `导入`
  - `导出`
  - `同步`
  - `删除`
- 首次进入和空状态增加解释句，但不改官方术语。

**验收：**

- 搜索 `我的 Skill 库|网上找 Skill|Skill 套装|可使用的工具|从项目里找 Skill`，不应出现在 Skill 管理 UI。
- `pnpm run typecheck`

---

### Task UI-1.5: 本地显示别名

**目标：** 允许用户给 Skill 设置一个只在韭菜盒子前端显示的中文别名，帮助识别用途，同时不破坏官方 Skill 规范。

**文件：**

- 修改：`src/types/skillsManage.ts`
- 修改：`src/stores/skillsManageStore.ts`
- 修改：`src/components/skills/shared/SkillCard.vue`
- 修改：`src/components/skills/SkillDetailPanel.vue`
- 新建：`src/components/skills/shared/SkillAliasEditor.vue`
- 新建：`src/utils/__tests__/skillDisplayAlias.test.ts`

**数据模型：**

```ts
export interface SkillDisplayAlias {
  skillId: string
  alias: string
  updatedAt: number
}
```

**存储建议：**

短期使用本地 UI 元数据存储：

```text
localStorage key: jc_skill_display_aliases_v1
```

长期可迁移到 SQLite 独立表：

```sql
CREATE TABLE skill_display_aliases (
  skill_id TEXT PRIMARY KEY,
  alias TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

注意：这个表不是官方 `skills-manage` schema 的一部分，必须标注为韭菜盒子 UI metadata。

**显示规则：**

```text
如果 alias 非空：
  卡片主标题显示 alias
  官方 name 显示在副标题或 badge 中
如果 alias 为空：
  卡片主标题显示官方 name
```

**搜索规则：**

搜索命中范围包括：

- alias
- 官方 name
- description
- file_path
- source

**编辑规则：**

- 在 Skill card 的更多菜单中提供 `编辑显示别名`。
- 在 Skill detail 顶部提供 `显示别名` 输入。
- 支持清空 alias。
- alias 最大长度 40 个中文字符或 80 个 ASCII 字符。
- 禁止换行。
- alias 只影响 UI。

**必须测试：**

- 设置 alias 后，`SKILL.md` 内容不变。
- 设置 alias 后，`skill.name` 不变。
- 清空 alias 后，UI 回退显示官方 name。
- 搜索 alias 能找到 Skill。
- alias 不参与 install command 参数。

**验收：**

- UI 上始终同时能看到 alias 和官方 name。
- OpenCode 固定 Skill 仍使用官方 name / id。
- `pnpm run typecheck`
- `pnpm run test:focused`

---

### Task UI-2: Central Skills 页面补齐

**目标：** Central Skills 与官方 `CentralSkillsView.tsx` 功能对齐。

**文件：**

- 修改：`src/components/skills/CentralSkillsPanel.vue`
- 修改：`src/stores/skillsManageStore.ts`
- 新建：`src/components/skills/CentralBundlePanel.vue`
- 新建：`src/components/skills/PlatformInstallDrawer.vue`
- 新建：`src/components/skills/InstallDialog.vue`
- 新建：`src/components/skills/shared/SkillFolderCard.vue`
- 新建：`src/components/skills/shared/SkillListModeToggle.vue`

**官方能力必须补齐：**

- 搜索 Skill。
- 按名称、创建时间、更新时间排序。
- 列表模式 / 文件夹模式切换。
- Central bundle 列表。
- Central bundle detail。
- Central bundle 删除预览。
- 删除 bundle 时展示受影响 Platform。
- 单 Skill 删除确认。
- 单 Skill 安装到多个 Platform。
- Platform install drawer。
- GitHub repo import 入口。

**韭菜盒子适配：**

- 顶部标题保留 `Central Skills`。
- 副标题中文解释：`统一管理本机 Skill，默认路径 ~/.agents/skills`。
- 同路径 Platform 显示为 `共享 / 自动包含`，不作为安装目标。

**验收：**

- 新增 store 测试覆盖：
  - `get_central_skill_bundles`
  - `get_central_skill_bundle_detail`
  - `preview_delete_central_skill_bundle`
  - `delete_central_skill_bundle`
- `pnpm run typecheck`
- `pnpm run test:focused`

---

### Task UI-3: Skill Detail 补齐

**目标：** 对齐官方 Skill 详情页/抽屉。

**文件：**

- 修改：`src/components/skills/SkillDetailPanel.vue`
- 修改：`src/components/skills/shared/SkillMarkdownPreview.vue`
- 新建：`src/components/skills/SkillFileTreePanel.vue`
- 新建：`src/components/skills/SkillAiSummaryPanel.vue`

**官方能力必须补齐：**

- Markdown 预览。
- 原始 SKILL.md 内容。
- frontmatter 摘要。
- 安装状态。
- Collections 归属。
- 文件目录树。
- 打开文件管理器。
- AI Summary / explain skill。
- refresh AI Summary。

**韭菜盒子适配：**

- tab 名称：
  - `说明`
  - `SKILL.md`
  - `文件`
  - `AI Summary`
- `AI Summary` 下方中文解释：`用 AI 帮你概括这个 Skill 的用途、触发场景和注意事项。`

**验收：**

- `read_skill_content`、`read_file_by_path`、`list_skill_directory`、`open_in_file_manager`、`get_skill_explanation`、`explain_skill_stream`、`refresh_skill_explanation` 均有 UI 入口。
- 文件读取入口必须限制在当前 Skill 目录或明确后端校验。

---

### Task UI-4: Platform 页面补齐

**目标：** 对齐官方 `PlatformView.tsx` 和平台侧边栏能力。

**文件：**

- 修改：`src/components/skills/PlatformPanel.vue`
- 修改：`src/components/skills/shared/PlatformBadge.vue`
- 新建：`src/components/skills/PlatformSkillDrawer.vue`
- 新建：`src/components/skills/shared/PlatformIcon.vue`

**官方能力必须补齐：**

- Platform 搜索。
- 单 Platform Skill 搜索。
- 列表 / 文件夹视图。
- Claude source filter：`all` / `user` / `plugin`。
- Skill detail drawer。
- uninstall。
- install central Skill。
- 显示 read-only / shared 状态。
- Platform 分类：coding / lobster / custom。

**韭菜盒子适配：**

- 标题保留 `Platform`。
- 副标题中文解释：`Platform 是能读取或安装 Skill 的 AI 工具。`
- 同路径 Platform 不出现在安装目标，只在状态中显示 `共享 / 自动包含`。

**验收：**

- `platformAgents` 测试继续通过。
- 共享中央库 Platform 不出现卸载按钮。

---

### Task UI-5: Marketplace 补齐

**目标：** 对齐官方 `MarketplaceView.tsx`。

**文件：**

- 修改：`src/components/skills/MarketplacePanel.vue`
- 修改：`src/stores/skillsManageStore.ts`
- 新建：`src/components/skills/GitHubRepoImportWizard.vue`
- 新建：`src/components/skills/MarketplaceSkillDetailDrawer.vue`
- 新建：`src/components/skills/SkillPreviewDialog.vue`
- 新建：`src/data/officialSources.ts`

**官方能力必须补齐：**

- 推荐 Skill。
- 官方来源目录。
- tag filter。
- publisher card。
- repo preview。
- preview Markdown。
- install recommended/official Skill。
- GitHub repo import wizard。
- Registry 列表和强制刷新。
- Registry duplicate 检测。
- GitHub PAT 使用提示。
- AI Summary for imported GitHub Skill。

**韭菜盒子适配：**

- 标题保留 `Marketplace`。
- 中文解释：`从官方或社区来源查找并安装 Skill。`
- Registry 放在高级区域，不作为小白主入口。

**验收：**

- `preview_github_repo_import`
- `import_github_repo_skills`
- `fetch_github_skill_markdown`
- `sync_registry_with_options`
- `install_marketplace_skill`
- `explain_skill_stream`
  均有 UI 路径。

---

### Task UI-6: Discover 补齐

**目标：** 对齐官方 `DiscoverView.tsx`。

**文件：**

- 修改：`src/components/skills/DiscoverPanel.vue`
- 新建：`src/components/skills/DiscoverConfigDialog.vue`
- 新建：`src/components/skills/DiscoveredProjectList.vue`
- 新建：`src/components/skills/DiscoveredSkillList.vue`

**官方能力必须补齐：**

- scan roots。
- scan root enabled/disabled。
- scan config dialog。
- start scan。
- stop scan。
- progress bar。
- current path。
- found so far。
- project search。
- Skill search。
- selected skill ids。
- import to Central Skills。
- import to Platform。
- clear discovered results。
- virtualized list for large results。

**韭菜盒子适配：**

- 标题保留 `Discover`。
- 中文解释：`扫描本机项目目录，发现里面已有的 SKILL.md。`
- 默认只显示安全扫描范围，高级设置里允许改 root。

**验收：**

- `start_project_scan`、`stop_project_scan`、`set_scan_root_enabled`、`clear_discovered_skills` 有 UI 入口。
- 扫描过程中可停止并显示已发现结果。

---

### Task UI-7: Collections 补齐

**目标：** 对齐官方 `CollectionsListView.tsx`。

**文件：**

- 修改：`src/components/skills/CollectionsPanel.vue`
- 新建：`src/components/skills/CollectionEditor.vue`
- 新建：`src/components/skills/CollectionInstallDialog.vue`
- 新建：`src/components/skills/CollectionPickerDialog.vue`
- 新建：`src/components/skills/SkillPickerDialog.vue`

**官方能力必须补齐：**

- 创建 Collection。
- 编辑 Collection。
- 删除 Collection。
- add/remove Skill。
- Skill picker。
- 单 Skill 安装。
- Collection batch install。
- import Collection。
- export Collection。
- detail drawer。
- scroll restoration。

**韭菜盒子适配：**

- 标题保留 `Collections`。
- 中文解释：`Collections 是一组 Skill，可以一起管理和批量安装。`
- 导入/导出按钮解释 JSON 用途。

**验收：**

- `import_collection`、`export_collection` 有 UI 入口。
- 批量安装失败时展示每个失败 Platform。

---

### Task UI-8: Settings 与 Obsidian 补齐

**目标：** 补齐官方 Settings 和 Obsidian 页面能力。

**文件：**

- 新建：`src/components/skills/SkillsSettingsPanel.vue`
- 新建：`src/components/skills/AddDirectoryDialog.vue`
- 新建：`src/components/skills/PlatformDialog.vue`
- 新建：`src/components/skills/ObsidianVaultPanel.vue`

**官方 Settings 能力：**

- scan directories 列表。
- add scan directory。
- remove scan directory。
- enable/disable custom scan directory。
- custom Platform add/edit/remove。
- GitHub PAT 读取、保存、清除。
- AI provider/model/key/url 设置。
- DB path display。

**官方 Obsidian 能力：**

- vault list。
- vault Skill list。
- read-only 状态。
- 作为 Discover/Platform 的只读来源。

**韭菜盒子适配：**

- Settings 入口放在 Skill 管理模块右上角。
- Obsidian 放在 Discover 下的二级入口。
- GitHub PAT 文案：`用于提高 GitHub 导入成功率，不会显示明文。`

**验收：**

- settings commands 全部有 UI 路径。
- Obsidian 只读能力不创建可卸载安装记录。

---

## 6. 后端核心能力对齐清单

### 6.1 必须 100% 保留的官方后端能力

| 能力 | 官方模块 | 韭菜盒子现状 | 后续要求 |
|---|---|---|---|
| SQLite schema | `db.rs` | 已迁移 | 建 schema drift 对照测试 |
| Central Skills scan | `scanner.rs`, `skills.rs` | 已迁移 | 保持官方测试等价 |
| SKILL.md frontmatter parse | `scanner.rs` | 已迁移 | 保留所有边界测试 |
| Platform detection | `agents.rs`, `db.rs` | 已迁移 | 增加 `is_install_target` / `uses_central_root` 字段 |
| symlink install | `linker.rs` | 已迁移 | UI 接完整多选安装 |
| copy install | `linker.rs` | 已迁移 | UI 接高级选项 |
| uninstall | `linker.rs` | 已迁移 | 区分 read-only/shared |
| batch install | `linker.rs` | 已迁移 | UI 接失败摘要 |
| Central bundles | `skills.rs` | 后端已有 | UI 接完整 |
| Skill detail/content | `skills.rs` | 后端已有 | UI 接源码/目录树 |
| Collections | `collections.rs` | 后端已有 | UI 接 import/export/edit |
| Discover | `discover.rs` | 后端已有 | UI 接 stop/progress/config |
| Obsidian | `discover.rs` | 后端已有 | UI 接 Vault 页面 |
| Marketplace | `marketplace.rs` | 后端已有 | UI 接推荐/官方来源 |
| GitHub repo import | `github_import.rs` | 后端已有 | UI 接向导 |
| Settings | `settings.rs` | 后端已有 | UI 接设置页 |
| AI explanation | `marketplace.rs` | 后端已有 | UI 接 AI Summary |
| Skill display aliases | 韭菜盒子 UI metadata | 待补 | 必须与官方 Skill schema 隔离，不写 `SKILL.md` |

### 6.2 韭菜盒子必须补的后端适配

#### Backend-1: Platform 安装目标语义字段

**问题：** 当前前端用路径比较过滤同 Central Skills 根目录的 Platform。这个规则必须由后端返回，避免不同 UI 调用不一致。

**新增字段建议：**

```rust
pub struct AgentWithStatus {
    pub id: String,
    pub display_name: String,
    pub category: String,
    pub global_skills_dir: String,
    pub project_skills_dir: Option<String>,
    pub icon_name: Option<String>,
    pub is_detected: bool,
    pub is_builtin: bool,
    pub is_enabled: bool,
    pub is_install_target: bool,
    pub uses_central_root: bool,
}
```

**规则：**

```text
is_install_target = enabled && id != central && category != central && !uses_central_root && !source_only
uses_central_root = canonical(global_skills_dir) == canonical(central.global_skills_dir)
```

**测试：**

- `codex` 指向 `~/.agents/skills` 时，`uses_central_root = true`，`is_install_target = false`。
- `claude-code` 指向 `~/.claude/skills` 时，`uses_central_root = false`，`is_install_target = true`。

#### Backend-2: 文件读取 IPC 限域

**问题：** 官方独立 app 可以暴露较宽的文件读取入口；韭菜盒子是更大的宿主应用，应限制 `read_file_by_path`、`list_skill_directory`、`open_in_file_manager`。

**规则：**

- 允许读取当前 Skill bundle 内文件。
- 允许读取 Central Skills 根目录下文件。
- 允许读取已扫描到的 Platform Skill 文件。
- 拒绝任意路径读取。

**测试：**

- Central Skill 内文件读取成功。
- `/etc/passwd` 或用户 home 任意文件读取失败。
- symlink 逃逸失败。

#### Backend-3: 官方仓库 drift 对照

**问题：** 官方仓库未来会更新，韭菜盒子需要知道后端是否落后。

**建议：**

- 新增 `docs/sdd/skills-manage-official-parity-matrix.md`，记录官方 commit。
- 新增脚本 `scripts/audit-skills-manage-parity.mjs`，比较：
  - command 名称
  - Rust 模块文件
  - TypeScript types 字段
  - i18n key

#### Backend-4: UI-only 显示别名持久化

**问题：** 中文用户需要给英文 Skill name 加本地显示别名，但这个别名不能污染官方 Skill 规范。

**推荐方案：**

第一阶段只做前端 localStorage，避免改官方共享 SQLite schema。

第二阶段如需多端/备份，再加入 SQLite 独立表：

```sql
CREATE TABLE IF NOT EXISTS jc_skill_display_aliases (
  skill_id TEXT PRIMARY KEY,
  alias TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

表名前缀必须使用 `jc_`，明确这是韭菜盒子 UI metadata，不是官方 `skills-manage` schema。

**后端边界：**

- 任何官方命令不得读取 alias 决定 Skill 行为。
- `install_skill_to_agent` 仍传 `skillId`。
- `get_skill_detail` 返回官方 name。
- alias 最多只能作为额外 UI command 暴露，例如：

```rust
get_skill_display_alias(skill_id)
set_skill_display_alias(skill_id, alias)
clear_skill_display_alias(skill_id)
```

---

## 7. 页面结构建议

韭菜盒子不必复制官方独立 app 的全屏 Shell，但 Skill 管理中心内部必须有官方一致的信息架构：

```text
ActivityRail: Skills
  └─ Skill 管理中心
      ├─ Central Skills
      ├─ Platform
      ├─ Discover
      ├─ Marketplace
      ├─ Collections
      ├─ Obsidian
      └─ Settings
```

移动端或窄屏：

```text
顶部 select / segmented control
  Central Skills / Platform / Discover / Marketplace / Collections / More
```

---

## 8. 验收 Gate

每个阶段必须跑：

```bash
pnpm run typecheck
pnpm run test:focused
```

涉及 Tauri UI 后必须跑：

```bash
pnpm tauri dev
```

手动冒烟：

- Central Skills 能看到 `~/.agents/skills` 下 Skill。
- 同路径 Platform 不作为第二个仓库出现。
- Skill detail 能查看 Markdown、源码、文件树、AI Summary。
- Marketplace 能查看官方来源、预览 GitHub repo、导入 Skill。
- Discover 能扫描、停止、导入 Central Skills。
- Collections 能导入/导出、编辑、批量安装。
- Settings 能管理扫描目录、GitHub PAT、自定义 Platform。
- Obsidian Vault Skill 只读展示，不生成可卸载安装记录。
- 本地显示别名只影响 UI 搜索和展示，不影响官方 name、SKILL.md、安装和执行。

---

## 9. 执行优先级

### P0：必须先补

1. 官方术语中文本地化。
2. 本地显示别名。
3. 后端 `is_install_target` / `uses_central_root` 字段。
4. Central Skills 文件夹模式、排序、bundle。
5. 安装对话框多 Platform + symlink/copy。
6. GitHub import wizard。
7. Discover stop/progress/config。
8. Settings 中 GitHub PAT、扫描目录、自定义 Platform。
9. 文件读取 IPC 限域。

### P1：完整官方体验

1. Platform drawer。
2. Collections import/export/editor/picker。
3. Skill Detail AI Summary。
4. Marketplace 推荐/官方来源/tag/publisher。
5. Obsidian Vault 页面。
6. virtualized list。

### P2：体验增强

1. Global Search。
2. scroll restoration。
3. 完整移动端适配。
4. 双语 i18n key 全量补齐。
5. parity audit 脚本自动化。

---

## 10. 不做事项

- 不把 `Central Skills` 改名为“我的 Skill 库”。
- 不把 `Marketplace` 改名为“网上找 Skill”。
- 不把 `Collections` 改名为“Skill 套装”。
- 不把 `Platform` 改名为“可使用的工具”。
- 不隐藏 `symlink` / `copy` 概念，只在默认 UI 中给中文解释。
- 不创建第二套 Skill 仓库路径。
- 不把本地显示别名写入 `SKILL.md` 或官方 frontmatter。

---

## 11. 当前已完成基线

已完成：

- Rust 后端模块迁移到 `src-tauri/src/skills/`。
- SQLite 路径使用 `~/.skillsmanage/db.sqlite`。
- Central Skills 根目录使用 `~/.agents/skills`。
- Vue Skill 管理面板基础版：
  - Central Skills
  - Platform
  - Discover
  - Marketplace
  - Collections
- `save_central_skill` 写入安全修复。
- 同路径 Platform 不进入前端安装目标：
  - `platformAgents`
  - `installableAgents`
  - `skillsManageStore.test.ts`

最近验证：

- `pnpm run typecheck` 通过。
- `pnpm run test:focused` 在提升权限后通过：
  - Node focused tests：525 passed。
  - Rust tests：389 passed，0 failed，1 ignored。

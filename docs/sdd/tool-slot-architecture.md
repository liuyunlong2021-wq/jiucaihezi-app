# 工具即 Prompt — 极简工具发现与安装 SDD

> **状态**: v6 — Skill 仓库优先打样
> **分支**: `gongju`
> **日期**: 2026-06-25
> **核心洞察**: 韭菜盒子不需要做工具容器。OpenCode 已经是全电脑最强的安装引擎和运行时。
> **当前任务**: Phase 0 — Skill 仓库「GitHub 推荐」Tab（最小改动打样）

---

## 0. 执行策略：先 Skill 后软件

软件安装（yt-dlp/Pixelle-Video/so-novel）延后。先用 **Skill 仓库** 打样，验证「推荐→安装→输入框→OpenCode」这条链路。

**为什么从 Skill 开始：**
- Skill 仓库已有完善的卡片 UI、删除、详情等能力
- 只需把「文件夹」Tab 改成「GitHub 推荐」，换一个数据源
- 16 个精选 Skill 已有明确的 GitHub 地址和安装方式
- 安装后 Skill 自动出现在「全部」列表中（文件系统扫描）

**一句话总结不变：** 用户看到 Skill → 点「安装」 → 输入框自动生成一句话 → 用户发送 → OpenCode 安装到 `~/.agents/skills/` → Skill 仓库自动识别。

---

## Phase 0: Skill 仓库 GitHub 推荐（本次任务）

### 0.1 改动范围

改动 3 个文件，约 150 行新代码：

| 文件 | 改动 |
|------|------|
| `public/tools/github-skills.json` | **新增** — 16 个精选 Skill 数据 |
| `src/components/skills/SkillListModeToggle.vue` | 「文件夹」→「GitHub 推荐」 |
| `src/components/skills/CentralSkillsPanel.vue` | `viewMode` 加 `'github'`，渲染 GitHub 推荐列表 |

### 0.2 数据模型

```typescript
// public/tools/github-skills.json
interface GitHubSkillEntry {
  id: string
  name: string
  description: string
  repo: string              // GitHub owner/repo
  homepage: string
  stars?: number
  category: string
  tags: string[]
  installPrompt: string      // 发给输入框的安装指令
  note?: string
}
```

### 0.3 用户体验

```
Skill 仓库
  [全部]  [GitHub 推荐]          ← 原来是 [文件夹]，现在改名为 [GitHub 推荐]

  点击「GitHub 推荐」→ 显示 16 个精选 Skill 卡片
  每张卡片：名称 / 描述 / ⭐ / GitHub 地址 / [安装] 按钮

  点击「安装」→ 输入框填入 installPrompt
  用户发送 → OpenCode git clone 到 ~/.agents/skills/
  安装完成 → 切换到「全部」→ Skill 已在列表中 → 可用
```

### 0.4 与现有 SkillCard 的关系

GitHub 推荐列表中的 Skill **尚未安装**，不能用现有 `SkillCard`（它依赖 `SkillWithLinks` 类型，需要文件系统扫描数据）。新建一个轻量的 `GitHubSkillCard.vue`，仅展示推荐信息 + 安装按钮。安装后 Skill 出现在「全部」列表时，自动使用现有的 `SkillCard`。

### 0.5 出口标准

- [ ] Skill 仓库出现「全部」|「GitHub 推荐」两个 Tab
- [ ] GitHub 推荐显示 16 个 Skill，按 Serena 6 → Ren 10 排序
- [ ] 点击「安装」→ 输入框出现 installPrompt
- [ ] 用户发送 → OpenCode clone 到 `~/.agents/skills/`
- [ ] 刷新「全部」→ Skill 出现在列表中
- [ ] vue-tsc + vite build 通过

---

## 1. 为什么之前的方案太重

之前想的是：APP 管理工具生命周期 → 安装引擎 → 运行时 → 状态机 → iframe 嵌入 → 端口管理 → 进程控制...

但冷静下来看，这些东西 OpenCode 全能做，而且做得更好：

| 我们想做的 | OpenCode 已经能做 |
|-----------|------------------|
| 下载 GitHub Release 二进制 | `curl -L {url} -o {path}` |
| 校验 SHA256 | `shasum -a 256 {file}` |
| git clone | `git clone {repo}` |
| 创建 venv | `python3 -m venv venv` |
| pip/npm install | `pip install` / `npm install` |
| 运行命令 | 文/武模式原生执行 |
| 管理进程 | 原生进程控制 |
| 多工具协调 | 同一个 OpenCode session 里串行/并行 |

**结论：APP 不需要做一个"工具容器"。APP 只需要做一个"工具目录"——把好工具的链接和一句安装 prompt 准备好，剩下的全交给 OpenCode。**

---

## 2. 核心设计

### 2.1 用户路径

```
用户在工具栏看到「GitHub 推荐安装」
  ↓
浏览推荐列表 / 分类 / 搜索
  ↓
看到 yt-dlp：⭐ 185K | 网页媒体采集 | 1800+ 网站
  ↓
点「安装」
  ↓
输入框自动填入：
  "请帮我安装 yt-dlp（https://github.com/yt-dlp/yt-dlp）。
   从 GitHub Releases 下载最新版二进制到 ~/.jiucaihezi/tools/yt-dlp/，
   校验 SHA256，macOS 执行 xattr -d com.apple.quarantine 解除隔离。"
  ↓
用户点发送 → 自动完成安装
  ↓
安装完后，用户可以：
  - 在终端直接用 yt-dlp
  - 继续在输入框说「用 yt-dlp 下载 xxx」
  - 协调 yt-dlp + 其他工具做复杂任务
```

### 2.2 一句话架构

```
┌─────────────────────────────────────────────┐
│           工具发现层（APP 唯一新增）           │
│                                             │
│  public/tools/registry.json  ← 精选工具清单   │
│  GitHubToolRanking.vue      ← 推荐安装 UI    │
│  每个工具：名称 / 描述 / ⭐ / 分类 / 安装提示词 │
│                                             │
│  用户点「安装/卸载」 → 往输入框填 prompt        │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│          OpenCode（已有的，不改）             │
│                                             │
│  接收 prompt → 下载/编译/配置 → 完成          │
│  后续：运行工具 / 协调多工具 / 项目集成        │
└─────────────────────────────────────────────┘
```

### 2.3 不做什么

- ❌ 不做安装引擎（OpenCode 自己做）
- ❌ 不做运行时管理（OpenCode / 终端自己做）
- ❌ 不做 iframe 嵌入（工具在系统浏览器或终端用）
- ❌ 不做状态机（工具装没装好，OpenCode 会话里自然知道）
- ❌ 不做端口管理、进程控制、日志系统
- ❌ 不做 tool.yaml schema（一个 prompt 字符串就够了）

---

## 3. 工具注册表

### 3.1 数据模型

```typescript
// public/tools/registry.json
interface ToolEntry {
  id: string                    // 唯一标识
  name: string                  // 显示名称
  description: string           // 一句话描述
  repo: string                  // GitHub owner/repo
  homepage: string              // GitHub URL
  stars?: number                // GitHub Stars（可定期更新）
  category: string              // media | dev | ai | document | utility
  tags: string[]
  installPrompt: string         // ★ 核心：发给输入框的安装指令
  uninstallPrompt?: string      // 卸载指令（如与安装对称可自动生成）
  note?: string                 // 额外提示（依赖要求、已知问题等）
}
```

### 3.2 完整示例

```json
{
  "version": 1,
  "updated": "2026-06-25",
  "sources": [
    { "name": "Serena 精选 · 视频创作 6 工具", "url": "https://x.com/369Serena/status/2062495055034958159" },
    { "name": "Ren 精选 · 内容创作 10 Skill", "url": "https://x.com/FakeMaidenMaker/status/2066460707508388309" },
    { "name": "GitHub Chinese Top Charts（停更参考）", "url": "https://github.com/GrowingGit/GitHub-Chinese-Top-Charts" },
    { "name": "sindresorhus/awesome（持续更新）", "url": "https://github.com/sindresorhus/awesome" }
  ],
  "tools": [
    {
      "id": "hyperframes",
      "name": "HyperFrames",
      "description": "一句话生成动效视频：HTML/CSS/动画渲染为 MP4，适合文章/推文快速转视频",
      "repo": "heygen-com/hyperframes",
      "homepage": "https://github.com/heygen-com/hyperframes",
      "category": "ai",
      "tags": ["视频生成", "动效", "PPT视频"],
      "installPrompt": "请帮我安装 HyperFrames（https://github.com/heygen-com/hyperframes）。git clone --depth 1 到 ~/.jiucaihezi/tools/hyperframes/src/，然后 npm install。安装完成后运行 npm run dev 验证。",
      "uninstallPrompt": "请帮我卸载 HyperFrames。删除 ~/.jiucaihezi/tools/hyperframes/ 目录即可。"
    },
    {
      "id": "video-use",
      "name": "video-use",
      "description": "AI 视频剪辑：删除停顿/错误片段/口头禅，处理字幕/音频/调色/动效",
      "repo": "browser-use/video-use",
      "homepage": "https://github.com/browser-use/video-use",
      "category": "ai",
      "tags": ["视频剪辑", "AI", "字幕"],
      "installPrompt": "请帮我安装 video-use（https://github.com/browser-use/video-use）。git clone --depth 1 到 ~/.jiucaihezi/tools/video-use/src/，然后 python3 -m venv venv && venv/bin/pip install -r src/requirements.txt。",
      "note": "需要 Python 3.10+。首次运行可能需要下载模型。"
    },
    {
      "id": "remotion-skills",
      "name": "Remotion Skills",
      "description": "用 React 代码批量制作视频：排行榜/数据周报/产品更新/固定栏目",
      "repo": "remotion-dev/skills",
      "homepage": "https://github.com/remotion-dev/skills",
      "category": "ai",
      "tags": ["视频", "React", "批量", "数据可视化"],
      "installPrompt": "请帮我安装 Remotion Skills（https://github.com/remotion-dev/skills）。git clone --depth 1 到 ~/.jiucaihezi/tools/remotion-skills/src/，然后 npm install。"
    },
    {
      "id": "generative-media-skills",
      "name": "Generative Media Skills",
      "description": "AI 视频生成工具箱：图片/视频/音频生成，产品广告/UGC/音乐视频/社媒短片",
      "repo": "SamurAIGPT/Generative-Media-Skills",
      "homepage": "https://github.com/SamurAIGPT/Generative-Media-Skills",
      "category": "ai",
      "tags": ["AI视频", "AI图片", "AI音频", "生成"],
      "installPrompt": "请帮我安装 Generative Media Skills（https://github.com/SamurAIGPT/Generative-Media-Skills）。git clone --depth 1 到 ~/.jiucaihezi/tools/generative-media-skills/src/。",
      "note": "部分功能需要配置 MuAPI，并会产生生成费用。"
    },
    {
      "id": "videocut-skills",
      "name": "videocut-skills",
      "description": "中文视频剪辑 Skills：理解剪辑需求，处理素材/字幕/短视频制作流程",
      "repo": "Ceeon/videocut-skills",
      "homepage": "https://github.com/Ceeon/videocut-skills",
      "category": "ai",
      "tags": ["视频剪辑", "中文", "字幕", "短视频"],
      "installPrompt": "请帮我安装 videocut-skills（https://github.com/Ceeon/videocut-skills）。git clone --depth 1 到 ~/.jiucaihezi/tools/videocut-skills/src/。"
    },
    {
      "id": "seedance2-skill",
      "name": "seedance2-skill",
      "description": "帮即梦 Seedance 2.0 写专业视频提示词：逐秒分镜/运镜/对白/音效设计",
      "repo": "dexhunter/seedance2-skill",
      "homepage": "https://github.com/dexhunter/seedance2-skill",
      "category": "ai",
      "tags": ["提示词", "即梦", "分镜", "视频"],
      "installPrompt": "请帮我安装 seedance2-skill（https://github.com/dexhunter/seedance2-skill）。git clone --depth 1 到 ~/.jiucaihezi/tools/seedance2-skill/src/。",
      "note": "生成视频仍需进入即梦 Seedance 2.0 操作。"
    },
    {
      "id": "guizang-ppt-skill",
      "name": "guizang-ppt-skill",
      "description": "一句话出杂志级 HTML 演示稿，配图/封面/动效全带（17K ⭐）",
      "repo": "op7418/guizang-ppt-skill",
      "homepage": "https://github.com/op7418/guizang-ppt-skill",
      "stars": 17000,
      "category": "ai",
      "tags": ["PPT", "演示", "HTML", "设计"],
      "installPrompt": "请帮我安装 guizang-ppt-skill（https://github.com/op7418/guizang-ppt-skill）。git clone --depth 1 到 ~/.jiucaihezi/tools/guizang-ppt-skill/src/。"
    },
    {
      "id": "guizang-social-card-skill",
      "name": "guizang-social-card-skill",
      "description": "一段文字出小红书竖版轮播图+公众号封面，28 套版式/10 套主题（3.5K ⭐）",
      "repo": "op7418/guizang-social-card-skill",
      "homepage": "https://github.com/op7418/guizang-social-card-skill",
      "stars": 3500,
      "category": "ai",
      "tags": ["小红书", "公众号", "封面", "排版"],
      "installPrompt": "请帮我安装 guizang-social-card-skill（https://github.com/op7418/guizang-social-card-skill）。git clone --depth 1 到 ~/.jiucaihezi/tools/guizang-social-card-skill/src/。"
    },
    {
      "id": "awesome-gpt-image-2",
      "name": "awesome-gpt-image-2",
      "description": "gpt-image-2 生图 Skill：470+ 爆款图反向拆解 + 20 套工业级模板（7.3K ⭐）",
      "repo": "freestylefly/awesome-gpt-image-2",
      "homepage": "https://github.com/freestylefly/awesome-gpt-image-2",
      "stars": 7300,
      "category": "ai",
      "tags": ["生图", "提示词", "海报", "封面"],
      "installPrompt": "请帮我安装 awesome-gpt-image-2（https://github.com/freestylefly/awesome-gpt-image-2）。git clone --depth 1 到 ~/.jiucaihezi/tools/awesome-gpt-image-2/src/。"
    },
    {
      "id": "humanizer-zh",
      "name": "Humanizer-zh",
      "description": "AI 文本人话化：去掉翻译腔和空话套话，中文写作者人手一个（10K ⭐）",
      "repo": "op7418/Humanizer-zh",
      "homepage": "https://github.com/op7418/Humanizer-zh",
      "stars": 10000,
      "category": "ai",
      "tags": ["写作", "中文", "润色", "AI去味"],
      "installPrompt": "请帮我安装 Humanizer-zh（https://github.com/op7418/Humanizer-zh）。git clone --depth 1 到 ~/.jiucaihezi/tools/humanizer-zh/src/。"
    },
    {
      "id": "deep-research-skills",
      "name": "Deep-Research-skills",
      "description": "深度研究 Agent：列大纲→分头搜索→汇成带出处的报告（1.1K ⭐）",
      "repo": "Weizhena/Deep-Research-skills",
      "homepage": "https://github.com/Weizhena/Deep-Research-skills",
      "stars": 1100,
      "category": "ai",
      "tags": ["研究", "搜索", "报告", "深度"],
      "installPrompt": "请帮我安装 Deep-Research-skills（https://github.com/Weizhena/Deep-Research-skills）。git clone --depth 1 到 ~/.jiucaihezi/tools/deep-research-skills/src/。"
    },
    {
      "id": "anything-to-notebooklm",
      "name": "anything-to-notebooklm",
      "description": "一鱼多吃：公众号/网页/YouTube/PDF 一键转播客/PPT/思维导图/测验（5.1K ⭐）",
      "repo": "joeseesun/qiaomu-anything-to-notebooklm",
      "homepage": "https://github.com/joeseesun/qiaomu-anything-to-notebooklm",
      "stars": 5100,
      "category": "ai",
      "tags": ["播客", "PPT", "思维导图", "多形态"],
      "installPrompt": "请帮我安装 anything-to-notebooklm（https://github.com/joeseesun/qiaomu-anything-to-notebooklm）。git clone --depth 1 到 ~/.jiucaihezi/tools/anything-to-notebooklm/src/。"
    },
    {
      "id": "wewrite",
      "name": "wewrite",
      "description": "公众号一条龙：抓热点/定选题/写正文/SEO/配图/排版/进草稿箱（2.3K ⭐）",
      "repo": "oaker-io/wewrite",
      "homepage": "https://github.com/oaker-io/wewrite",
      "stars": 2300,
      "category": "ai",
      "tags": ["公众号", "写作", "SEO", "排版"],
      "installPrompt": "请帮我安装 wewrite（https://github.com/oaker-io/wewrite）。git clone --depth 1 到 ~/.jiucaihezi/tools/wewrite/src/，然后 npm install。"
    },
    {
      "id": "youtube-clipper-skill",
      "name": "Youtube-clipper-skill",
      "description": "长视频自动切短视频：找高光/配字幕，做切片号/二创素材（2K ⭐）",
      "repo": "op7418/Youtube-clipper-skill",
      "homepage": "https://github.com/op7418/Youtube-clipper-skill",
      "stars": 2000,
      "category": "ai",
      "tags": ["视频切片", "高光", "字幕", "二创"],
      "installPrompt": "请帮我安装 Youtube-clipper-skill（https://github.com/op7418/Youtube-clipper-skill）。git clone --depth 1 到 ~/.jiucaihezi/tools/youtube-clipper-skill/src/。"
    },
    {
      "id": "oh-story-claudecode",
      "name": "oh-story-claudecode",
      "description": "网文选题脑暴：扫番茄/晋江/知乎排行榜，拆解爆款写法（2.4K ⭐）",
      "repo": "worldwonderer/oh-story-claudecode",
      "homepage": "https://github.com/worldwonderer/oh-story-claudecode",
      "stars": 2400,
      "category": "ai",
      "tags": ["网文", "选题", "爆款", "写作"],
      "installPrompt": "请帮我安装 oh-story-claudecode（https://github.com/worldwonderer/oh-story-claudecode）。git clone --depth 1 到 ~/.jiucaihezi/tools/oh-story-claudecode/src/。"
    },
    {
      "id": "marketingskills",
      "name": "marketingskills",
      "description": "32 个营销 Skill：文案/SEO/转化/品牌定位，出海/外贸必备（33K ⭐，英文）",
      "repo": "coreyhaines31/marketingskills",
      "homepage": "https://github.com/coreyhaines31/marketingskills",
      "stars": 33000,
      "category": "ai",
      "tags": ["营销", "SEO", "文案", "品牌", "英文"],
      "installPrompt": "请帮我安装 marketingskills（https://github.com/coreyhaines31/marketingskills）。git clone --depth 1 到 ~/.jiucaihezi/tools/marketingskills/src/。"
    },
    {
      "id": "yt-dlp",
      "name": "yt-dlp",
      "description": "从 1800+ 网站下载视频/音频/字幕/元数据（185K ⭐）",
      "repo": "yt-dlp/yt-dlp",
      "homepage": "https://github.com/yt-dlp/yt-dlp",
      "stars": 185000,
      "category": "media",
      "tags": ["视频下载", "音频", "字幕", "网页采集"],
      "installPrompt": "请帮我安装 yt-dlp（https://github.com/yt-dlp/yt-dlp）。从 GitHub Releases 下载最新版二进制：\n- macOS: 下载 yt-dlp_macos，改名为 yt-dlp，chmod +x，xattr -d com.apple.quarantine\n- Windows: 下载 yt-dlp.exe\n放到 ~/.jiucaihezi/tools/yt-dlp/ 目录下。安装完成后运行 yt-dlp --version 验证。",
      "uninstallPrompt": "请帮我卸载 yt-dlp。删除 ~/.jiucaihezi/tools/yt-dlp/ 目录即可。",
      "note": "需要 ffmpeg 才能合并视频和音频。如未安装请先 brew install ffmpeg (macOS)。"
    },
    {
      "id": "pixelle-video",
      "name": "Pixelle-Video",
      "description": "AI 视频生成工作流引擎",
      "repo": "AIDC-AI/Pixelle-Video",
      "homepage": "https://github.com/AIDC-AI/Pixelle-Video",
      "category": "ai",
      "tags": ["AI视频", "生成", "工作流"],
      "installPrompt": "请帮我安装 Pixelle-Video（https://github.com/AIDC-AI/Pixelle-Video）。步骤：\n1. git clone --depth 1 https://github.com/AIDC-AI/Pixelle-Video.git ~/.jiucaihezi/tools/pixelle-video/src/\n2. cd ~/.jiucaihezi/tools/pixelle-video/ && python3 -m venv venv\n3. venv/bin/pip install -r src/requirements.txt\n4. 安装完成后运行 venv/bin/python src/app.py 验证。",
      "uninstallPrompt": "请帮我卸载 Pixelle-Video。删除 ~/.jiucaihezi/tools/pixelle-video/ 目录即可。",
      "note": "需要 Python 3.10+。首次启动可能下载模型文件。"
    },
    {
      "id": "so-novel",
      "name": "so-novel",
      "description": "小说下载与阅读工具",
      "repo": "freeok/so-novel",
      "homepage": "https://github.com/freeok/so-novel",
      "category": "utility",
      "tags": ["小说", "下载", "阅读"],
      "installPrompt": "请帮我安装 so-novel（https://github.com/freeok/so-novel）。git clone --depth 1 到 ~/.jiucaihezi/tools/so-novel/src/，然后按仓库 README 安装依赖。",
      "uninstallPrompt": "请帮我卸载 so-novel。删除 ~/.jiucaihezi/tools/so-novel/ 目录即可。"
    }
  ]
}
```

### 3.3 工具发现源

初期工具清单来自以下精选源（人工筛选入库）：

| 来源 | 说明 | 状态 |
|------|------|------|
| [sindresorhus/awesome](https://github.com/sindresorhus/awesome) | GitHub 最全的精选列表索引，持续更新。**中文版**可直接作为工具发现主源 | ✅ 推荐主力 |
| [GrowingGit/GitHub-Chinese-Top-Charts](https://github.com/GrowingGit/GitHub-Chinese-Top-Charts) | 中文 GitHub 项目排行榜，分语言/分类极全 | 🟡 2 年前停更，历史数据仍可参考 |
| Serena 精选 6 工具 | 视频创作类（HyperFrames/video-use/Remotion/GenerativeMedia/videocut/Seedance2） | ✅ 已录入 |
| Ren 精选 10 Skill | 内容创作类（PPT/生图/写作/研究/公众号/切片/网文/营销） | ✅ 已录入 |
| 人工发现 | yt-dlp、Pixelle-Video、so-novel 等 | ✅ 已录入 |

后续可通过 GitHub API 自动从 `sindresorhus/awesome` 中文版同步工具清单。

### 3.4 installPrompt 编写规范

- 明确写出下载 URL、目标路径
- 区分 macOS / Windows 命令
- 包含安装后的验证命令（`--version`）
- 如有系统依赖（ffmpeg/python），在 `note` 字段提示
- 不假设用户机器上有 Homebrew/pip/npm——如果缺依赖，让 OpenCode 自己去检测和安装

---

## 4. UI 设计

### 4.1 GitHub 推荐安装

```
┌──────────────────────────────────────────────┐
│  🔧 GitHub 推荐安装             搜索 ██     │
│  全部 │ 媒体 │ AI │ 开发 │ 工具               │
├──────────────────────────────────────────────┤
│                                              │
│  #1  ⭐ yt-dlp                   185K ⭐     │
│      从 1800+ 网站下载视频/音频/字幕          │
│      yt-dlp/yt-dlp                           │
│      [安装] [卸载] [GitHub]                   │
│                                              │
│  #2     Pixelle-Video                -       │
│      AI 视频生成工作流引擎                     │
│      AIDC-AI/Pixelle-Video                    │
│      [安装] [卸载] [GitHub]                   │
│                                              │
│  #3     so-novel                      -       │
│      小说下载与阅读                            │
│      freeok/so-novel                          │
│      [安装] [卸载] [GitHub]                   │
│                                              │
│  ... 后续从 awesome 扩充                     │
└──────────────────────────────────────────────┘
```

> 💡 提示：AI Skill（如 guizang-ppt-skill、Humanizer-zh 等）在 **Skill 仓库** 中导入，不在此处。

### 4.2 点击「安装」后的行为

```
┌──────────────────────────────────────────────┐
│  🔧 GitHub 工具精选                          │
├──────────────────────────────────────────────┤
│                                              │
│  #1  ⭐ yt-dlp                    185K ⭐    │
│      从 1800+ 网站下载视频/音频/字幕          │
│                                              │
│  ┌─ 安装指令已生成 ──────────────────────┐  │
│  │                                       │  │
│  │  请帮我安装 yt-dlp（https://github.    │  │
│  │  com/yt-dlp/yt-dlp）。从 GitHub       │  │
│  │  Releases 下载最新版二进制...           │  │
│  │                                       │  │
│  │  [复制指令]  [发送到 输入框 →]       │  │
│  └───────────────────────────────────────┘  │
│                                              │
└──────────────────────────────────────────────┘
```

点击「发送到 输入框 」→ 填入 ChatPanel 输入框 → 用户确认发送 → OpenCode 开始安装。

### 4.3 排序规则

- 按 GitHub Stars 降序
- 无 `stars` 数据的排在末尾
- `stars` 可通过 GitHub API 批量更新（脚本，非实时）

---

## 5. 与输入框的集成

### 5.1 往输入框填文本

这是唯一需要的"集成"。不需要新增 Tauri command、不需要新增 IPC 通道。

```typescript
// 工具卡片点击「发送到 输入框」
function sendToInputBox(prompt: string) {
  // 通过现有机制往 ChatPanel 输入框填文本
  // 可以用 eventBus.emit('chat:setInput', prompt)
  // 或者用 chatStore 的 setInput 方法
}
```

具体接入点看现有 `ChatPanel.vue` 的输入框绑定方式，可能是一个 `ref` 或 `store.inputText`。

### 5.2 安装后的使用

安装完成后，工具使用完全在自然对话中进行：

```
用户: "用 yt-dlp 下载 https://www.youtube.com/watch?v=xxx 到 ~/Movies/"
→ 执行 yt-dlp 命令 → 下载完成

用户: "把刚才下载的视频用 ffmpeg 转成 MP3"
→ 执行 ffmpeg 命令 → 转换完成

用户: "用 Pixelle-Video 生成一个 10 秒的 AI 视频，主题是赛博朋克"
→ 启动 Pixelle → 调 API → 生成视频 → 完成
```

**核心价值：多工具协调完成复杂任务。APP 只负责发现和填 prompt，不在中间做任何抽象。**

---

## 6. 双端差异

```
桌面端 (Tauri):
  - 完整 GitHub 推荐安装列表
  - 点击「安装/卸载」→ 填输入框 → 发送执行
  - 安装后可自然对话使用工具

Web 端 (Cloudflare):
  - 展示推荐列表（只读）
  - 每个工具显示「桌面端可用」提示
  - 点击「查看详情」→ 跳转 GitHub
  - 不展示安装/卸载按钮（Web 端没有本地执行环境）
```

Web 端和桌面端共用同一份 `registry.json` 和同一套 UI 组件，只差在「安装/卸载」按钮的行为。

---

## 7. 迁移计划

### 原则

> 不删旧代码，先上新 UI。旧工具面板（`ToolWarehousePanel` 的静态卡片）保留不变，
> 在旁边加一个新 Tab「GitHub 推荐安装」放软件列表。Skill 不进此 Tab，进 Skill 仓库。

### Phase 1: 推荐安装上线（1 天）

- [ ] 创建 `public/tools/registry.json`，首期录入 3 个软件（yt-dlp + Pixelle-Video + so-novel）
- [ ] 新建 `src/components/tools/GitHubToolRanking.vue`（推荐安装 UI）
- [ ] 在 `ToolWarehousePanel.vue` 加 Tab：「我的工具」|「GitHub 推荐安装」
- [ ] 实现「安装」按钮 → 填输入框 installPrompt
- [ ] 实现「卸载」按钮 → 填输入框 uninstallPrompt（无则自动生成：`删除 ~/.jiucaihezi/tools/{id}/ 目录即可`）
- [ ] Web 端展示「桌面端可用」提示
- [ ] Skill 仓库侧：将 Serena 6 + Ren 10 共 16 个 Skill 整理入库

**出口标准**：
- [ ] 推荐列表显示 3 个软件：yt-dlp、Pixelle-Video、so-novel
- [ ] 点击「安装」→ 输入框出现 installPrompt → 用户发送 → 安装成功
- [ ] 点击「卸载」→ 输入框出现 uninstallPrompt → 用户发送 → 卸载成功
- [ ] Web 端正确展示「桌面端可用」
- [ ] vue-tsc + vite build 通过

### Phase 2: 工具扩展（持续）

- [ ] 补充到 20-30 个精选工具
- [ ] 加搜索和分类筛选
- [ ] 定期通过 GitHub API 更新 Stars 数据（脚本，非实时）

### Phase 3: 旧工具清理（Phase 1 验证稳定后）

- [ ] 评估哪些旧内置工具已被 GitHub 工具替代
- [ ] 逐个将旧工具从 `localContentTools.ts` 等文件移除
- [ ] 删除 `src-tauri/binaries/yt-dlp-*`
- [ ] 删除 `MediaUrlCapturePanel.vue`
- [ ] 清理 `lib.rs` 中 `media_capture_*` 命令

---

## 8. 软件清单

| # | 软件 | GitHub | ⭐ | 分类 | 一句话 |
|---|------|--------|-----|------|--------|
| 1 | yt-dlp | yt-dlp/yt-dlp | 185K | 媒体 | 1800+ 网站视频/音频/字幕下载 |
| 2 | Pixelle-Video | AIDC-AI/Pixelle-Video | — | AI | AI 视频生成工作流引擎 |
| 3 | so-novel | freeok/so-novel | — | 工具 | 小说下载与阅读 |

### 待入库 Skill（进 Skill 仓库，不进此列表）

| 来源 | 数量 | 内容 |
|------|------|------|
| Serena 精选 | 6 | HyperFrames / video-use / Remotion Skills / Generative Media Skills / videocut-skills / seedance2-skill |
| Ren 精选 | 10 | guizang-ppt-skill / social-card / awesome-gpt-image-2 / Humanizer-zh / Deep-Research / anything-to-notebooklm / wewrite / Youtube-clipper / oh-story / marketingskills |

---

## 9. 安全与信任模型

因为安装是由 OpenCode 执行的（用户可以看到完整 prompt 并确认后才发送），安全模型天然比"APP 静默执行"强：

1. **用户可见**：installPrompt 全文展示在输入框，用户可以看到要执行的每一条命令
2. **用户确认**：用户必须手动点发送，APP 不自动执行
3. **OpenCode 沙箱**：OpenCode 的权限系统（approval/deny）自然适用
4. **工具来源**：`registry.json` 由人工维护，只收录已知的、活跃维护的 GitHub 仓库
5. **安装目录**：prompt 中指定 `~/.jiucaihezi/tools/{id}/`，不污染系统

**不需要**：二进制签名校验、symlink 防护、端口白名单——这些要么 OpenCode 已有的权限模型覆盖了，要么根本不适用（因为安装行为是用户确认后由 OpenCode 执行的）。

---

## 10. 文件清单

### 新增

| 文件 | 说明 |
|------|------|
| `public/tools/registry.json` | 精选工具清单（~100 行） |
| `src/components/tools/GitHubToolRanking.vue` | 排行榜 UI（~200 行） |

### 修改

| 文件 | 改动 |
|------|------|
| `src/components/tools/ToolWarehousePanel.vue` | 加 Tab：「我的工具」\|「GitHub 推荐安装」 |
| 无其他 | — |

### 后续清理（Phase 3）

| 文件 | 原因 |
|------|------|
| `src-tauri/binaries/yt-dlp-*` | 不再内置二进制 |
| `src/components/tools/MediaUrlCapturePanel.vue` | 替换为 yt-dlp + OpenCode |
| `lib.rs` 中 `media_capture_*` 段 | 不再需要 |

---

> **下一步**: 确认方向 → 写 `registry.json`（3 个软件） + `GitHubToolRanking.vue`，总共约 200 行新代码。16 个 Skill 后续整理进 Skill 仓库。



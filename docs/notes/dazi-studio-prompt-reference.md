# dazi-studio 提示词参考站

## 是什么

「搭子提示词库」— 独立的引流展示站，提供 GPT Image 2 / Nano Banana / Seedream / Seedance / Grok Imagine 的参考图和可复制提示词。不提供生成能力，仅展示 + 复制 + 引流到韭菜盒子创作。

## 线上地址

- **主域名**：`https://dazi.studio/`
- **旧域名（已废弃）**：`https://tishici.jiucaihezi.studio/` — DNS 指向 Cloudflare 但未绑定 Pages 项目，且数据未更新，**不再使用**

## 源码仓库

```
/Users/by3/Documents/dazi-studio
https://github.com/liuyunlong2021-wq/my-gpt-image-2.git
```

## 技术栈

纯静态 HTML + CSS + 原生 JS，无框架/构建工具。

## 项目结构

```
dazi-studio/
├── index.html       # 单页：Hero + 模型 Tab + 画廊
├── js/app.js        # 全部交互逻辑
├── css/style.css    # 暗色主题
├── data/            # 提示词数据（由 scripts/sync.py 生成）
│   ├── index.json   # 模型索引
│   ├── gpt-image-2.json
│   ├── nano-banana.json
│   ├── seedream.json
│   ├── seedance.json
│   └── grok-imagine.json
└── scripts/
    └── sync.py      # 从 YouMind 同步数据
```

## 部署

- **平台**：Cloudflare Pages（项目名 `dazi`）
- **部署命令**：`cd /Users/by3/Documents/dazi-studio && npx wrangler pages deploy . --project-name dazi --commit-dirty=true`
- **数据源**：从 YouMind sitemap + README 同步，无需手动维护
- **同步命令**：`cd /Users/by3/Documents/dazi-studio && python3 scripts/sync.py`
- **同步依赖**：`pip3 install requests`

## 与韭菜盒子 APP 的关系

- `jiucaihezi-app` 创作面板右上角「提示词参考」按钮 → 跳转 `https://dazi.studio/`
- 入口代码：`src/components/creation/CreationPanel.vue` 第 1489 行

## 重要排障记录（2026-06-29）

**上游图片源仓库 `EvoLinkAI/awesome-gpt-image-2-API-and-Prompts` 被删除**，导致全部 GPT Image 2 提示词的参考图 404。修复方法：重新运行 `sync.py` 从 YouMind 同步数据，图片 URL 从 `raw.githubusercontent.com/EvoLinkAI/...` 替换为 `cms-assets.youmind.com/...`。修复后数据从 ~1440 条增至 2184 条。

## 维护 checklist

- [ ] 每周一 CI 自动同步（`.github/workflows/sync-prompts.yml`）
- [ ] 同步完成后需手动 `wrangler pages deploy`
- [ ] 若上游图片源再次变更，重新跑 `python3 scripts/sync.py`
